// Builds and checks the files the tutorials tell the reader to create, exactly as written on the page.
//   node tests/content.test.js            static checks plus the .NET API (skips any tool that isn't installed)
//   node tests/content.test.js --angular  also runs `ng new` and `ng build` with the tutorial's files (slow, needs network)
// Tools are looked up on PATH, or in the folder named by TOOLS_DIR (helm, kubeconform, actionlint, hadolint).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');
const { extract, bashBlocks } = require('./extract');

const DOCS = path.join(__dirname, '..', 'docs');
const TOOLS = process.env.TOOLS_DIR || '';
const WITH_ANGULAR = process.argv.includes('--angular');
let fails = 0, passes = 0, skips = 0;
const check = (ok, msg, detail) => { if (ok) passes++; else fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && detail ? '\n' + String(detail).trim().split('\n').map((l) => '     ' + l).join('\n') : '')); };
const skip = (msg) => { skips++; console.log('SKIP ' + msg); };

function find(tool) {
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  if (TOOLS) {
    const dirs = [TOOLS, ...fs.readdirSync(TOOLS).map((d) => path.join(TOOLS, d)).filter((d) => fs.statSync(d).isDirectory())];
    for (const dir of dirs) for (const name of [tool, tool + '.exe']) if (isFile(path.join(dir, name))) return path.join(dir, name);
  }
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [tool], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const get = (url, opts = {}) => new Promise((resolve) => {
  const r = http.request(url, { method: opts.method || 'GET', headers: { 'content-type': 'application/json' } }, (res) => {
    let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  r.on('error', () => resolve({ status: 0, body: '' }));
  r.end(opts.body);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiTest(dir, label) {
  const dotnet = find('dotnet');
  if (!dotnet) return skip(`${label}: .NET SDK not installed, API not built`);
  const usesDb = fs.readFileSync(path.join(dir, 'api', 'Program.cs'), 'utf8').includes('Npgsql');
  const pg = process.env.TUTORIAL_PG;   // e.g. "Host=localhost;Port=5433;Database=todo;Username=todo;Password=dev"
  const work = path.join(dir, 'infra-setup');
  fs.mkdirSync(work, { recursive: true });
  const env = { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT || '1' };
  const created = run(dotnet, ['new', 'web', '-n', 'Todo.Api', '-o', 'api', '--force'], { cwd: work, env });
  check(created.status === 0, `${label}: dotnet new web -n Todo.Api -o api`, created.stdout + created.stderr);
  if (usesDb) {
    const add = run(dotnet, ['add', 'api', 'package', 'Npgsql'], { cwd: work, env });
    check(add.status === 0, `${label}: dotnet add api package Npgsql`, add.stdout + add.stderr);
    fs.copyFileSync(path.join(dir, 'api', 'appsettings.Development.json'), path.join(work, 'api', 'appsettings.Development.json'));
    const dev = JSON.parse(fs.readFileSync(path.join(work, 'api', 'appsettings.Development.json'), 'utf8'));
    check(/Host=localhost;.*Database=todo/.test(dev.ConnectionStrings && dev.ConnectionStrings.Todos), `${label}: appsettings.Development.json points at the dev database from the tutorial`);
  }
  fs.copyFileSync(path.join(dir, 'api', 'Program.cs'), path.join(work, 'api', 'Program.cs'));
  const build = run(dotnet, ['build', '-c', 'Release', '-warnaserror'], { cwd: path.join(work, 'api'), env });
  check(build.status === 0, `${label}: the tutorial's Program.cs builds with no warnings`, build.stdout.split('\n').filter((l) => /error|warn/i.test(l)).join('\n'));
  if (build.status !== 0) return;

  const start = (port, extra) => spawn(dotnet, ['run', '-c', 'Release', '--no-build', '--urls', `http://localhost:${port}`], { cwd: path.join(work, 'api'), env: { ...env, APP_VERSION: 'hello', ...extra }, stdio: 'ignore' });
  const waitFor = async (port, p) => { for (let i = 0; i < 60; i++) { if ((await get(`http://localhost:${port}${p}`)).status > 0) return; await sleep(250); } };
  const base = 5080 + Math.floor(Math.random() * 400);

  if (usesDb) {
    // database down: alive, but not ready
    const down = start(base, { ConnectionStrings__Todos: 'Host=localhost;Port=5999;Database=todo;Username=todo;Password=x;Timeout=2' });
    try {
      await waitFor(base, '/healthz');
      check((await get(`http://localhost:${base}/healthz`)).status === 200, `${label}: /healthz stays 200 when the database is down (liveness ignores it)`);
      check((await get(`http://localhost:${base}/readyz`)).status === 503, `${label}: /readyz is 503 while the database is down`);
    } finally { down.kill(); }
    if (!pg) return skip(`${label}: set TUTORIAL_PG to a PostgreSQL connection string to test the API against a real database`);
  }
  const port = base + 1;
  const conn = usesDb ? { ConnectionStrings__Todos: pg } : {};
  let srv = start(port, conn);
  const u = (p) => `http://localhost:${port}${p}`;
  try {
    await waitFor(port, '/healthz');
    if (usesDb) for (let i = 0; i < 40 && (await get(u('/readyz'))).status !== 200; i++) await sleep(250);
    if (usesDb) fs.existsSync(path.join(work, 'x')) || run('bash', ['-c', 'true']);
    let r = await get(u('/api/todos'));
    if (usesDb && r.body !== '[]') { for (const t of JSON.parse(r.body)) await get(u('/api/todos/' + t.id), { method: 'DELETE' }); r = await get(u('/api/todos')); }
    check(r.status === 200 && r.body === '[]', `${label}: GET /api/todos returns [] (the step's goal)`, r.body);
    r = await get(u('/api/todos'), { method: 'POST', body: '{"title":"Learn Helm"}' });
    const created = JSON.parse(r.body || '{}');
    check(r.status === 201 && created.title === 'Learn Helm' && created.done === false, `${label}: POST adds a todo`, r.body);
    r = await get(u('/api/todos'), { method: 'POST', body: '{"title":"  "}' });
    check(r.status === 400, `${label}: a blank title is a 400`);
    r = await get(u('/api/todos'), { method: 'POST', body: JSON.stringify({ title: "'); DROP TABLE todos; --" }) });
    check(r.status === 201 && (await get(u('/api/todos'))).body.includes('DROP TABLE'), `${label}: a title that looks like SQL is stored as plain text`);
    r = await get(u(`/api/todos/${created.id}/toggle`), { method: 'PUT' });
    check(r.status === 200 && JSON.parse(r.body).done === true, `${label}: toggle flips done`);
    r = await get(u('/api/todos/999999/toggle'), { method: 'PUT' });
    check(r.status === 404, `${label}: toggling a missing todo is a 404`);
    r = await get(u('/api/info'));
    check(r.status === 200 && JSON.parse(r.body).version === 'hello' && 'host' in JSON.parse(r.body), `${label}: /api/info reports APP_VERSION and host, in camelCase like the UI expects`, r.body);
    r = await get(u('/healthz'));
    check(r.status === 200 && r.body === 'Healthy', `${label}: /healthz answers Healthy`, r.body);
    if (usesDb) {
      r = await get(u('/readyz'));
      check(r.status === 200 && r.body === 'Ready', `${label}: /readyz answers Ready once the database is up`, r.body);
      srv.kill(); await sleep(500);
      srv = start(port, conn); await waitFor(port, '/healthz');
      for (let i = 0; i < 40 && (await get(u('/readyz'))).status !== 200; i++) await sleep(250);
      r = await get(u('/api/todos'));
      check(r.body.includes('Learn Helm') && JSON.parse(r.body).find((x) => x.title === 'Learn Helm').done === true, `${label}: todos survive an API restart (they live in the database)`, r.body);
    }
    for (const t of JSON.parse((await get(u('/api/todos'))).body)) {
      r = await get(u('/api/todos/' + t.id), { method: 'DELETE' });
      if (t.title === 'Learn Helm') check(r.status === 204, `${label}: DELETE returns 204`);
      if (t.title === 'Learn Helm') { r = await get(u('/api/todos/' + t.id), { method: 'DELETE' }); check(r.status === 404, `${label}: deleting twice is a 404`); }
    }
  } finally { srv.kill(); }
}

function angularTest(dir, label) {
  const npx = find('npx');
  if (!npx) return skip(`${label}: node/npx not installed`);
  const page = fs.readFileSync(path.join(DOCS, label === 'eks' ? 'todo-on-eks-tutorial.html' : 'code-to-cluster-tutorial.html'), 'utf8');
  const m = /npx @angular\/cli@\d+ new todo-ui[^\n]*/.exec(page);
  const env = { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false' };
  const ng = path.join(dir, 'ng');
  fs.mkdirSync(ng, { recursive: true });
  const made = run(npx, ['--yes', ...m[0].replace('npx ', '').split(/\s+/)], { cwd: ng, env });
  const app = path.join(ng, 'ui', 'src', 'app');
  check(made.status === 0 && fs.existsSync(path.join(app, 'app.ts')), `${label}: ${m[0]} creates ui/src/app/app.ts`, made.stdout.slice(-600) + made.stderr.slice(-600));
  if (made.status !== 0) return;
  for (const f of ['app.config.ts', 'app.ts', 'app.html', 'app.css']) fs.copyFileSync(path.join(dir, 'ui', 'src', 'app', f), path.join(app, f));
  fs.copyFileSync(path.join(dir, 'ui', 'proxy.conf.json'), path.join(ng, 'ui', 'proxy.conf.json'));
  const build = run(npx, ['ng', 'build', '--configuration', 'production'], { cwd: path.join(ng, 'ui'), env });
  check(build.status === 0 && fs.existsSync(path.join(ng, 'ui', 'dist', 'todo-ui', 'browser', 'index.html')), `${label}: the tutorial's UI files build, and output lands in dist/todo-ui/browser (the path the Dockerfile copies)`, build.stdout.slice(-800) + build.stderr.slice(-800));
}

async function tutorial(file, label) {
  console.log(`\n== ${label}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tut-${label}-`));
  const files = extract(path.join(DOCS, file), dir);
  const need = ['api/Program.cs', 'api/appsettings.Development.json', 'charts/todo/templates/db.yaml', 'charts/todo/templates/gateway.yaml', ...(label === 'c2c' ? ['kind-config.yaml'] : ['cluster.yaml']), 'api/Dockerfile', 'ui/Dockerfile', 'ui/nginx.conf', 'docker-compose.yml', 'charts/todo/Chart.yaml', 'charts/todo/values.yaml', 'charts/todo/templates/api.yaml', 'charts/todo/templates/ui.yaml', 'deploy/argocd-app.yaml', '.gitignore'];
  check(need.every((f) => files.includes(f)), `${label}: every file the tutorial asks for is on the page`, need.filter((f) => !files.includes(f)).join(', '));

  // bash blocks parse
  const bad = bashBlocks(path.join(DOCS, file)).filter((b) => run('bash', ['-n'], { input: b.code.replace(/<[^>\n]+>/g, 'X') }).status !== 0)   // <placeholders> would read as redirects;
  check(bad.length === 0, `${label}: every bash block is valid shell syntax`, bad.map((b) => b.code.split('\n')[0]).join('\n'));

  // Helm
  const helm = find('helm');
  const values = path.join(dir, 'charts', 'todo', 'values.yaml');
  let t = fs.readFileSync(values, 'utf8').replace('YOUR-GITHUB-USER', 'someuser');
  fs.writeFileSync(values, t);
  if (helm) {
    const lint = run(helm, ['lint', 'charts/todo'], { cwd: dir });
    check(lint.status === 0 && /0 chart\(s\) failed/.test(lint.stdout), `${label}: helm lint reports 0 chart(s) failed`, lint.stdout + lint.stderr);
    const tpl = run(helm, ['template', 'todo', 'charts/todo'], { cwd: dir });
    check(tpl.status === 0, `${label}: helm template renders`, tpl.stderr);
    fs.writeFileSync(path.join(dir, 'rendered.yaml'), tpl.stdout);
    const kc = find('kubeconform');
    if (kc) {
      const v = run(kc, ['-strict', '-summary', '-kubernetes-version', '1.33.0', '-schema-location', 'default', '-schema-location', 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json', 'rendered.yaml'], { cwd: dir });
      check(v.status === 0, `${label}: rendered manifests are valid Kubernetes objects (kubeconform)`, v.stdout + v.stderr);
      const a = run(kc, ['-strict', '-summary', '-schema-location', 'default', '-schema-location', 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json', 'deploy/argocd-app.yaml'], { cwd: dir });
      check(a.status === 0, `${label}: the Argo CD Application is valid against its CRD schema`, a.stdout + a.stderr);
    } else skip(`${label}: kubeconform not installed`);
    // the database and the front door, in both tutorials
    {
      const r = tpl.stdout;
      check(/kind: StatefulSet\s+metadata:\s+name: todo-db/.test(r) && /volumeClaimTemplates:/.test(r) && /kind: Secret\s+metadata:\s+name: todo-db/.test(r), `${label}: the chart deploys the database as a StatefulSet with a volume claim and a Secret`);
      check(/path: \/readyz/.test(r) && /path: \/healthz/.test(r) && /ConnectionStrings__Todos/.test(r) && /secretKeyRef/.test(r), `${label}: the API gets its connection string from the Secret, and probes /readyz and /healthz`);
      check(/Host=todo-db;/.test(r), `${label}: the API connects to the service name todo-db (which the headless Service provides)`);
      // gateway: schema, and the route only points at Services that exist, on the ports they expose
      const svcs = {};
      for (const doc of r.split(/^---$/m)) { const n = /kind: Service\s+metadata:\s+name: (\S+)/.exec(doc); const p = /- port: (\d+)/.exec(doc); if (n && p) svcs[n[1]] = +p[1]; }
      const route = r.split(/^---$/m).find((d) => /kind: HTTPRoute/.test(d)) || '';
      const refs = [...route.matchAll(/- name: (\S+)\s+port: (\d+)/g)].map((m) => [m[1], +m[2]]);
      check(refs.length === 2 && refs.every(([n, p]) => svcs[n] === p), `${label}: every HTTPRoute backend is a real Service on the port it exposes`, JSON.stringify({ refs, svcs }));
      check(/gatewayClassName: nginx/.test(r) && /sectionName: http/.test(r) && /name: todo[^\n]*\n\s+sectionName: http/.test(r), `${label}: the route attaches to the Gateway by name and uses the nginx class`);
      const kcg = find('kubeconform');
      if (kcg) {
        const g = run(kcg, ['-strict', '-summary', '-ignore-missing-schemas', '-schema-location', 'default', '-schema-location', 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json', 'rendered.yaml'], { cwd: dir });
        check(g.status === 0 && /Skipped: 0/.test(g.stdout), `${label}: Gateway and HTTPRoute are valid against the Gateway API schemas`, g.stdout + g.stderr);
      }
      const helmCmd = bashBlocks(path.join(DOCS, file)).map((b) => b.code).find((c) => c.includes('helm install ngf')) || '';
      if (label === 'c2c') {
      // kind front door: the node port published by kind-config.yaml is the one the controller is told to use
      const kind = fs.readFileSync(path.join(dir, 'kind-config.yaml'), 'utf8');
      const cp = /containerPort: (\d+)/.exec(kind) && /containerPort: (\d+)/.exec(kind)[1];
      const hp = /hostPort: (\d+)/.exec(kind) && /hostPort: (\d+)/.exec(kind)[1];
      check(cp && helmCmd.includes(`"port":${cp},"listenerPort":80`), `${label}: kind-config.yaml containerPort (${cp}) matches the nodePort in the helm install command`);
      check(hp === '8080' && fs.readFileSync(path.join(DOCS, file), 'utf8').includes('http://localhost:8080'), `${label}: the published host port (${hp}) is the address the tutorial tells you to open`);
      } else {
        check(!/NodePort|nodePorts/.test(helmCmd) && /nginx-gateway-fabric/.test(helmCmd), `${label}: on EKS the controller keeps its default LoadBalancer Service (no NodePort settings)`);
        check(/svc todo-nginx/.test(fs.readFileSync(path.join(DOCS, file), 'utf8')), `${label}: the tutorial reads the load balancer address from the gateway's Service, todo-nginx`);
      }
      check(/--version 2\.\d+\.\d+/.test(helmCmd) && /ref=v2\.\d+\.\d+/.test(bashBlocks(path.join(DOCS, file)).map((b) => b.code).join('\n')), `${label}: the controller chart and the Gateway API object types are pinned`);
      check(!/port-forward svc\/todo-ui/.test(fs.readFileSync(path.join(DOCS, file), 'utf8')) && !/serviceType/.test(fs.readFileSync(path.join(dir, 'charts', 'todo', 'values.yaml'), 'utf8')), `${label}: no leftover port-forward to the UI or serviceType setting`);
    }
    const local = label === 'c2c' ? ['--set', 'registry=local', '--set', 'tag=1.0.0'] : ['--set', 'registry=local'];
    const lt = run(helm, ['template', 'todo', 'charts/todo', ...local], { cwd: dir });
    check(lt.status === 0 && lt.stdout.includes('image: "local/todo-api:1.0.0"') && lt.stdout.includes('image: "local/todo-ui:1.0.0"'), `${label}: the local (kind) overrides give local/todo-*:1.0.0 images`, lt.stdout.split('\n').filter((l) => /image:/.test(l)).join('\n') + lt.stderr);
  } else skip(`${label}: helm not installed`);

  if (label === 'c2c') {
    // the pipeline's own sed must be able to rewrite the chart
    const ci = fs.readFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'utf8');
    const sedLine = ci.split('\n').find((l) => l.includes('sed -i'));
    fs.writeFileSync(values, fs.readFileSync(values, 'utf8'));
    const sh = run('bash', ['-c', `cd "${dir}" && TAG=abc1234 && ${sedLine.trim()} && grep '^tag:' charts/todo/values.yaml`]);
    check(sh.status === 0 && sh.stdout.trim() === 'tag: "abc1234"', `${label}: the workflow's sed rewrites tag: in values.yaml`, sh.stdout + sh.stderr);
    if (helm) {
      const lt = run(helm, ['template', 'todo', 'charts/todo'], { cwd: dir });
      check(lt.stdout.includes('todo-api:abc1234') && lt.stdout.includes('value: "abc1234"'), `${label}: after the sed, the chart deploys the new tag and APP_VERSION`);
    }
    const al = find('actionlint');
    if (al) { const r = run(al, ['.github/workflows/ci.yml'], { cwd: dir }); check(r.status === 0, `${label}: actionlint accepts ci.yml`, r.stdout + r.stderr); } else skip(`${label}: actionlint not installed`);
    check(!/actions\/checkout@v[1-4]\b/.test(ci) && /paths:/.test(ci) && /contents: write/.test(ci) && !/packages: write/.test(ci), `${label}: ci.yml uses a current checkout action and asks only for the permission it needs`);
    check(/DOCKERHUB_USERNAME/.test(ci) && /DOCKERHUB_TOKEN/.test(ci) && !/ghcr/i.test(ci) && /docker\.io\//.test(ci), `${label}: ci.yml pushes to Docker Hub with the two secrets the tutorial tells you to create`);
    const vals = fs.readFileSync(values, 'utf8');
    check(/^registry: docker\.io\//m.test(vals) && !/ghcr/i.test(vals), `${label}: values.yaml points at Docker Hub`);
    const watched = (/paths:\n((?:\s+- .*\n)+)/.exec(ci) || [, ''])[1];
    check(watched.includes('api/') && watched.includes('ui/') && !watched.includes('charts'), `${label}: ci.yml watches api/ and ui/ but not charts/ (the tag commit it makes cannot trigger it)`, watched);
  }
  if (label === 'eks') {
    const cfg = fs.readFileSync(path.join(dir, 'cluster.yaml'), 'utf8');
    check(/region: us-east-1/.test(cfg) && /name: todo-demo/.test(cfg) && /aws-ebs-csi-driver/.test(cfg) && /withOIDC: true/.test(cfg), `${label}: cluster.yaml names the cluster todo-demo in us-east-1 with the EBS disk driver and OIDC`);
    const page = fs.readFileSync(path.join(DOCS, file), 'utf8');
    check(page.includes('export AWS_REGION=us-east-1') && /eksctl delete cluster --name todo-demo/.test(page), `${label}: the cluster name and region in cluster.yaml match the commands that use them`);
    const ek = find('eksctl');
    const schema = ek && run(ek, ['utils', 'schema'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (schema && schema.status === 0) {
      fs.writeFileSync(path.join(dir, 'eks-schema.json'), schema.stdout);
      const py = run('python3', ['-c', 'import json,sys,yaml,jsonschema; s=json.load(open(sys.argv[1])); jsonschema.validate(yaml.safe_load(open(sys.argv[2])), s); print("valid")', path.join(dir, 'eks-schema.json'), path.join(dir, 'cluster.yaml')]);
      if (py.status === 0) check(py.stdout.trim() === 'valid', `${label}: cluster.yaml is valid against eksctl's own schema`);
      else if (/ModuleNotFound/.test(py.stderr)) skip(`${label}: python jsonschema/yaml not installed, eksctl schema check skipped`);
      else check(false, `${label}: cluster.yaml is valid against eksctl's own schema`, py.stderr.split('\n').slice(-4).join('\n'));
    } else skip(`${label}: eksctl not installed, cluster.yaml schema check skipped`);
  }
  const hl = find('hadolint');
  if (hl) for (const f of ['api/Dockerfile', 'ui/Dockerfile']) { const r = run(hl, [f], { cwd: dir }); check(r.status === 0, `${label}: hadolint is happy with ${f}`, r.stdout + r.stderr); } else skip(`${label}: hadolint not installed`);

  await apiTest(dir, label);
  if (WITH_ANGULAR) angularTest(dir, label);
}

(async () => {
  await tutorial('code-to-cluster-tutorial.html', 'c2c');
  await tutorial('todo-on-eks-tutorial.html', 'eks');
  console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})();
