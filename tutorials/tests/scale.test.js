// Checks everything Part 5 (Scale and Capacity) tells the reader to create, exactly as written on the page: the chart in each of
// its three scaling modes, the metrics-server and KEDA Applications, the k6 load test (run with a real k6 against a stand-in API),
// the PromQL (unit-tested with promtool on made-up series), the pool and list changes to the API, and the arithmetic in the text.
//   node tests/scale.test.js
// Tools are looked up on PATH, or in the folder named by TOOLS_DIR: helm, kubeconform, yq, promtool, k6 and the .NET SDK.
// Anything that is not installed is skipped and reported. Chart checks need network access.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { extract, bashBlocks, blocksCaptioned } = require('./extract');
const { check, skip, summary, find, run, yamlDocs, CRDS, schemaProblems } = require('./lib');

const DOCS = path.join(__dirname, '..', 'docs');
const P = (n) => path.join(DOCS, n);
const FILE = P('scale-and-capacity-tutorial.html');
const NETWORK_ERR = /dial tcp|no such host|Could not resolve|timeout|connection refused|i\/o timeout/i;

async function main() {
  const page = fs.readFileSync(FILE, 'utf8');
  const bash = bashBlocks(FILE).map((b) => b.code).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-scale-'));
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  const unesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const figs = (caption) => [...page.matchAll(/<figcaption>([^<]*)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/g)].filter((m) => m[1] === caption).map((m) => unesc(m[2]).replace(/\n$/, ''));
  const fig = (caption) => { const f = figs(caption); if (!f.length) throw new Error('no code block captioned ' + caption); return f[0]; };

  // Parts 1 to 4, the moves part 3 asks for, then this part's files
  for (const n of ['code-to-cluster-tutorial.html', 'eyes-on-the-cluster-tutorial.html']) extract(P(n), dir);
  for (const [, from, to] of bashBlocks(P('platform-as-code-tutorial.html')).map((b) => b.code).join('\n').matchAll(/^git mv (\S+) (\S+)$/gm)) {
    const src = path.join(dir, from.replace(/^(src|infra)\//, '')), dest = path.join(dir, to.replace(/^(src|infra)\//, ''));
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(src, dest);
  }
  extract(P('platform-as-code-tutorial.html'), dir);
  fs.unlinkSync(path.join(dir, 'charts/todo/templates/too-much.yaml'));   // part 3's drill file
  extract(P('secure-the-road-tutorial.html'), dir);
  const files = extract(FILE, dir);
  const need = ['platform/apps/metrics-server.yaml', 'platform/apps/keda.yaml', 'platform/loadtest/k6.yaml', 'charts/todo/templates/hpa.yaml', 'charts/todo/templates/scaledobject.yaml'];
  check(need.every((f) => files.includes(f)), 'every file the tutorial asks for is on the page', need.filter((f) => !files.includes(f)).join(', '));
  const bad = bashBlocks(FILE).filter((b) => run('bash', ['-n'], { input: b.code.replace(/<[^>\n]+>/g, 'X') }).status !== 0);
  check(bad.length === 0, 'every bash block is valid shell syntax', bad.map((b) => b.code.split('\n')[0]).join('\n'));
  check(!/todo-app|X\.Y\.Z|0\.X\.Y|ghcr\.io|cnpg|CloudNativePG\b.*\bstep 4|todo-db-rw|todo-db-app/.test(page.replace(/<li><strong>A highly available database[\s\S]*?<\/li>/, '')), 'no leftovers: no todo-app folder, no version placeholders, no GHCR images, nothing left from the original CloudNativePG step');
  check(/todo-db-0/.test(page) && /name: todo-db\n/.test(read('charts/todo/templates/db.yaml')) && /kind: StatefulSet/.test(read('charts/todo/templates/db.yaml')), "the page's todo-db-0 is the pod the part 1 StatefulSet creates");

  // ---- the chart, with this part's edits applied as the page describes
  const helm = find('helm');
  const edit = (file, fn) => write(file, fn(read(file)));
  const mustReplace = (text, from, to, what) => { if (!text.includes(from)) throw new Error('the chart no longer contains what the page says to replace: ' + what); return text.replace(from, () => to); };
  const valuesSnips = figs('charts/todo/values.yaml (inside api:)');
  check(valuesSnips.length === 3, 'the page gives three additions inside api: in values.yaml (resources, dbPool, scaling)');
  const [resSnip, poolSnip, scalingSnip] = valuesSnips;
  const oldResources = '          resources:\n            requests: { cpu: 50m, memory: 64Mi }\n            limits: { memory: 256Mi }';
  edit('charts/todo/templates/api.yaml', (t) => {
    t = mustReplace(t, oldResources, fig('charts/todo/templates/api.yaml (the api container)'), 'the api container resources block');
    t = mustReplace(t, 'spec:\n  replicas: {{ .Values.api.replicas }}\n  selector:', fig('charts/todo/templates/api.yaml (the Deployment spec)'), 'the Deployment spec');
    const conn = fig('charts/todo/templates/api.yaml (the connection string)');
    const oldConn = '            - name: ConnectionStrings__Todos\n              value: "Host=todo-db;Database=todo;Username=todo;Password=$(DB_PASSWORD)"';
    return mustReplace(t, oldConn, conn, 'the connection string');
  });
  edit('charts/todo/values.yaml', (t) => {
    const m = /\napi:\n((?:  .*\n)+)/.exec(t);
    if (!m) throw new Error('no api: block in values.yaml');
    const block = m[1];
    if (!/^  replicas: 2 /m.test(block)) throw new Error('the replicas line the page tells you to replace is not in values.yaml');
    const newBlock = block.replace(/^  replicas: .*\n/m, '') + resSnip + '\n' + poolSnip + '\n' + scalingSnip + '\n';
    return t.replace(block, () => newBlock);
  });
  const valuesOk = yamlDocs(read('charts/todo/values.yaml'))[0];
  check(valuesOk.api.scaling === 'fixed' && valuesOk.api.replicas === 2 && valuesOk.api.minReplicas === 2 && valuesOk.api.maxReplicas === 6 && valuesOk.api.dbPool === 10 && valuesOk.api.resources.requests.cpu === '50m' && !('requestsPerPod' in valuesOk.api), 'values.yaml after the edits is valid YAML with one replicas, one resources and the new values under api:');
  const kc = find('kubeconform');
  const podsOf = (docs) => docs.filter((d) => ['Deployment', 'StatefulSet'].includes(d.kind));
  if (!helm) skip('helm not installed');
  else {
    const render = (sets = []) => { const r = run(helm, ['template', 'todo', 'charts/todo', ...sets.flatMap((s) => ['--set', s])], { cwd: dir }); if (r.status !== 0) throw new Error(r.stderr); return { text: r.stdout, docs: yamlDocs(r.stdout) }; };
    const kinds = (docs) => docs.map((d) => d.kind);
    const api = (docs) => docs.find((d) => d.kind === 'Deployment' && d.metadata.name === 'todo-api');
    const lint = run(helm, ['lint', '--strict', 'charts/todo'], { cwd: dir });
    check(lint.status === 0, 'helm lint --strict is clean with this part\'s chart changes', lint.stdout + lint.stderr);

    // the three modes
    const fixed = render(), cpu = render(['api.scaling=cpu']), req = render(['api.scaling=requests', 'api.requestsPerPod=40']);
    check(api(fixed.docs).spec.replicas === 2 && !kinds(fixed.docs).includes('HorizontalPodAutoscaler') && !kinds(fixed.docs).includes('ScaledObject'), 'scaling: fixed runs the Deployment with 2 replicas and no autoscaler');
    check(api(cpu.docs).spec.replicas === undefined && kinds(cpu.docs).filter((k) => k === 'HorizontalPodAutoscaler').length === 1 && !kinds(cpu.docs).includes('ScaledObject'), 'scaling: cpu leaves replicas out of the Deployment and creates exactly one HPA');
    check(api(req.docs).spec.replicas === undefined && kinds(req.docs).filter((k) => k === 'ScaledObject').length === 1 && !kinds(req.docs).includes('HorizontalPodAutoscaler'), 'scaling: requests leaves replicas out of the Deployment and creates exactly one ScaledObject, and no HPA');
    const typo = render(['api.scaling=cpuu']);
    check(api(typo.docs).spec.replicas === undefined && !kinds(typo.docs).includes('HorizontalPodAutoscaler') && !kinds(typo.docs).includes('ScaledObject'), 'a misspelled scaling value renders no replicas and no autoscaler (the page\'s troubleshooting row)');
    const hpa = cpu.docs.find((d) => d.kind === 'HorizontalPodAutoscaler');
    check(hpa.spec.scaleTargetRef.name === 'todo-api' && hpa.spec.minReplicas === 2 && hpa.spec.maxReplicas === 6 && hpa.spec.metrics[0].resource.target.averageUtilization === 70 && hpa.spec.metrics[0].resource.name === 'cpu', 'the HPA targets todo-api, keeps 2 to 6 copies and aims for 70% of the CPU request');
    const so = req.docs.find((d) => d.kind === 'ScaledObject');
    check(so.spec.scaleTargetRef.name === 'todo-api' && so.spec.minReplicaCount === 2 && so.spec.maxReplicaCount === 6 && so.spec.triggers[0].type === 'prometheus' && so.spec.triggers[0].metadata.threshold === '40', 'the ScaledObject targets todo-api, keeps 2 to 6 copies and asks for one pod per 40 requests a second');

    // the values drive the resources and the pool
    const cont = (docs, name) => api(docs).spec.template.spec.containers.find((c) => c.name === name);
    const sorted = (o) => JSON.stringify(o, Object.keys(o).sort());
    check(sorted(cont(fixed.docs, 'api').resources.requests) === sorted({ cpu: '50m', memory: '64Mi' }) && sorted(cont(fixed.docs, 'api').resources.limits) === sorted({ memory: '256Mi' }) && Object.keys(cont(fixed.docs, 'api').resources).length === 2, 'api.resources in values.yaml becomes the container\'s resources');
    const tuned = render(['api.resources.requests.cpu=20m', 'api.resources.limits.cpu=40m']);
    check(cont(tuned.docs, 'api').resources.limits.cpu === '40m' && cont(tuned.docs, 'api').resources.requests.cpu === '20m' && cont(tuned.docs, 'api').resources.limits.memory === '256Mi', 'drill 6: a CPU limit added in values.yaml reaches the container, next to the memory limit');
    const conn = cont(fixed.docs, 'api').env.find((e) => e.name === 'ConnectionStrings__Todos').value;
    check(/;Maximum Pool Size=10$/.test(conn) && conn.includes('Password=$(DB_PASSWORD)') && cont(fixed.docs, 'api').env.some((e) => e.name === 'DB_PASSWORD'), 'the connection string ends with the pool size from dbPool and still takes its password from the DB_PASSWORD variable');
    check(render(['api.dbPool=7']).docs && /Maximum Pool Size=7$/.test(cont(render(['api.dbPool=7']).docs, 'api').env.find((e) => e.name === 'ConnectionStrings__Todos').value), 'changing dbPool changes the pool size');

    // QoS: what step 2 says about the three workloads
    const qos = (c) => { const r = c.resources || {}, q = r.requests || {}, l = r.limits || {}; if (!Object.keys(q).length && !Object.keys(l).length) return 'BestEffort'; const same = ['cpu', 'memory'].every((k) => q[k] && l[k] && q[k] === l[k]); return same ? 'Guaranteed' : 'Burstable'; };
    const workloads = podsOf(fixed.docs).map((d) => [d.metadata.name, qos(d.spec.template.spec.containers[0])]);
    check(workloads.length === 3 && workloads.every(([, q]) => q === 'Burstable'), 'step 2: the API, UI and database are Burstable (requests and a memory limit, no CPU limit)', JSON.stringify(workloads));
    check(qos(cont(tuned.docs, 'api')) === 'Burstable', 'step 6: with a CPU limit that differs from the request the API is still Burstable');

    // kubeconform on everything the chart renders, in all three modes (KEDA's kind from its CRD)
    if (kc) {
      for (const [name, r] of [['fixed', fixed], ['cpu', cpu]]) { write(`out-${name}.yaml`, r.text); const v = run(kc, ['-strict', '-summary', '-ignore-missing-schemas', `out-${name}.yaml`], { cwd: dir }); check(v.status === 0, `kubeconform accepts everything the chart renders with scaling: ${name} (HPA included)`, v.stdout + v.stderr); }
    } else skip('kubeconform not installed');

    // the connection string means what the page says: parse it with Npgsql
    const dotnet = find('dotnet');
    // the KEDA ScaledObject against the CRD from the pinned chart
    const kedaChart = run(helm, ['template', 'keda', 'keda', '--repo', 'https://kedacore.github.io/charts', '--version', '2.21.0', '-n', 'keda']);   // KEDA ships its CRDs as templates, so Argo CD applies them
    if (kedaChart.status !== 0 && NETWORK_ERR.test(kedaChart.stderr)) skip('no network, the KEDA chart was not fetched');
    else {
      const crd = yamlDocs(kedaChart.stdout).find((x) => x.kind === 'CustomResourceDefinition' && x.spec.names.kind === 'ScaledObject');
      check(!!crd, 'the KEDA 2.21.0 chart ships the ScaledObject CRD', kedaChart.stderr);
      if (crd) {
        const probs = schemaProblems(crd, so);
        check(probs.length === 0, 'the ScaledObject uses only fields, types and values the KEDA 2.21.0 CRD accepts', probs.join('\n'));
        const t = JSON.parse(JSON.stringify(so)); t.spec.triggers[0].metadata.querry = 'x'; t.spec.maxReplicaCount = '6';
        const tp = schemaProblems(crd, t);
        check(tp.some((e) => /maxReplicaCount/.test(e)), 'control: the schema check notices a number written as a string');
      }
    }

    // ---- the Applications
    const apps = Object.fromEntries(['metrics-server', 'keda'].map((n) => [n, yamlDocs(read(`platform/apps/${n}.yaml`))[0]]));
    if (kc) {
      const v = run(kc, ['-strict', '-summary', '-schema-location', 'default', '-schema-location', CRDS, 'platform/apps/metrics-server.yaml', 'platform/apps/keda.yaml'], { cwd: dir });
      if (/dial tcp|no such host|Could not resolve/i.test(v.stderr + v.stdout)) skip('no network, the Applications were not validated against the Argo CD schema');
      else check(v.status === 0 && /Valid: 2/.test(v.stdout), 'both new Applications are valid against the Argo CD schema', v.stdout + v.stderr);
    }
    check(apps['metrics-server'].spec.source.chart === 'metrics-server' && apps['metrics-server'].spec.source.targetRevision === '3.14.0' && apps.keda.spec.source.chart === 'keda' && apps.keda.spec.source.targetRevision === '2.21.0' && Object.values(apps).every((a) => a.spec.project === 'default' && a.spec.destination.server === 'https://kubernetes.default.svc'), 'metrics-server (3.14.0) and KEDA (2.21.0) are pinned and stay in the default project');
    check(apps['metrics-server'].spec.destination.namespace === 'kube-system' && apps['metrics-server'].spec.source.helm.valuesObject.args.includes('--kubelet-insecure-tls') && apps.keda.spec.destination.namespace === 'keda' && apps.keda.spec.syncPolicy.syncOptions.includes('CreateNamespace=true') && apps.keda.spec.syncPolicy.syncOptions.includes('ServerSideApply=true') && apps.keda.metadata.finalizers && apps['metrics-server'].metadata.finalizers, 'metrics-server runs in kube-system with kind\'s certificate flag; KEDA gets its own namespace with server-side apply; both cascade-delete');
    for (const [n, a] of Object.entries(apps)) {
      const t = run(helm, ['template', n, a.spec.source.chart, '--repo', a.spec.source.repoURL, '--version', a.spec.source.targetRevision, '-n', a.spec.destination.namespace, ...(a.spec.source.helm.valuesObject ? ['--set', 'args[0]=--kubelet-insecure-tls'] : [])]);
      if (t.status !== 0 && NETWORK_ERR.test(t.stderr)) { skip(`no network, the ${n} chart was not rendered`); continue; }
      check(t.status === 0, `the ${n} chart renders at the pinned version`, t.stderr);
      if (n === 'metrics-server') check(/kubelet-insecure-tls/.test(t.stdout) && /kind: APIService/.test(t.stdout) && /v1beta1\.metrics\.k8s\.io/.test(t.stdout), 'the metrics-server chart registers the metrics API and takes the kubelet flag');
    }
    const todoApp = yamlDocs(read('platform/apps/todo.yaml'))[0];
    check(!('ignoreDifferences' in todoApp.spec) && todoApp.spec.syncPolicy.automated.selfHeal === true && todoApp.spec.syncPolicy.retry.limit >= 5, 'the todo Application keeps selfHeal on, which is why the page has the chart stop stating replicas (and needs the retry for the KEDA CRD)');
    const proj = yamlDocs(read('platform/apps/team-todo-project.yaml'))[0];
    check(!proj.spec.namespaceResourceWhitelist && !proj.spec.namespaceResourceBlacklist, 'the team-todo project places no limit on namespaced kinds, so the HPA and the ScaledObject are allowed');

    // the pull request check, with the two pairs of additions
    const yq = find('yq');
    const adds = [...page.matchAll(/<figcaption>\.github\/workflows\/platform-check\.yml \(two (?:more )?additions\)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => unesc(m[1]).split(/\n\s*\n/).map((s) => s.replace(/\s+$/, '')));
    check(adds.length === 2 && adds[0][0].includes('metrics-server') && adds[1][0].includes('kedacore'), 'the page gives two additions to the pull request check (metrics-server, then KEDA)');
    if (!yq) skip('yq not installed, the pull request check was not run');
    else {
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-scale-repo-'));
      fs.cpSync(path.join(dir, 'platform'), path.join(repoDir, 'infra', 'platform'), { recursive: true });
      const penv = { ...process.env, PATH: path.dirname(yq) + path.delimiter + path.dirname(helm) + path.delimiter + process.env.PATH };
      const r1 = run('bash', ['-ec', adds.map((a) => a[0]).join('\n')], { cwd: repoDir, env: penv });
      if (r1.status !== 0) skip('no network, the pull request check was not run: ' + r1.stderr.split('\n')[0]);
      else { const r2 = run('bash', ['-ec', adds.map((a) => a[1]).join('\n')], { cwd: repoDir, env: penv }); check(r2.status === 0, 'both additions to the pull request check render their chart at the pinned version', r2.stderr); }
      fs.rmSync(repoDir, { recursive: true, force: true });
    }

    // ---- the connection arithmetic in step 4
    const v = valuesOk.api;
    const surge = Math.ceil(v.maxReplicas * 0.25);
    check((v.maxReplicas + surge) * v.dbPool <= 97 && 6 * 100 > 97 && 20 * v.dbPool > 97 && surge === 2, `step 4's arithmetic holds: (${v.maxReplicas} pods + ${surge} surge) × ${v.dbPool} = ${(v.maxReplicas + surge) * v.dbPool} fits under 97, six default pools of 100 do not, and the KEDA drill's 20 pods × ${v.dbPool} = ${20 * v.dbPool} does not`);
    if (dotnet) {
      const env = { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT || '1' };
      const work = path.join(dir, 'dotnet-work'); fs.mkdirSync(work, { recursive: true });
      // 1) Npgsql reads the pool size from the connection string
      let ok = run(dotnet, ['new', 'console', '-n', 'ConnTest', '-o', 'conn', '--force'], { cwd: work, env }).status === 0;
      ok = ok && run(dotnet, ['add', 'conn', 'package', 'Npgsql'], { cwd: work, env }).status === 0;
      fs.writeFileSync(path.join(work, 'conn', 'Program.cs'), 'var b = new Npgsql.NpgsqlConnectionStringBuilder(args[0]);\nConsole.WriteLine($"{b.MaxPoolSize} {b.Host} {b.Database} {b.Username} {b.Password}");\n');
      const parsed = ok && run(dotnet, ['run', '--project', 'conn', '--', conn.replace('$(DB_PASSWORD)', 'secret')], { cwd: work, env });
      check(ok && parsed.status === 0 && parsed.stdout.trim() === '10 todo-db todo todo secret', 'Npgsql reads "Maximum Pool Size=10" from the rendered connection string (and the default it replaces is 100)', parsed && parsed.stdout + parsed.stderr);
      // 2) the API still builds with the new AllAsync, and the SQL does what the page says
      const snippet = fig('src/api/Program.cs (the AllAsync method, changes only)');
      const sql = /"""\n([\s\S]*?)\n\s*"""\);/.exec(snippet)[1].split('\n').map((l) => l.replace(/^ {12}/, '')).join('\n');
      let prog = read('api/Program.cs');
      const oldLine = '        await using var cmd = db.CreateCommand("SELECT id, title, done FROM todos ORDER BY id");';
      check(prog.includes(oldLine), "the line the page says to replace is in part 1's TodoStore.AllAsync, unchanged by part 2");
      const newLines = snippet.slice(snippet.indexOf('        // The 100 newest'), snippet.indexOf('        // …the rest')).replace(/\s+$/, '');
      prog = prog.replace(oldLine, () => newLines);
      const p2bash = bashBlocks(P('eyes-on-the-cluster-tutorial.html')).map((b) => b.code).join('\n');
      const adds2 = ['dotnet add api package Npgsql', ...p2bash.split('\n').filter((l) => /^dotnet add package /.test(l)).map((l) => l.replace('dotnet add ', 'dotnet add api '))];
      ok = run(dotnet, ['new', 'web', '-n', 'Todo.Api', '-o', 'api', '--force'], { cwd: work, env }).status === 0;
      for (const a of adds2) ok = ok && run(dotnet, a.split(' ').slice(1), { cwd: work, env }).status === 0;
      fs.writeFileSync(path.join(work, 'api', 'Program.cs'), prog);
      const build = ok && run(dotnet, ['build', '-c', 'Release', '-warnaserror'], { cwd: path.join(work, 'api'), env });
      check(ok && build.status === 0, 'the API builds with no warnings after the AllAsync change', build && (build.stdout || '').split('\n').filter((l) => /error|warn/i.test(l)).join('\n'));
      // the SQL, run on a stand-in database: the 100 newest, oldest first
      const sq = run('python3', ['-c', `import sqlite3,sys,json
db=sqlite3.connect(':memory:'); db.execute('create table todos (id integer primary key, title text, done boolean default 0)')
db.executemany('insert into todos (title) values (?)', [('t%d'%i,) for i in range(250)])
rows=db.execute(sys.stdin.read()).fetchall()
print(json.dumps([len(rows), rows[0][0], rows[-1][0], [r[0] for r in rows]==sorted(r[0] for r in rows)]))`], { input: sql });
      check(sq.status === 0 && sq.stdout.trim() === '[100, 151, 250, true]', 'the new query returns the 100 newest todos (ids 151 to 250 out of 250), oldest first', sq.stdout + sq.stderr);
      const small = run('python3', ['-c', `import sqlite3,sys,json
db=sqlite3.connect(':memory:'); db.execute('create table todos (id integer primary key, title text, done boolean default 0)')
db.executemany('insert into todos (title) values (?)', [('t%d'%i,) for i in range(3)])
print(json.dumps([r[0] for r in db.execute(sys.stdin.read()).fetchall()]))`], { input: sql });
      check(small.stdout.trim() === '[1, 2, 3]', 'with fewer than 100 todos it returns them all, in order');
    } else skip('.NET SDK not installed, the pool setting and the list change were not built');
  }

  // ---- the load test: the real k6 against a stand-in API
  const job = yamlDocs(read('platform/loadtest/k6.yaml'));
  const cm = job.find((d) => d.kind === 'ConfigMap'), jb = job.find((d) => d.kind === 'Job');
  const script = cm.data['script.js'];
  const container = jb.spec.template.spec.containers[0];
  check(cm.metadata.namespace === 'loadgen' && jb.metadata.namespace === 'loadgen' && jb.spec.template.spec.volumes[0].configMap.name === cm.metadata.name && container.volumeMounts[0].mountPath + '/script.js' === container.args[1] && container.args[0] === 'run', 'the Job mounts the script ConfigMap where its arguments say the script is, in the loadgen namespace');
  check(jb.spec.backoffLimit === 0 && jb.spec.ttlSecondsAfterFinished === 3600 && jb.spec.template.spec.restartPolicy === 'Never' && container.resources.requests.cpu && container.resources.limits.memory, 'the Job runs once, cleans up after an hour and states its resources');
  if (kc) { write('k6.yaml', read('platform/loadtest/k6.yaml')); const v = run(kc, ['-strict', '-summary', 'k6.yaml'], { cwd: dir }); check(v.status === 0, 'the ConfigMap and Job are valid Kubernetes objects', v.stdout + v.stderr); }
  const tag = container.image.split(':')[1];
  const hub = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '20', `https://hub.docker.com/v2/repositories/grafana/k6/tags/${tag}`]);
  if (hub.stdout === '000') skip('no network, the k6 image tag was not checked');
  else check(container.image.startsWith('grafana/k6:') && hub.stdout === '200', `the pinned k6 image ${container.image} exists on Docker Hub`);
  const stages = [...script.matchAll(/duration: '(\d)m', target: (\d+)/g)].map((m) => [+m[1], +m[2]]);
  check(stages.reduce((a, [d]) => a + d, 0) === 9 && Math.max(...stages.map(([, t]) => t)) === 100, 'the stages add up to the nine minutes and 100 users the page promises');
  const k6 = find('k6');
  if (!k6) skip('k6 not installed, the load test script was not run');
  else {
    const serve = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
    const runK6 = async (handler) => {
      const s = await serve(handler); const port = s.address().port;
      const f = path.join(dir, 'script.js'); fs.writeFileSync(f, script.replace('http://todo-api.todo.svc.cluster.local:8080', `http://127.0.0.1:${port}`));
      const r = await new Promise((resolve) => require('node:child_process').execFile(k6, ['run', '--quiet', '--stage', '2s:5', '--stage', '2s:0', f], { encoding: 'utf8', timeout: 60000, env: { ...process.env, K6_NO_USAGE_REPORT: 'true' } }, (e, out, err) => resolve({ status: e ? (e.code || 1) : 0, out: out + err })));
      s.close(); return r;
    };
    const good = await runK6((q, r) => { r.setHeader('content-type', 'application/json'); r.end('[]'); });
    check(good.status === 0 && /http_req_failed/.test(good.out) && /http_req_duration/.test(good.out), 'k6 runs the script against a healthy API: thresholds pass, exit 0 (the Job would Complete)', good.out);
    const errors = await runK6((q, r) => { r.statusCode = 500; r.end('x'); });
    check(errors.status === 99, 'a 500 from the API breaks the error-rate threshold: k6 exits with 99 (the Job would show Failed)', 'exit ' + errors.status + '\n' + errors.out);
    const slow = await runK6((q, r) => setTimeout(() => { r.end('[]'); }, 700));
    check(slow.status === 99, 'responses slower than 500 ms break the latency threshold the same way', 'exit ' + slow.status + '\n' + slow.out);
  }

  // ---- the PromQL, unit-tested with promtool on made-up series
  const promtool = find('promtool');
  if (!promtool) skip('promtool not installed, the queries were not tested');
  else {
    const queries = Object.fromEntries([['p95', figs('PromQL')[0]], ['memory', figs('PromQL')[1]], ['reserved', figs('PromQL')[2]], ['peak', figs('PromQL')[3]], ['throttle', fig('PromQL: throttling ratio')]]);
    const keda = /query: (.*)/.exec(read('charts/todo/templates/scaledobject.yaml'))[1];
    const all = { ...queries, keda };
    const rules = 'groups:\n  - name: q\n    rules:\n' + Object.entries(all).map(([n, q]) => `      - record: q_${n}\n        expr: |\n${q.split('\n').map((l) => '          ' + l).join('\n')}\n`).join('');
    write('q/rules.yml', rules);
    const rc = run(promtool, ['check', 'rules', 'q/rules.yml'], { cwd: dir });
    check(rc.status === 0, 'promtool accepts every PromQL query on the page (' + Object.keys(all).length + ' queries, including the one in the ScaledObject)', rc.stdout + rc.stderr);
    const series = (name, labels, vals) => `      - series: '${name}{${labels}}'\n        values: '${vals}'\n`;
    const input = [
      series('http_server_request_duration_seconds_count', 'job="todo-api",http_route="/api/todos/",pod="a"', '0+15x60'),          // 1 request a second
      series('http_server_request_duration_seconds_count', 'job="todo-api",http_route="/api/todos/",pod="b"', '0+30x60'),          // 2 a second
      series('http_server_request_duration_seconds_count', 'job="todo-api",http_route="/healthz",pod="a"', '0+150x60'),           // health checks are not user traffic
      series('http_server_request_duration_seconds_count', 'job="other",http_route="/api/todos/",pod="z"', '0+150x60'),
      series('container_cpu_cfs_throttled_periods_total', 'namespace="todo",container="api",pod="a"', '0+3x60'),
      series('container_cpu_cfs_periods_total', 'namespace="todo",container="api",pod="a"', '0+10x60'),
      series('container_cpu_cfs_throttled_periods_total', 'namespace="todo",container="api",pod="b"', '0+0x60'),
      series('container_cpu_cfs_periods_total', 'namespace="todo",container="api",pod="b"', '0+10x60'),
      series('container_cpu_usage_seconds_total', 'namespace="todo",container="api",pod="a"', '0+1.5x240'),                       // 0.1 core
      series('container_cpu_usage_seconds_total', 'namespace="todo",container="api",pod="b"', '0+3x240'),                         // 0.2 core
      series('container_cpu_usage_seconds_total', 'namespace="todo",container="ui",pod="u"', '0+0.15x240'),                      // 0.01 core
      series('container_memory_working_set_bytes', 'namespace="todo",container="api",pod="a"', '100000000+0x100 200000000+0x100 100000000+0x100'),
      series('container_memory_working_set_bytes', 'namespace="todo",container="api",pod="b"', '150000000+0x240'),
      series('kube_pod_container_resource_requests', 'namespace="todo",container="api",pod="a",resource="cpu"', '0.05+0x240'),
      series('kube_pod_container_resource_requests', 'namespace="todo",container="api",pod="b",resource="cpu"', '0.05+0x240'),
    ].join('');
    // promtool compares floats exactly, so the test rounds the page's query to 3 places (the query itself is the page's, unchanged)
    const t = (q, at, samples) => `      - expr: |\n          round(\n${all[q].replace(/\n$/, '').split('\n').map((l) => '            ' + l).join('\n')}\n          , 0.001)\n        eval_time: ${at}\n        exp_samples:\n${samples.map(([labels, value]) => `          - labels: '${labels}'\n            value: ${value}\n`).join('')}`;
    const tests = `evaluation_interval: 15s\ntests:\n  - interval: 15s\n    input_series:\n${input}    promql_expr_test:\n` +
      t('keda', '10m', [['{}', 3]]) +
      t('throttle', '10m', [['{pod="a"}', 0.3], ['{pod="b"}', 0]]) +
      t('p95', '55m', [['{container="api"}', 0.3], ['{container="ui"}', 0.01]]) +
      t('memory', '55m', [['{container="api"}', 200000000]]) +
      t('reserved', '55m', [['{container="api", resource="cpu"}', 0.05]]) +
      t('peak', '55m', [['{pod="a"}', 0.1], ['{pod="b"}', 0.2]]);
    write('q/tests.yml', tests);
    const tr = run(promtool, ['test', 'rules', 'tests.yml'], { cwd: path.join(dir, 'q') });
    check(tr.status === 0, 'promtool unit test: the KEDA query adds up user traffic only (3 requests a second from 1 + 2, health checks and other jobs left out); the throttling ratio is 0.3 and 0; the sizing queries return the p95 CPU, the peak memory, the request and the per-pod peak', tr.stdout + tr.stderr);
  }

  // ---- the animation and the page's cross-references
  const animJson = JSON.parse(/<figure class="anim"[\s\S]*?<script type="application\/json">([\s\S]*?)<\/script>/.exec(page)[1]);
  const figure = page.slice(page.indexOf('<figure class="anim"'), page.indexOf('</figure>', page.indexOf('<figure class="anim"')));
  const keys = new Set([...figure.matchAll(/data-k="([\w-]+)"/g)].map((m) => m[1]));
  const used = animJson.flatMap((s) => [s.on, s.off].filter(Boolean).flatMap((x) => x.split(/\s+/)));
  check(animJson.length === 6 && used.every((k) => keys.has(k)), 'the animation has six steps and every element they name exists in the drawing', used.filter((k) => !keys.has(k)).join(', '));
  check(animJson.flatMap((s) => s.path || []).every(([x, y]) => x >= 0 && x <= 820 && y >= 0 && y <= 330), 'the animation\'s moving dot stays inside the drawing');
  const part4 = fs.readFileSync(P('secure-the-road-tutorial.html'), 'utf8');
  check(part4.includes('href="scale-and-capacity-tutorial.html"'), 'part 4 links to this page in its "Where to go next"');
  const netpol = yamlDocs(read('charts/todo/templates/networkpolicies.yaml'));
  const callers = netpol.find((d) => d.metadata.name === 'api-allowed-callers');
  check(callers.spec.ingress[0].from.some((f) => f.namespaceSelector && f.namespaceSelector.matchLabels['kubernetes.io/metadata.name'] === 'loadgen'), "part 4's api-allowed-callers policy lets the loadgen namespace call the API, which is where the k6 Job runs");
  check(fs.existsSync(path.join(dir, 'loadgen')) || fs.existsSync(path.join(dir, 'platform/loadgen/loadgen.yaml')), "the loadgen namespace is created by part 3's loadgen folder, and loadtest/ is a separate folder no Application watches");
  const appPaths = fs.readdirSync(path.join(dir, 'platform/apps')).flatMap((f) => { const d = yamlDocs(read('platform/apps/' + f))[0]; return d && d.kind === 'Application' && d.spec.source && d.spec.source.path ? [d.spec.source.path] : []; });
  check(!appPaths.some((p) => p === 'infra/platform/loadtest' || 'infra/platform/loadtest'.startsWith(p.replace(/\/$/, '') + '/')), 'no Application watches infra/platform/loadtest, so the Job is applied by hand and Argo CD leaves it alone', appPaths.join(', '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(summary());
}

main().catch((e) => { console.error(e); process.exit(1); });
