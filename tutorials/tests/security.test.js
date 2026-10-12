// Checks everything Part 4 (Secure the Road) tells the reader to create, exactly as written on the page: the pipeline with its
// scan and signing steps, the Kyverno and External Secrets Applications and objects, the pod security settings, the network
// policies (evaluated with a small model of Kubernetes' rules) and the API change that shows a key's fingerprint.
//   node tests/security.test.js
// Tools are looked up on PATH, or in the folder named by TOOLS_DIR: helm, kubeconform, actionlint, yq, trivy and the .NET SDK.
// Anything that is not installed is skipped and reported. Chart and image checks need network access.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { extract, bashBlocks, blocksCaptioned } = require('./extract');
const { check, skip, summary, find, run, get, sleep, yamlDocs, CRDS, schemaProblems } = require('./lib');

const DOCS = path.join(__dirname, '..', 'docs');
const P = (n) => path.join(DOCS, n);
const FILE = P('secure-the-road-tutorial.html');
const NETWORK_ERR = /dial tcp|no such host|Could not resolve|timeout|connection refused|i\/o timeout/i;

// ---- a small model of Pod Security "restricted" (the checks in Kubernetes' Pod Security Standards)
function restrictedViolations(pod) {
  const v = [];
  const spec = pod.spec || {};
  const ctrs = [...(spec.containers || []), ...(spec.initContainers || [])];
  const psc = spec.securityContext || {};
  for (const k of ['hostNetwork', 'hostPID', 'hostIPC']) if (spec[k]) v.push(k);
  const okVolumes = ['configMap', 'csi', 'downwardAPI', 'emptyDir', 'ephemeral', 'persistentVolumeClaim', 'projected', 'secret'];
  for (const vol of spec.volumes || []) if (!Object.keys(vol).some((k) => okVolumes.includes(k))) v.push('volume ' + vol.name);
  if ((psc.runAsUser === 0)) v.push('runAsUser 0');
  const seccomp = (c) => ((c.securityContext || {}).seccompProfile || psc.seccompProfile || {}).type;
  const nonRoot = (c) => (c.securityContext && c.securityContext.runAsNonRoot !== undefined ? c.securityContext.runAsNonRoot : psc.runAsNonRoot);
  for (const c of ctrs) {
    const sc = c.securityContext || {};
    if (sc.privileged) v.push(`${c.name}: privileged`);
    if (sc.allowPrivilegeEscalation !== false) v.push(`${c.name}: allowPrivilegeEscalation != false`);
    if (!['RuntimeDefault', 'Localhost'].includes(seccomp(c))) v.push(`${c.name}: seccompProfile`);
    if (nonRoot(c) !== true) v.push(`${c.name}: runAsNonRoot != true`);
    if (sc.runAsUser === 0) v.push(`${c.name}: runAsUser 0`);
    const caps = sc.capabilities || {};
    if (!(caps.drop || []).includes('ALL')) v.push(`${c.name}: capabilities do not drop ALL`);
    if ((caps.add || []).some((a) => a !== 'NET_BIND_SERVICE')) v.push(`${c.name}: capabilities add`);
    if ((c.ports || []).some((p) => p.hostPort)) v.push(`${c.name}: hostPort`);
  }
  return v;
}
const podsOf = (docs) => docs.filter((d) => ['Deployment', 'StatefulSet'].includes(d.kind)).map((d) => ({ name: d.metadata.name, labels: d.spec.template.metadata.labels, spec: d.spec.template.spec }));

// ---- a small model of how Kubernetes applies NetworkPolicy ingress rules
const matches = (sel, labels) => Object.entries((sel && sel.matchLabels) || {}).every(([k, x]) => labels[k] === x);
function ingressAllowed(policies, from, to, port) {
  const mine = policies.filter((p) => (p.metadata.namespace || 'todo') === to.ns && matches(p.spec.podSelector, to.labels) && (p.spec.policyTypes || ['Ingress']).includes('Ingress'));
  if (!mine.length) return true;                                           // not selected by any policy: open
  const nsLabels = (ns) => ({ 'kubernetes.io/metadata.name': ns });
  return mine.some((p) => (p.spec.ingress || []).some((rule) => {
    const portOk = !rule.ports || rule.ports.length === 0 || rule.ports.some((r) => r.port === port);
    const peerOk = !rule.from || rule.from.length === 0 || rule.from.some((peer) => {
      const podOk = !peer.podSelector || (from.ns === (p.metadata.namespace || 'todo') && matches(peer.podSelector, from.labels));
      const nsOk = !peer.namespaceSelector || matches(peer.namespaceSelector, nsLabels(from.ns));
      return (peer.podSelector || peer.namespaceSelector) && podOk && nsOk;
    });
    return portOk && peerOk;
  }));
}

