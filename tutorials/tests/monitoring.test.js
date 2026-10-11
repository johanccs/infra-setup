// Builds and checks everything Part 2 (Eyes on the Cluster) tells the reader to create, exactly as written on the page:
// the API with metrics and fault switches, the chart changes, the alert rules, the dashboard and the Loki/Alloy/Prometheus values.
//   node tests/monitoring.test.js
// Tools are looked up on PATH, or in the folder named by TOOLS_DIR: helm, kubeconform, promtool, alloy and the .NET SDK.
// Anything that is not installed is skipped and reported. Chart checks need network access (they fetch the pinned charts).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');
const { extract, bashBlocks, blocksCaptioned } = require('./extract');

const DOCS = path.join(__dirname, '..', 'docs');
const FILE = path.join(DOCS, 'eyes-on-the-cluster-tutorial.html');
const TOOLS = process.env.TOOLS_DIR || '';
let fails = 0, passes = 0, skips = 0;
const check = (ok, msg, detail) => { if (ok) passes++; else fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && detail ? '\n' + String(detail).trim().split('\n').map((l) => '     ' + l).join('\n') : '')); };
const skip = (msg) => { skips++; console.log('SKIP ' + msg); };

function find(tool) {
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  if (TOOLS) {
    const dirs = [TOOLS, ...fs.readdirSync(TOOLS).map((d) => path.join(TOOLS, d)).filter((d) => fs.statSync(d).isDirectory())];
    for (const dir of dirs) for (const name of [tool, tool + '.exe']) if (isFile(path.join(dir, name))) return path.join(dir, name);
  }
  const r = spawnSync('which', [tool], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const get = (url, opts = {}) => new Promise((resolve) => {
  const r = http.request(url, { method: opts.method || 'GET', headers: { 'content-type': 'application/json' } }, (res) => {
    let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  r.on('error', () => resolve({ status: 0, body: '' }));
  r.end(opts.body);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yamlDocs = (text) => {
  const r = run('python3', ['-c', 'import sys,yaml,json; print(json.dumps([d for d in yaml.safe_load_all(sys.stdin) if d]))'], { input: text });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const CRDS = 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json';

async function main() {
  const page = fs.readFileSync(FILE, 'utf8');
  const bash = bashBlocks(FILE).map((b) => b.code).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-mon-'));
  // Code to Cluster's files first; this part then replaces some of them and adds the rest.
  extract(path.join(DOCS, 'code-to-cluster-tutorial.html'), dir);
  const files = extract(FILE, dir);
  const need = ['api/Program.cs', 'charts/todo/values.yaml', 'charts/todo/templates/api.yaml', 'charts/todo/templates/servicemonitor.yaml', 'charts/todo/templates/alerts.yaml', 'charts/todo/templates/dashboard.yaml', 'charts/todo/dashboards/todo-api.json', 'platform/monitoring-values.yaml', 'platform/loadgen.yaml', 'platform/loki-values.yaml', 'platform/alloy-values.yaml'];
  check(need.every((f) => files.includes(f)), 'every file the tutorial asks for is on the page', need.filter((f) => !files.includes(f)).join(', '));
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  // ---- shell and page conventions
  const bad = bashBlocks(FILE).filter((b) => run('bash', ['-n'], { input: b.code.replace(/<[^>\n]+>/g, 'X') }).status !== 0);
  check(bad.length === 0, 'every bash block is valid shell syntax', bad.map((b) => b.code.split('\n')[0]).join('\n'));
  check(!/todo-app|ghcr\.io\/YOUR|port-forward svc\/todo-ui/.test(page.replace(/oci:\/\/ghcr\.io\/nginx/g, '')), 'no leftovers from the older layout (todo-app folder, GHCR images, a UI port-forward)');
  for (const [chart, ver] of [['kube-prometheus-stack', '92.3.0'], ['grafana/loki', '7.3.0'], ['grafana/alloy', '1.13.1']]) {
    check(new RegExp(`helm upgrade --install \\w+ [\\w-]+/${chart.split('/').pop()} --version ${ver.replace(/\./g, '\\.')}`).test(bash), `the ${chart.split('/').pop()} chart is pinned to ${ver}`);
  }

  // ---- the chart: Part 1's chart plus this part's changes
  const helm = find('helm');
  if (!helm) skip('helm not installed');
  else {
    const lint = run(helm, ['lint', 'charts/todo'], { cwd: dir });
    check(lint.status === 0 && /0 chart\(s\) failed/.test(lint.stdout), 'helm lint reports 0 chart(s) failed', lint.stdout + lint.stderr);
    const tpl = run(helm, ['template', 'todo', 'charts/todo'], { cwd: dir });
    check(tpl.status === 0, 'helm template renders', tpl.stderr);
    fs.writeFileSync(path.join(dir, 'rendered.yaml'), tpl.stdout);
    const docs = yamlDocs(tpl.stdout);
    const kc = find('kubeconform');
    if (kc) {
      const v = run(kc, ['-strict', '-summary', '-ignore-missing-schemas', '-schema-location', 'default', '-schema-location', CRDS, 'rendered.yaml'], { cwd: dir });
      check(v.status === 0 && /Skipped: 0/.test(v.stdout), 'ServiceMonitor, PrometheusRule and the rest are valid against their schemas', v.stdout + v.stderr);
    } else skip('kubeconform not installed');

    const dep = docs.find((d) => d.kind === 'Deployment' && d.metadata.name === 'todo-api');
    const svc = docs.find((d) => d.kind === 'Service' && d.metadata.name === 'todo-api');
    const sm = docs.find((d) => d.kind === 'ServiceMonitor');
    const c = dep.spec.template.spec.containers[0];
    const env = Object.fromEntries(c.env.map((e) => [e.name, e.value]));
    check(['FAULT_RATE', 'SLOW_MS', 'MEMORY_HOG_MB'].every((k) => k in env) && env.FAULT_RATE === '0' && env.SLOW_MS === '0' && env.MEMORY_HOG_MB === '0', 'the three fault switches reach the container and default to off');
    check(c.env.some((e) => e.name === 'ConnectionStrings__Todos') && c.readinessProbe.httpGet.path === '/readyz' && c.livenessProbe.httpGet.path === '/healthz', 'the API keeps its database connection and its two probes from Part 1');
    check(c.ports[0].name === 'http' && svc.spec.ports[0].name === 'http' && svc.metadata.labels.app === 'todo-api', 'the container port and the Service port are named http, and the Service is labelled');
    check(sm.spec.selector.matchLabels.app === svc.metadata.labels.app && sm.spec.endpoints[0].port === svc.spec.ports[0].name && sm.spec.endpoints[0].path === '/metrics', 'the ServiceMonitor finds the Service by label and its port by name');
    check(/^tag: ".*"$/m.test(read('charts/todo/values.yaml')) && /^registry: docker\.io\//m.test(read('charts/todo/values.yaml')) && /^db:/m.test(read('charts/todo/values.yaml')), "values.yaml keeps the tag line the pipeline rewrites, the Docker Hub registry and the db block");

    // dashboard
    const dash = JSON.parse(read('charts/todo/dashboards/todo-api.json'));
    const uids = new Set(dash.panels.map((p) => p.datasource.uid));
    check(dash.panels.length === 6 && [...uids].every((u) => u === 'prometheus' || u === 'loki'), 'the dashboard JSON parses and uses only the prometheus and loki data sources');
    const cm = docs.find((d) => d.kind === 'ConfigMap' && d.metadata.name === 'todo-api-dashboard');
    check(cm && cm.metadata.labels.grafana_dashboard === '1' && JSON.parse(cm.data['todo-api.json']).title === 'Todo API' && cm.data['todo-api.json'].includes('{{http_request_method}}'), "the dashboard ConfigMap carries Grafana's label and the JSON arrives intact (its {{placeholders}} are not touched by Helm)");

    // ---- the monitoring charts, rendered with the tutorial's own values and pinned versions
    const render = (name, chart, repo, ver, values, ns) => run(helm, ['template', name, chart, '--repo', repo, '--version', ver, '-n', ns, '-f', path.join(dir, values)], { cwd: dir });
    const prom = render('mon', 'kube-prometheus-stack', 'https://prometheus-community.github.io/helm-charts', '92.3.0', 'platform/monitoring-values.yaml', 'monitoring');
    if (prom.status !== 0 && /dial tcp|no such host|Could not resolve|connection refused|timeout/i.test(prom.stderr)) skip('no network, so the monitoring charts were not rendered');
    else {
      check(prom.status === 0, 'kube-prometheus-stack 92.3.0 renders with infra/platform/monitoring-values.yaml', prom.stderr);
      check(/uid: prometheus\b/.test(prom.stdout) && /uid: loki\b/.test(prom.stdout) && /url: http:\/\/loki-gateway\.monitoring\.svc\.cluster\.local/.test(prom.stdout), 'Grafana gets the prometheus and loki data sources the dashboard refers to');
      check(/name: mon-grafana\b/.test(prom.stdout), 'the Grafana Service is called mon-grafana (the port-forward in step 3)');
      const pcr = yamlDocs(prom.stdout).find((d) => d.kind === 'Prometheus');
      check(pcr.spec.scrapeInterval === '15s' && pcr.spec.retention === '2d', 'Prometheus gets the 15s scrape interval and 2 days of retention');
      check(JSON.stringify(pcr.spec.serviceMonitorSelector) === '{}' && JSON.stringify(pcr.spec.ruleSelector) === '{}', "Prometheus watches every ServiceMonitor and rule, so the app's chart does not need the release name");
      const loki = render('loki', 'loki', 'https://grafana.github.io/helm-charts', '7.3.0', 'platform/loki-values.yaml', 'monitoring');
      check(loki.status === 0 && /name: loki-gateway\b/.test(loki.stdout), 'Loki 7.3.0 renders with infra/platform/loki-values.yaml and has the loki-gateway Service Alloy and Grafana call', loki.stderr);
      const alloy = render('alloy', 'alloy', 'https://grafana.github.io/helm-charts', '1.13.1', 'platform/alloy-values.yaml', 'monitoring');
      check(alloy.status === 0 && /loki\.source\.kubernetes "pods"/.test(alloy.stdout), 'Alloy 1.13.1 renders with infra/platform/alloy-values.yaml and carries the pipeline', alloy.stderr);
    }
    // the same pods names the page talks about
    check(!/name: loadgen\b/.test(tpl.stdout) && /namespace: loadgen/.test(read('platform/loadgen.yaml')), 'the load generator lives in its own namespace, outside the Helm chart Argo CD owns');

    // ---- alert rules and every query on the page
    const promtool = find('promtool');
    if (!promtool) skip('promtool not installed, alert rules and queries not checked');
    else {
      const rule = docs.find((d) => d.kind === 'PrometheusRule');
      const alerts = rule.spec.groups.flatMap((g) => g.rules).filter((r) => r.alert).map((r) => r.alert);
      check(['TodoApiHighErrorRate', 'TodoApiSlow', 'TodoApiDown', 'TodoApiRestarting', 'TodoApiErrorBudgetBurn'].every((a) => alerts.includes(a)), 'the chart carries all five alerts the page describes', alerts.join(', '));
      fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify({ groups: rule.spec.groups }));
      const chk = run(promtool, ['check', 'rules', 'rules.json'], { cwd: dir });
      check(chk.status === 0, 'promtool accepts the alert and recording rules', chk.stdout + chk.stderr);
      // every other PromQL on the page and in the dashboard parses
      const queries = [
        ...blocksCaptioned(FILE, /^PromQL$/).flatMap((b) => b.split(/\n\s*\n/)).map((q) => q.trim()).filter(Boolean),
        ...dash.panels.filter((p) => p.datasource.uid === 'prometheus').flatMap((p) => p.targets.map((t) => t.expr)),
      ].filter((q) => !/^up$/.test(q));
      fs.writeFileSync(path.join(dir, 'queries.json'), JSON.stringify({ groups: [{ name: 'q', rules: queries.map((q, i) => ({ record: 'q' + i, expr: q })) }] }));
      const qc = run(promtool, ['check', 'rules', 'queries.json'], { cwd: dir });
      check(qc.status === 0 && queries.length >= 9, `all ${queries.length} PromQL queries on the page and in the dashboard parse`, qc.stdout + qc.stderr);

      // the alerts behave as the page says, tested on synthetic series
      const ok = 'http_server_request_duration_seconds_count{job="todo-api",http_route="/api/todos/",http_response_status_code="200"}';
      const err = 'http_server_request_duration_seconds_count{job="todo-api",http_route="/api/todos/",http_response_status_code="500"}';
      const sumry = (n) => rule.spec.groups.flatMap((g) => g.rules).find((r) => r.alert === n).annotations.summary;
      const unit = (tests) => ({ rule_files: ['rules.json'], evaluation_interval: '30s', tests });
      const firing = (alertname, sev, extra) => ({ eval_time: '', alertname, exp_alerts: [{ exp_labels: { severity: sev, ...(extra || {}) }, exp_annotations: { summary: sumry(alertname) } }] });
      const at = (t, spec) => ({ ...spec, eval_time: t });
      const t = [
        { name: 'healthy traffic: nothing fires', interval: '15s',
          input_series: [{ series: ok, values: '0+8x400' }, { series: 'up{job="todo-api"}', values: '1x400' }],
          alert_rule_test: ['TodoApiHighErrorRate', 'TodoApiErrorBudgetBurn', 'TodoApiDown'].map((a) => ({ eval_time: '30m', alertname: a, exp_alerts: [] })) },
        { name: '20% of requests fail: the error alert fires', interval: '15s',
          input_series: [{ series: ok, values: '0+8x400' }, { series: err, values: '0+2x400' }, { series: 'up{job="todo-api"}', values: '1x400' }],
          alert_rule_test: [at('10m', firing('TodoApiHighErrorRate', 'warning'))] },
        { name: 'the target vanishes: absent() catches it', interval: '15s',
          input_series: [{ series: 'up{job="todo-api"}', values: '1x20 _x300' }],
          alert_rule_test: [at('15m', firing('TodoApiDown', 'critical'))] },
        { name: 'half of requests fail for an hour: the budget alert fires too', interval: '15s',
          input_series: [{ series: ok, values: '0+4x600' }, { series: err, values: '0+4x600' }, { series: 'up{job="todo-api"}', values: '1x600' }],
          alert_rule_test: [at('75m', firing('TodoApiErrorBudgetBurn', 'critical'))] },
        { name: 'a five minute blip pages nobody', interval: '15s',
          input_series: [{ series: ok, values: '0+8x240 1920+8x400' }, { series: err, values: '0x240 0+8x20 160x400' }, { series: 'up{job="todo-api"}', values: '1x700' }],
          alert_rule_test: [{ eval_time: '63m', alertname: 'TodoApiErrorBudgetBurn', exp_alerts: [] }] },
      ];
      fs.writeFileSync(path.join(dir, 'alerts.test.json'), JSON.stringify(unit(t)));
      const ut = run(promtool, ['test', 'rules', 'alerts.test.json'], { cwd: dir });
      check(ut.status === 0, 'unit test: healthy traffic is quiet; failures, a vanished target and a sustained burn fire; a short blip does not page', ut.stdout + ut.stderr);
    }
  }

  // ---- Alloy config
  const alloy = find('alloy');
  if (!alloy) skip('alloy not installed, the log pipeline config was not validated');
  else {
    const cfg = yamlDocs(read('platform/alloy-values.yaml'))[0].alloy.configMap.content;
    fs.writeFileSync(path.join(dir, 'alloy.cfg'), cfg);
    const v = run(alloy, ['validate', 'alloy.cfg'], { cwd: dir });
    check(v.status === 0, 'Grafana Alloy accepts the log pipeline config', v.stdout + v.stderr);
    check(/loki-gateway\.monitoring\.svc\.cluster\.local\/loki\/api\/v1\/push/.test(cfg) && /app/.test(cfg), 'Alloy pushes to the loki-gateway Service and keeps the app label the LogQL queries use');
  }

  // ---- the API: build and run it as written
  const dotnet = find('dotnet');
  if (!dotnet) skip('.NET SDK not installed, API not built');
  else await apiTest(dir, dotnet, bash);
  console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
}

async function apiTest(dir, dotnet, bash) {
  const work = path.join(dir, 'infra-setup');
  fs.mkdirSync(work, { recursive: true });
  const env = { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT || '1' };
  const made = run(dotnet, ['new', 'web', '-n', 'Todo.Api', '-o', 'api', '--force'], { cwd: work, env });
  check(made.status === 0, 'dotnet new web -n Todo.Api -o api', made.stdout + made.stderr);
  const adds = ['dotnet add api package Npgsql', ...bash.split('\n').filter((l) => /^dotnet add package /.test(l)).map((l) => l.replace('dotnet add ', 'dotnet add api '))];
  check(adds.length === 4, 'the page adds three OpenTelemetry packages on top of Npgsql', adds.join('\n'));
  let added = true;
  for (const a of adds) { const r = run(dotnet, a.split(' ').slice(1), { cwd: work, env }); if (r.status !== 0) { added = false; check(false, a, r.stdout + r.stderr); } }
  check(added, 'every dotnet add package command from the page succeeds');
  fs.copyFileSync(path.join(dir, 'api', 'Program.cs'), path.join(work, 'api', 'Program.cs'));
  const build = run(dotnet, ['build', '-c', 'Release', '-warnaserror'], { cwd: path.join(work, 'api'), env });
  check(build.status === 0, "the tutorial's Program.cs builds with no warnings", build.stdout.split('\n').filter((l) => /error|warn/i.test(l)).join('\n'));
  if (build.status !== 0) return;

  const dll = path.join(work, 'api', 'bin', 'Release');
  const dllPath = fs.readdirSync(dll).map((d) => path.join(dll, d, 'Todo.Api.dll')).find((p) => fs.existsSync(p));
  const base = 5600 + Math.floor(Math.random() * 300);
  const noDb = 'Host=localhost;Port=5999;Database=todo;Username=todo;Password=x;Timeout=2';
  const start = (port, extra) => {
    const log = [];
    const p = spawn(dotnet, [dllPath, '--urls', `http://localhost:${port}`], { cwd: path.join(work, 'api'), env: { ...env, ASPNETCORE_ENVIRONMENT: 'Production', APP_VERSION: 'hello', ConnectionStrings__Todos: noDb, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => log.push(String(d))); p.stderr.on('data', (d) => log.push(String(d)));
    return { p, log, exit: new Promise((r) => p.on('exit', (code, signal) => r(code === null ? signal : code))) };
  };
  const waitFor = async (port, p) => { for (let i = 0; i < 80; i++) { if ((await get(`http://localhost:${port}${p}`)).status > 0) return true; await sleep(250); } return false; };
  const url = (port, p) => `http://localhost:${port}${p}`;

  // normal run, database down: metrics and health still work
  let s = start(base, {});
  try {
    check(await waitFor(base, '/healthz'), 'the API starts');
    check((await get(url(base, '/healthz'))).status === 200 && (await get(url(base, '/readyz'))).status === 503, '/healthz is 200 and /readyz is 503 while the database is down (as in Part 1)');
    await get(url(base, '/api/info'));
    const m = (await get(url(base, '/metrics'))).body;
    check(/^http_server_request_duration_seconds_count\{[^}]*http_route="\/api\/info"/m.test(m), '/metrics serves http_server_request_duration_seconds_count with a http_route label');
    check(/^http_server_request_duration_seconds_bucket\{[^}]*le="0\.005"/m.test(m), '/metrics serves the duration histogram buckets (needed for p95)');
    const first = s.log.join('').split('\n').find((l) => l.startsWith('{'));
    check(first && JSON.parse(first).LogLevel && JSON.parse(first).Message, 'log lines are JSON with LogLevel and Message fields (what the LogQL in step 8 reads)', first);
  } finally { s.p.kill(); await s.exit; }

  // fault switches
  s = start(base + 1, { FAULT_RATE: '1', SLOW_MS: '300' });
  try {
    await waitFor(base + 1, '/healthz');
    const t0 = Date.now();
    const r = await get(url(base + 1, '/api/todos'));
    const took = Date.now() - t0;
    check(r.status === 500 && took >= 280, `FAULT_RATE=1 fails /api/todos requests, and SLOW_MS=300 delays them first (${took} ms)`, r.status);
    check((await get(url(base + 1, '/api/info'))).status === 200 && (await get(url(base + 1, '/healthz'))).status === 200, 'the fault filter leaves /api/info and /healthz alone, so the app still looks healthy');
    const m = (await get(url(base + 1, '/metrics'))).body;
    check(/http_server_request_duration_seconds_count\{[^}]*http_response_status_code="500"[^}]*http_route="\/api\/todos\/"/.test(m), 'the 500s show up in the metric with status 500 and route /api/todos/ (the labels the queries filter on)');
    const line = s.log.join('').split('\n').find((l) => l.includes('Injected fault'));
    check(line && JSON.parse(line).LogLevel === 'Error' && JSON.parse(line).Message === 'Injected fault on GET /api/todos', 'each injected failure logs an Error line "Injected fault on GET /api/todos"', line);
  } finally { s.p.kill(); await s.exit; }

  // memory hog: with a 192 MiB heap cap (75% of a 256 MiB container limit) 250 MB cannot start, 100 MB can
  const cap = { DOTNET_GCHeapHardLimit: '0xC000000' };
  s = start(base + 2, { ...cap, MEMORY_HOG_MB: '250' });
  const code = await Promise.race([s.exit, sleep(15000).then(() => 'still running')]);
  if (code === 'still running') s.p.kill();
  check(code !== 'still running' && code !== 0 && /Out of memory/.test(s.log.join('')), `MEMORY_HOG_MB=250 under a 192 MiB heap cap dies at startup with "Out of memory." (${code}; a container reports a SIGABRT as exit code 134)`, s.log.join('').slice(0, 300));
  s = start(base + 3, { ...cap, MEMORY_HOG_MB: '100' });
  try { check(await waitFor(base + 3, '/healthz'), 'MEMORY_HOG_MB=100 under the same cap starts fine'); } finally { s.p.kill(); await s.exit; }

  // with a real database: todos work, and creating one moves our own counter
  const pg = process.env.TUTORIAL_PG;
  if (!pg) return skip('set TUTORIAL_PG to a PostgreSQL connection string to test todos_created_total against a real database');
  s = start(base + 4, { ConnectionStrings__Todos: pg });
  try {
    await waitFor(base + 4, '/healthz');
    for (let i = 0; i < 40 && (await get(url(base + 4, '/readyz'))).status !== 200; i++) await sleep(250);
    const r = await get(url(base + 4, '/api/todos'), {});
    check(r.status === 200, 'GET /api/todos works against PostgreSQL');
    const p = await get(url(base + 4, '/api/todos'), { method: 'POST', body: JSON.stringify({ title: 'Learn PromQL' }) });
    check(p.status === 201, 'POST /api/todos returns 201');
    const m = (await get(url(base + 4, '/metrics'))).body;
    check(/^todos_created_total(\{[^}]*\})? 1\b/m.test(m), 'todos_created_total goes up by one after a POST', m.split('\n').filter((l) => /todos_created/.test(l)).join('\n'));
    for (const t of JSON.parse(r.body.length > 2 ? r.body : '[]')) await get(url(base + 4, '/api/todos/' + t.id), { method: 'DELETE' });
  } finally { s.p.kill(); await s.exit; }
}

main().catch((e) => { console.error(e); process.exit(1); });