async function main() {
  const page = fs.readFileSync(FILE, 'utf8');
  const bash = bashBlocks(FILE).map((b) => b.code).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-sec-'));
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  const exists = (f) => fs.existsSync(path.join(dir, f));

  // Parts 1 to 3, the moves part 3 asks for, then this part's files
  for (const n of ['code-to-cluster-tutorial.html', 'eyes-on-the-cluster-tutorial.html']) extract(P(n), dir);
  for (const [, from, to] of bashBlocks(P('platform-as-code-tutorial.html')).map((b) => b.code).join('\n').matchAll(/^git mv (\S+) (\S+)$/gm)) {
    const src = path.join(dir, from.replace(/^(src|infra)\//, '')), dest = path.join(dir, to.replace(/^(src|infra)\//, ''));
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(src, dest);
  }
  extract(P('platform-as-code-tutorial.html'), dir);
  fs.unlinkSync(path.join(dir, 'charts/todo/templates/too-much.yaml'));   // part 3's drill file
  const files = extract(FILE, dir);
  const need = ['.github/workflows/ci.yml', 'platform/apps/kyverno.yaml', 'platform/apps/policies.yaml', 'platform/policies/require-signed-images.yaml', 'platform/apps/external-secrets.yaml', 'platform/apps/secret-store.yaml', 'platform/secret-store/store.yaml', 'charts/todo/templates/networkpolicies.yaml', 'charts/todo/templates/secrets.yaml'];
  check(need.every((f) => files.includes(f)), 'every file the tutorial asks for is on the page', need.filter((f) => !files.includes(f)).join(', '));
  const bad = bashBlocks(FILE).filter((b) => run('bash', ['-n'], { input: b.code.replace(/<[^>\n]+>/g, 'X') }).status !== 0);
  check(bad.length === 0, 'every bash block is valid shell syntax', bad.map((b) => b.code.split('\n')[0]).join('\n'));
  check(!/todo-app|X\.Y\.Z|0\.X\.Y/.test(page) && !/ghcr\.io\/(<|YOUR)/i.test(page) && (page.match(/ghcr\.io/g) || []).length === (page.match(/ghcr\.io\/sigstore\/cosign/g) || []).length, 'no leftovers: no todo-app folder, no version placeholders, no GHCR images (only the cosign tool image comes from ghcr.io)');

  // ---- the pipeline
  const ci = read('.github/workflows/ci.yml');
  const wf = yamlDocs(ci)[0];
  const stepsOf = wf.jobs['build-and-publish'].steps, idx = (name) => stepsOf.findIndex((s) => s.name === name);
  const al = find('actionlint');
  if (al) { const r = run(al, ['.github/workflows/ci.yml'], { cwd: dir }); check(r.status === 0, 'actionlint accepts ci.yml', r.stdout + r.stderr); } else skip('actionlint not installed');
  check(['Build the images', 'Scan the images', 'Push the images', 'Sign the images'].every((n) => idx(n) >= 0) && idx('Build the images') < idx('Scan the images') && idx('Scan the images') < idx('Push the images') && idx('Push the images') < idx('Sign the images') && idx('Sign the images') < idx('Put the new tag in the Helm chart'), 'the order is build, scan, push, sign, then the tag commit: a failing scan stops the pipeline before anything is pushed');
  check(wf.permissions['id-token'] === 'write' && wf.permissions.contents === 'write' && !('packages' in wf.permissions), 'the workflow asks for id-token (to sign) and contents (for the tag commit) and nothing else');
  check(/DOCKERHUB_USERNAME/.test(ci) && /DOCKERHUB_TOKEN/.test(ci) && /docker\.io\//.test(ci) && !/ghcr/i.test(ci) && /src\/api\/\*\*/.test(ci) && /src\/ui\/\*\*/.test(ci) && /actions\/checkout@v[5-9]/.test(ci), 'ci.yml keeps part 1 as it was: Docker Hub, the same secrets, src/ paths, a current checkout action');
  const version = (re) => (re.exec(ci) || [])[1];
  check(version(/COSIGN_VERSION: "(v[\d.]+)"/) === 'v2.6.5' && stepsOf[idx('Install cosign')].with['cosign-release'] === '${{ env.COSIGN_VERSION }}' && bash.includes(`cosign/cosign:${version(/COSIGN_VERSION: "(v[\d.]+)"/)} verify`), 'cosign is pinned once, and the install step and the verify command on the page use that version');
  // run the scan step and the signing step as written, with stand-in docker, cosign and trivy
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-sec-bin-'));
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash\necho "docker $*" >> "${log}"\nif [ "$1" = inspect ]; then echo "someone/todo-api@sha256:abc123"; fi\nif [[ "$*" == *"--exit-code 1"* && -n "$FAIL_SCAN" ]]; then exit 1; fi\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'cosign'), `#!/usr/bin/env bash\necho "cosign $*" >> "${log}"\n`, { mode: 0o755 });
  const stepRun = (name, env = {}) => { fs.writeFileSync(log, ''); const r = run('bash', ['-e', '-c', stepsOf[idx(name)].run], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, REGISTRY: 'docker.io/someone', TAG: 'abc1234', TRIVY_VERSION: version(/TRIVY_VERSION: "([\d.]+)"/), HOME: bin, ...env } }); return { ...r, calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) }; };
  const scan = stepRun('Scan the images');
  const gate = scan.calls.filter((c) => /--exit-code 1/.test(c));
  check(scan.status === 0 && gate.length === 2 && gate.every((c) => /--severity CRITICAL/.test(c) && /--ignore-unfixed/.test(c)) && scan.calls.filter((c) => !/--exit-code/.test(c) && /--severity HIGH,CRITICAL/.test(c)).length === 2, 'the scan step prints a HIGH and CRITICAL report and then gates on CRITICAL with fixes, for both images');
  check(scan.calls.every((c) => c.includes(`aquasec/trivy:${version(/TRIVY_VERSION: "([\d.]+)"/)} image`)) && scan.calls.some((c) => c.endsWith('docker.io/someone/todo-ui:abc1234')), 'the scan uses the pinned Trivy image on the images that were just built');
  check(stepRun('Scan the images', { FAIL_SCAN: '1' }).status !== 0, 'a failing gate fails the step (and so the pipeline)');
  const sign = stepRun('Sign the images');
  check(sign.status === 0 && sign.calls.filter((c) => c.startsWith('cosign sign --yes docker.io/someone/todo-')).length === 2 && sign.calls.every((c) => !c.startsWith('cosign') || /@sha256:abc123$/.test(c)), 'the signing step signs each image by digest (docker.io/<user>/todo-api@sha256:…), never by tag');
  // the tag commit still works
  const sed = stepsOf[idx('Put the new tag in the Helm chart')].run.split('\n').find((l) => l.includes('sed -i'));
  const sh = run('bash', ['-c', `cd "${dir}" && TAG=abc1234 && ${sed.trim()} && grep '^tag:' charts/todo/values.yaml`]);
  check(sh.stdout.trim() === 'tag: "abc1234"', "the pipeline's tag rewrite still works on values.yaml", sh.stdout + sh.stderr);

  // ---- the real scan gate, on the images the tutorial builds from
  const trivy = find('trivy');
  if (!trivy) skip('trivy not installed, the real scan was not run');
  else {
    const finalFrom = (f) => read(f).split('\n').filter((l) => /^FROM /.test(l)).pop().split(/\s+/)[1];
    const gateRun = (image) => run(trivy, ['image', '--quiet', '--no-progress', '--ignore-unfixed', '--severity', 'CRITICAL', '--exit-code', '1', image]);
    const results = [];
    for (const f of ['api/Dockerfile', 'ui/Dockerfile']) { const img = finalFrom(f); const r = gateRun(img); results.push([img, r]); }
    if (results.some(([, r]) => /FATAL|no space|connection|timeout/i.test(r.stderr + r.stdout) && r.status !== 0 && !/Total:/.test(r.stdout))) skip('the Trivy database could not be downloaded, the real scan was not run');
    else {
      for (const [img, r] of results) check(r.status === 0, `the scan gate passes today on the image part 1 builds from: ${img}`, r.stdout + r.stderr);
      const old = (/FROM <code>|nginxinc\/nginx-unprivileged:1\.20-alpine/.exec(page) || [])[0];
      const o = gateRun('nginxinc/nginx-unprivileged:1.20-alpine');
      check(old && o.status === 1 && /CRITICAL/.test(o.stdout) && /curl/.test(o.stdout), "drill D1: the old nginx image fails the gate, with critical issues in curl and libcurl, as the page says");
    }
  }

  // ---- pinned versions exist
  const hub = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '20', `https://hub.docker.com/v2/repositories/aquasec/trivy/tags/${version(/TRIVY_VERSION: "([\d.]+)"/)}`]);
  if (hub.stdout === '000') skip('no network, tool versions not checked');
  else {
    check(hub.stdout === '200', `the Trivy image tag ${version(/TRIVY_VERSION: "([\d.]+)"/)} exists on Docker Hub`);
    const tok = JSON.parse(run('curl', ['-s', '-m', '20', 'https://ghcr.io/token?scope=repository:sigstore/cosign/cosign:pull']).stdout || '{}').token;
    const man = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '20', '-H', `Authorization: Bearer ${tok}`, '-H', 'Accept: application/vnd.oci.image.index.v1+json', 'https://ghcr.io/v2/sigstore/cosign/cosign/manifests/v2.6.5']);
    check(man.stdout === '200', 'the cosign image tag v2.6.5 used by the verify command exists');
  }

  // ---- Argo CD Applications
  const apps = Object.fromEntries(['kyverno', 'policies', 'external-secrets', 'secret-store'].map((n) => [n, yamlDocs(read(`platform/apps/${n}.yaml`))[0]]));
  const todoText = read('platform/apps/todo.yaml');
  const todoNew = todoText.replace(/(\n  syncPolicy:\n)/, (m, a) => a + page.match(/<figcaption>infra\/platform\/apps\/todo\.yaml \(inside syncPolicy\)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/)[1].replace(/\n$/, '') + '\n');
  write('platform/apps/todo.yaml', todoNew);
  const todo = yamlDocs(todoNew)[0];
  const kc = find('kubeconform');
  if (kc) {
    const v = run(kc, ['-strict', '-summary', '-schema-location', 'default', '-schema-location', CRDS, 'platform/apps/kyverno.yaml', 'platform/apps/policies.yaml', 'platform/apps/external-secrets.yaml', 'platform/apps/secret-store.yaml', 'platform/apps/todo.yaml'], { cwd: dir });
    check(v.status === 0 && /Valid: 5/.test(v.stdout), 'the four new Applications and the updated todo Application are valid against the Argo CD schema', v.stdout + v.stderr);
  } else skip('kubeconform not installed');
  const repo = todo.spec.source.repoURL;
  check(todo.spec.syncPolicy.managedNamespaceMetadata.labels['pod-security.kubernetes.io/enforce'] === 'restricted' && todo.spec.syncPolicy.syncOptions.includes('CreateNamespace=true') && todo.spec.project === 'team-todo', 'todo.yaml labels its own namespace for the restricted standard, and stays in the team-todo project');
  check(apps.policies.spec.source.repoURL === repo && apps['secret-store'].spec.source.repoURL === repo && apps.policies.spec.source.path === 'infra/platform/policies' && exists('platform/policies/require-signed-images.yaml') && apps['secret-store'].spec.source.path === 'infra/platform/secret-store' && exists('platform/secret-store/store.yaml'), 'the policies and secret-store Applications point at this repo and at folders that exist');
  check(apps.kyverno.spec.source.chart === 'kyverno' && apps['external-secrets'].spec.source.chart === 'external-secrets' && apps.kyverno.spec.source.targetRevision === '3.9.1' && apps['external-secrets'].spec.source.targetRevision === '2.12.0', 'the Kyverno and External Secrets charts are pinned (3.9.1 and 2.12.0)');
  check(apps.kyverno.spec.syncPolicy.syncOptions.includes('ServerSideApply=true') && apps.policies.spec.syncPolicy.retry.limit >= 5 && apps.policies.spec.syncPolicy.syncOptions.includes('SkipDryRunOnMissingResource=true') && !apps['secret-store'].metadata.finalizers && apps.kyverno.metadata.finalizers && apps.policies.metadata.finalizers && apps['external-secrets'].metadata.finalizers, 'the policies wait for the engine with a retry, and only the secret store lacks the cascade-delete finalizer, as the page says');
  check(Object.values(apps).every((a) => a.spec.project === 'default' && a.spec.destination.server === 'https://kubernetes.default.svc'), 'the platform components stay in the default project');

  // ---- the chart with this part's changes applied as the page describes
  const helm = find('helm');
  const edit = (file, fn) => write(file, fn(read(file)));
  const psc = (caption) => page.match(new RegExp(`<figcaption>${caption.replace(/[()]/g, '\\$&')}</figcaption><pre><code>([\\s\\S]*?)</code></pre>`))[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const podBlock = (caption) => { const t = psc(caption); return { pod: t.slice(t.indexOf('      securityContext:'), t.indexOf('      containers:')), ctr: t.slice(t.indexOf('          securityContext:'), t.indexOf('          ports:')) }; };
  const secure = (file, caption) => edit(file, (t) => { const { pod, ctr } = podBlock(caption); return t.replace('    spec:\n      containers:', '    spec:\n' + pod + '      containers:').replace(/(          image: [^\n]*\n)/, (m) => m + ctr); });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-sec-base-')); fs.cpSync(path.join(dir, 'charts'), path.join(base, 'charts'), { recursive: true });   // before part 4's edits
  secure('charts/todo/templates/api.yaml', 'charts/todo/templates/api.yaml (the pod spec)');
  edit('charts/todo/templates/ui.yaml', (t) => { const { pod, ctr } = podBlock('charts/todo/templates/api.yaml (the pod spec)'); return t.replace('    spec:\n      containers:', '    spec:\n' + pod + '      containers:').replace(/(          image: [^\n]*\n)/, (m) => m + ctr); });   // "exactly the same two additions"
  secure('charts/todo/templates/db.yaml', 'charts/todo/templates/db.yaml (the StatefulSet\'s pod spec)');
  edit('charts/todo/templates/api.yaml', (t) => t.replace(/(            - name: MEMORY_HOG_MB\n              value: [^\n]*\n)/, (m) => m + psc('charts/todo/templates/api.yaml (add to env)').replace(/\n?$/, '\n')));
  if (!helm) skip('helm not installed');
  else {
    const render = (d) => { const r = run(helm, ['template', 'todo', 'charts/todo'], { cwd: d }); if (r.status !== 0) throw new Error(r.stderr); return yamlDocs(r.stdout); };
    const lint = run(helm, ['lint', '--strict', 'charts/todo'], { cwd: dir });
    check(lint.status === 0, 'helm lint --strict is clean with this part\'s chart changes', lint.stdout + lint.stderr);
    const docs = render(dir);
    const before = podsOf(render(base)).flatMap((p) => restrictedViolations(p).map((x) => `${p.name}: ${x}`));
    check(before.some((x) => x.startsWith('todo-db')) && before.some((x) => x.startsWith('todo-api')) && before.some((x) => x.startsWith('todo-ui')), 'before step 6, all three workloads would break the restricted standard (the dry run in the page would list them)', before.join('\n'));
    const after = podsOf(docs).flatMap((p) => restrictedViolations(p).map((x) => `${p.name}: ${x}`));
    check(after.length === 0, 'after the edits in step 6, the API, the UI and the database all meet the restricted standard', after.join('\n'));
    const db = podsOf(docs).find((p) => p.name === 'todo-db');
    check(db.spec.securityContext.runAsUser === 999 && db.spec.securityContext.fsGroup === 999 && db.spec.containers[0].env.some((e) => e.name === 'PGDATA' && /pgdata$/.test(e.value)), 'the database starts as uid 999 with a group-writable data disk, and keeps its PGDATA subfolder');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-sec-priv-')); fs.cpSync(path.join(dir, 'charts'), path.join(d, 'charts'), { recursive: true });
    const apiYaml = fs.readFileSync(path.join(d, 'charts/todo/templates/api.yaml'), 'utf8').replace('            allowPrivilegeEscalation: false', '            privileged: true\n            allowPrivilegeEscalation: false');
    fs.writeFileSync(path.join(d, 'charts/todo/templates/api.yaml'), apiYaml);
    check(podsOf(render(d)).flatMap((p) => restrictedViolations(p)).some((x) => /privileged/.test(x)), 'drill: privileged: true on the API container breaks the standard');

    // network policies
    const policies = docs.filter((x) => x.kind === 'NetworkPolicy');
    const rendered = run(helm, ['template', 'todo', 'charts/todo'], { cwd: dir }).stdout; write('rendered.yaml', rendered);
    if (kc) { const v = run(kc, ['-strict', '-summary', 'rendered.yaml'], { cwd: dir, env: process.env }); const ign = run(kc, ['-strict', '-summary', '-ignore-missing-schemas', 'rendered.yaml'], { cwd: dir }); check(ign.status === 0 && /NetworkPolicy|Valid/.test(ign.stdout), 'the NetworkPolicies are valid Kubernetes objects', ign.stdout + ign.stderr); void v; }
    check(policies.length === 5 && ['default-deny-ingress', 'gateway-from-anywhere', 'ui-from-gateway', 'api-allowed-callers', 'db-from-api'].every((n) => policies.some((p) => p.metadata.name === n)), 'the chart carries the five policies the page describes');
    const pods = Object.fromEntries(podsOf(docs).map((p) => [p.name.replace('todo-', ''), { ns: 'todo', labels: p.labels }]));
    const who = { ...pods, gateway: { ns: 'todo', labels: { 'gateway.networking.k8s.io/gateway-name': 'todo' } }, probe: { ns: 'default', labels: { run: 'probe' } }, loadgen: { ns: 'loadgen', labels: { app: 'loadgen' } }, monitoring: { ns: 'monitoring', labels: { app: 'prometheus' } } };
    const flows = [['gateway', 'ui', 8080, true], ['gateway', 'api', 8080, true], ['probe', 'gateway', 80, true], ['api', 'db', 5432, true], ['loadgen', 'api', 8080, true], ['monitoring', 'api', 8080, true], ['ui', 'api', 8080, true],
      ['probe', 'api', 8080, false], ['probe', 'ui', 8080, false], ['probe', 'db', 5432, false], ['ui', 'db', 5432, false], ['gateway', 'db', 5432, false], ['loadgen', 'db', 5432, false], ['monitoring', 'db', 5432, false], ['api', 'db', 8080, false], ['loadgen', 'ui', 8080, false]];
    const wrong = (pol) => flows.filter(([f, t, port, want]) => ingressAllowed(pol, who[f], who[t], port) !== want).map(([f, t, port, want]) => `${f} -> ${t}:${port} should be ${want ? 'allowed' : 'blocked'}`);
    check(wrong(policies).length === 0, `with the policies in place, the gateway, UI, load generator, Prometheus and API database connection work, and the probe in the default namespace is blocked from the API, UI and database (${flows.length} flows)`, wrong(policies).join('\n'));
    const without = (name, fix) => policies.map((p) => (p.metadata.name === name ? fix(JSON.parse(JSON.stringify(p))) : p)).filter(Boolean);
    const noMon = without('api-allowed-callers', (p) => { p.spec.ingress.pop(); return p; });
    check(!ingressAllowed(noMon, who.monitoring, who.api, 8080) && ingressAllowed(noMon, who.gateway, who.api, 8080) && ingressAllowed(noMon, who.loadgen, who.api, 8080), 'drill: without the monitoring block only Prometheus loses access to the API');
    const noDb = without('db-from-api', () => null);
    check(!ingressAllowed(noDb, who.api, who.db, 5432) && ingressAllowed(noDb, who.gateway, who.api, 8080), 'drill: without the database policy the API cannot reach its database, while everything else still works');
    check(!ingressAllowed(policies.filter((p) => p.metadata.name !== 'gateway-from-anywhere'), who.probe, who.gateway, 80), 'without the gateway rule, the front door would be closed too (the page\'s troubleshooting row)');
    // the label the gateway rule relies on is what NGINX Gateway Fabric puts on its pod
    const src = run('curl', ['-s', '-m', '20', 'https://raw.githubusercontent.com/nginx/nginx-gateway-fabric/v2.7.2/internal/controller/state/../../framework/controller/labels.go']);
    if (src.stdout.includes('GatewayLabel')) check(/GatewayLabel\s*=\s*"gateway\.networking\.k8s\.io\/gateway-name"/.test(src.stdout), 'NGINX Gateway Fabric 2.7.2 labels the pod it creates with gateway.networking.k8s.io/gateway-name');
    else skip('could not read the NGINX Gateway Fabric source, the pod label was not checked');

    // ---- External Secrets objects and Kyverno policy against their CRD schemas
    const crdOf = (out, kind) => yamlDocs(out).find((x) => x.kind === 'CustomResourceDefinition' && x.spec.names.kind === kind);
    const kyv = run(helm, ['template', 'kyverno', 'kyverno', '--repo', 'https://kyverno.github.io/kyverno/', '--version', '3.9.1', '-n', 'kyverno']);
    const eso = run(helm, ['template', 'external-secrets', 'external-secrets', '--repo', 'https://charts.external-secrets.io', '--version', '2.12.0', '-n', 'external-secrets']);
    if ([kyv, eso].some((r) => r.status !== 0 && NETWORK_ERR.test(r.stderr))) skip('no network, the Kyverno and External Secrets charts were not rendered');
    else {
      check(kyv.status === 0 && eso.status === 0, 'the Kyverno 3.9.1 and External Secrets 2.12.0 charts render', kyv.stderr + eso.stderr);
      const policy = yamlDocs(read('platform/policies/require-signed-images.yaml'))[0];
      const kcrd = crdOf(kyv.stdout, 'ClusterPolicy');
      const pp = schemaProblems(kcrd, policy);
      check(pp.length === 0, 'the ClusterPolicy uses only fields, types and values the Kyverno CRD accepts', pp.join('\n'));
      const typo = JSON.parse(JSON.stringify(policy)); typo.spec.rules[0].verifyImages[0].failureActon = 'Audit';
      check(schemaProblems(kcrd, typo).some((e) => /failureActon/.test(e)), 'control: the schema check does notice a misspelled field');
      const rule = policy.spec.rules[0].verifyImages[0];
      check(rule.failureAction === 'Audit' && rule.mutateDigest === false && rule.verifyDigest === false && /^docker\.io\/<your-dockerhub-user>\/\*$/.test(rule.imageReferences[0]) && /\/infra-setup\/\.github\/workflows\/ci\.yml@refs\/heads\/main$/.test(rule.attestors[0].entries[0].keyless.subject) && rule.attestors[0].entries[0].keyless.issuer === 'https://token.actions.githubusercontent.com', 'the policy starts in Audit, matches only your Docker Hub images and names the ci.yml workflow on main as the signer');
      check(bash.includes('--certificate-identity "https://github.com/<YourUser>/infra-setup/.github/workflows/ci.yml@refs/heads/main"') && rule.attestors[0].entries[0].keyless.subject.replace(/<YourUser>/, '') === 'https://github.com//infra-setup/.github/workflows/ci.yml@refs/heads/main', 'the cosign verify command and the policy ask for the same signer');
      for (const kind of ['SecretStore', 'ExternalSecret']) {
        const obj = yamlDocs(read('charts/todo/templates/secrets.yaml')).find((x) => x.kind === kind);
        const probs = schemaProblems(crdOf(eso.stdout, kind), obj);
        check(probs.length === 0, `the ${kind} uses only fields the External Secrets 2.12.0 CRD accepts (apiVersion ${obj.apiVersion})`, probs.join('\n'));
      }
    }
    // the secret chain: store -> remote key -> Kubernetes Secret -> environment variable
    const sec = yamlDocs(read('charts/todo/templates/secrets.yaml')), store = yamlDocs(read('platform/secret-store/store.yaml'));
    const es = sec.find((x) => x.kind === 'ExternalSecret'), ss = sec.find((x) => x.kind === 'SecretStore'), sa = sec.find((x) => x.kind === 'ServiceAccount');
    const bind = store.find((x) => x.kind === 'RoleBinding'), role = store.find((x) => x.kind === 'Role');
    const apiEnv = podsOf(render(dir)).find((p) => p.name === 'todo-api').spec.containers[0].env.find((e) => e.name === 'NOTIFY_API_KEY');
    const literal = /create secret generic (\S+) \\\n\s+--from-literal=(\w+)=/.exec(bash);
    check(ss.spec.provider.kubernetes.remoteNamespace === store.find((x) => x.kind === 'Namespace').metadata.name && ss.spec.provider.kubernetes.auth.serviceAccount.name === sa.metadata.name && bind.subjects[0].name === sa.metadata.name && bind.subjects[0].namespace === 'todo' && bind.roleRef.name === role.metadata.name && role.metadata.namespace === ss.spec.provider.kubernetes.remoteNamespace && role.rules[0].resources[0] === 'secrets' && !role.rules[0].verbs.includes('delete'), 'the store namespace, the service account that reads it and the read-only Role binding all agree');
    check(literal && es.spec.data[0].remoteRef.key === literal[1] && es.spec.data[0].remoteRef.property === literal[2] && es.spec.target.name === apiEnv.valueFrom.secretKeyRef.name && es.spec.data[0].secretKey === apiEnv.valueFrom.secretKeyRef.key && apiEnv.valueFrom.secretKeyRef.optional === true && es.spec.secretStoreRef.name === ss.metadata.name, `the chain holds together: the hand-made secret (${literal && literal[1]}, key ${literal && literal[2]}) -> the ExternalSecret -> the Kubernetes Secret -> NOTIFY_API_KEY, optional so the API starts without it`);
  }

  // ---- the API change
  const dotnet = find('dotnet');
  if (!dotnet) skip('.NET SDK not installed, the fingerprint change was not built');
  else {
    const work = path.join(dir, 'infra-setup'); fs.mkdirSync(work, { recursive: true });
    const env = { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT || '1' };
    const p2bash = bashBlocks(P('eyes-on-the-cluster-tutorial.html')).map((b) => b.code).join('\n');
    const adds = ['dotnet add api package Npgsql', ...p2bash.split('\n').filter((l) => /^dotnet add package /.test(l)).map((l) => l.replace('dotnet add ', 'dotnet add api '))];
    let ok = run(dotnet, ['new', 'web', '-n', 'Todo.Api', '-o', 'api', '--force'], { cwd: work, env }).status === 0;
    for (const a of adds) ok = ok && run(dotnet, a.split(' ').slice(1), { cwd: work, env }).status === 0;
    const snippet = psc('src/api/Program.cs (changes only)');
    const usings = snippet.slice(0, snippet.indexOf('// …')).trim();
    const endpoint = snippet.slice(snippet.indexOf('app.MapGet("/api/info"')).trim();
    let prog = read('api/Program.cs');
    prog = usings + '\n' + prog.replace(/app\.MapGet\("\/api\/info"[\s\S]*?\n\}\);/, () => endpoint);
    fs.writeFileSync(path.join(work, 'api', 'Program.cs'), prog);
    const build = ok && run(dotnet, ['build', '-c', 'Release', '-warnaserror'], { cwd: path.join(work, 'api'), env });
    check(ok && build.status === 0, "Part 2's Program.cs with the two usings and the new /api/info endpoint builds with no warnings", build && (build.stdout || '').split('\n').filter((l) => /error|warn/i.test(l)).join('\n'));
    if (ok && build.status === 0) {
      const rel = path.join(work, 'api', 'bin', 'Release'), dll = fs.readdirSync(rel).map((x) => path.join(rel, x, 'Todo.Api.dll')).find((x) => fs.existsSync(x));
      const base = 5900 + Math.floor(Math.random() * 90);
      const info = async (port, extra) => {
        const p = spawn(dotnet, [dll, '--urls', `http://localhost:${port}`], { cwd: path.join(work, 'api'), env: { ...env, ASPNETCORE_ENVIRONMENT: 'Production', ConnectionStrings__Todos: 'Host=localhost;Port=5999;Database=todo;Username=todo;Password=x;Timeout=2', ...extra }, stdio: 'ignore' });
        try { for (let i = 0; i < 80; i++) { const r = await get(`http://localhost:${port}/api/info`); if (r.status > 0) return JSON.parse(r.body); await sleep(250); } } finally { p.kill(); }
        return null;
      };
      const withKey = await info(base, { NOTIFY_API_KEY: 'first-key-0001' }), noKey = await info(base + 1, {});
      const want = crypto.createHash('sha256').update('first-key-0001').digest('hex').slice(0, 8).toUpperCase();
      check(withKey && withKey.notifyKey === want && !JSON.stringify(withKey).includes('first-key-0001'), `/api/info shows the key's fingerprint (${want}) and never the key itself`, JSON.stringify(withKey));
      check(noKey && noKey.notifyKey === 'not set' && noKey.version, '/api/info says "not set" when there is no key, and still reports the version');
      check(withKey && withKey.notifyKey !== crypto.createHash('sha256').update('second-key-0002').digest('hex').slice(0, 8).toUpperCase(), 'a rotated key has a different fingerprint (the drill compares them)');
    }
  }

  // ---- the pull request check, with Kyverno and External Secrets added as the page says
  const yq = find('yq');
  if (!helm || !yq) skip('helm or yq not installed, the pull request check was not run');
  else {
    const pc = yamlDocs(fs.readFileSync(P('platform-as-code-tutorial.html'), 'utf8') && read('.github/workflows/platform-check.yml'))[0].jobs.render.steps;
    const additions = [...page.matchAll(/<figcaption>\.github\/workflows\/platform-check\.yml \(two (?:more )?additions\)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1].replace(/&gt;/g, '>').split(/\n\s*\n/).map((s) => s.replace(/\s+$/, '')));
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-sec-repo-'));
    fs.cpSync(path.join(dir, 'platform'), path.join(repoDir, 'infra', 'platform'), { recursive: true }); fs.cpSync(path.join(dir, 'charts'), path.join(repoDir, 'charts'), { recursive: true });
    const script = (name) => pc.find((s) => s.name === name).run;
    const addRepo = script('Add chart repositories') + '\n' + additions.map((a) => a[0]).join('\n');
    const addTpl = script('Render the platform charts') + '\n' + additions.map((a) => a[1]).join('\n');
    const penv = { ...process.env, PATH: path.dirname(yq) + path.delimiter + path.dirname(helm) + path.delimiter + process.env.PATH };
    check(additions.length === 2, 'the page gives two additions to the pull request check (Kyverno, then External Secrets)');
    const r1 = run('bash', ['-ec', addRepo], { cwd: repoDir, env: penv });
    if (r1.status !== 0) skip('no network, the pull request check was not run: ' + r1.stderr.split('\n')[0]);
    else {
      const r2 = run('bash', ['-ec', addTpl], { cwd: repoDir, env: penv });
      check(r2.status === 0, 'the pull request check, with both additions, renders all five platform charts at their pinned versions', r2.stderr);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(summary());
}

main().catch((e) => { console.error(e); process.exit(1); });
