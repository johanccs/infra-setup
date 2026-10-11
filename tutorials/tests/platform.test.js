// Checks everything Part 3 (Platform as Code) tells the reader to create, exactly as written on the page: the Argo CD
// Applications and AppProject, the root app, the bootstrap script (run against stand-in tools), and the pull request check.
//   node tests/platform.test.js
// Tools are looked up on PATH, or in the folder named by TOOLS_DIR: helm, kubeconform, actionlint, yq.
// Anything that is not installed is skipped and reported. Chart checks need network access (they fetch the pinned charts).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extract, bashBlocks } = require('./extract');
const { check, skip, summary, find, run, yamlDocs, CRDS } = require('./lib');

const DOCS = path.join(__dirname, '..', 'docs');
const P1 = path.join(DOCS, 'code-to-cluster-tutorial.html');
const P2 = path.join(DOCS, 'eyes-on-the-cluster-tutorial.html');
const FILE = path.join(DOCS, 'platform-as-code-tutorial.html');

function main() {
  const page = fs.readFileSync(FILE, 'utf8');
  const bash = bashBlocks(FILE).map((b) => b.code).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-platform-'));
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const exists = (f) => fs.existsSync(path.join(dir, f));

  // Parts 1 and 2 first. Then the moves step 3 asks for, then this part's files on top.
  extract(P1, dir);
  extract(P2, dir);
  for (const [, from, to] of bash.matchAll(/^git mv (\S+) (\S+)$/gm)) {
    const src = path.join(dir, from.replace(/^(src|infra)\//, ''));
    const dest = path.join(dir, to.replace(/^(src|infra)\//, ''));
    if (!fs.existsSync(src)) continue;   // the drills move files that only exist later
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
  }
  const files = extract(FILE, dir);
  const apps = ['monitoring', 'loki', 'alloy', 'loadgen', 'todo', 'team-todo-project'].map((n) => `platform/apps/${n}.yaml`);
  const need = [...apps, 'bootstrap/root.yaml', 'bootstrap.sh', '.github/workflows/platform-check.yml'];
  check(need.every((f) => files.includes(f)), 'every file the tutorial asks for is on the page', need.filter((f) => !files.includes(f)).join(', '));
  check(exists('platform/loadgen/loadgen.yaml') && !exists('platform/loadgen.yaml') && exists('platform/monitoring-values.yaml'), 'after the git mv commands, loadgen.yaml sits in its own folder and the values files stay where part 2 put them');

  const bad = bashBlocks(FILE).filter((b) => run('bash', ['-n'], { input: b.code.replace(/<[^>\n]+>/g, 'X') }).status !== 0);
  check(bad.length === 0, 'every bash block is valid shell syntax', bad.map((b) => b.code.split('\n')[0]).join('\n'));
  check(!/todo-app|X\.Y\.Z|v3\.X\.Y/.test(page), 'no leftovers: no todo-app folder, no version placeholders');

  // ---- the Applications and the project
  const doc = (f) => yamlDocs(read(f))[0];
  const app = Object.fromEntries(['monitoring', 'loki', 'alloy', 'loadgen', 'todo'].map((n) => [n, doc(`platform/apps/${n}.yaml`)]));
  const project = doc('platform/apps/team-todo-project.yaml');
  const root = doc('bootstrap/root.yaml');
  const kc = find('kubeconform');
  if (kc) {
    const all = [...apps, 'bootstrap/root.yaml'];
    const v = run(kc, ['-strict', '-summary', '-schema-location', 'default', '-schema-location', CRDS, ...all], { cwd: dir });
    check(v.status === 0 && /Valid: 7/.test(v.stdout), 'all seven Argo CD objects are valid against the Argo CD schemas', v.stdout + v.stderr);
  } else skip('kubeconform not installed');

  // chart versions are the ones part 2 installed
  const p2cmds = bashBlocks(P2).map((b) => b.code).join('\n');
  const pinned = (chart) => (new RegExp(`helm upgrade --install \\w+ [\\w-]+/${chart} --version (\\S+)`).exec(p2cmds) || [])[1];
  check(app.monitoring.spec.sources[0].targetRevision === pinned('kube-prometheus-stack') && app.loki.spec.sources[0].targetRevision === pinned('loki') && app.alloy.spec.sources[0].targetRevision === pinned('alloy'), `the three chart versions match the ones pinned in part 2 (${pinned('kube-prometheus-stack')}, ${pinned('loki')}, ${pinned('alloy')})`);
  const repo = app.todo.spec.source.repoURL;
  const repos = [app.monitoring, app.loki, app.alloy].map((a) => a.spec.sources[1].repoURL).concat([app.loadgen.spec.source.repoURL, repo, root.spec.source.repoURL, ...project.spec.sourceRepos]);
  check(repos.every((r) => r === repo) && /<your-user>\/infra-setup\.git$/.test(repo), 'every Application and the project point at the same repo, infra-setup');
  for (const n of ['monitoring', 'loki', 'alloy']) {
    const s = app[n].spec.sources;
    const vf = s[0].helm.valueFiles[0];
    check(s[1].ref === 'values' && vf.startsWith('$values/') && exists(vf.replace('$values/', '').replace(/^infra\//, '')), `${n}: the values file ${vf} exists in the repo layout and the second source is named "values"`);
  }
  check(app.monitoring.spec.sources[0].helm.releaseName === 'mon' && app.loki.spec.sources[0].helm.releaseName === 'loki' && app.alloy.spec.sources[0].helm.releaseName === 'alloy', 'release names are the ones part 2 used, so Service names (mon-grafana) and port-forwards stay the same');
  check(['monitoring', 'loki', 'alloy'].every((n) => app[n].spec.destination.namespace === 'monitoring') && app.loadgen.spec.destination.namespace === 'loadgen' && app.todo.spec.destination.namespace === 'todo', 'each component deploys into the namespace the earlier parts used');
  check([...Object.values(app), project].every((a) => a.metadata.namespace === 'argocd') && root.metadata.namespace === 'argocd', 'all Applications and the project live in the argocd namespace');
  check(Object.values(app).every((a) => (a.metadata.finalizers || []).includes('resources-finalizer.argocd.argoproj.io')), 'every child Application has the cascade-delete finalizer');
  check(Object.values(app).every((a) => a.spec.syncPolicy.automated.selfHeal === true && a.spec.syncPolicy.automated.prune === true), 'every child Application has automated sync with prune and selfHeal');
  check(app.monitoring.spec.syncPolicy.syncOptions.includes('ServerSideApply=true') && app.monitoring.spec.syncPolicy.syncOptions.includes('RespectIgnoreDifferences=true') && app.loki.spec.syncPolicy.syncOptions.includes('ServerSideApply=true'), 'the big charts use server-side apply (their object type definitions are too large otherwise)');

  // root app: watches exactly the folder that holds the six files
  const rootDir = root.spec.source.path;
  const inFolder = fs.readdirSync(path.join(dir, rootDir.replace(/^infra\//, ''))).sort();
  check(rootDir === 'infra/platform/apps' && inFolder.length === 6 && inFolder.every((f) => f.endsWith('.yaml')), `root watches ${rootDir}, which holds exactly the six files the page says (${inFolder.length})`, inFolder.join(', '));
  check(app.loadgen.spec.source.path === 'infra/platform/loadgen' && exists('platform/loadgen/loadgen.yaml') && app.todo.spec.source.path === 'charts/todo' && exists('charts/todo/Chart.yaml'), 'the loadgen and todo Applications point at folders that exist');
  check(root.spec.syncPolicy.automated && root.spec.project === 'default' && !root.metadata.finalizers, 'the root app is automated, in the default project');

  // the fence
  check(app.todo.spec.project === 'team-todo' && project.metadata.name === 'team-todo' && project.metadata.annotations['argocd.argoproj.io/sync-wave'] === '-1', 'todo belongs to team-todo, and the project is created first (sync-wave -1)');
  check(project.spec.destinations.length === 1 && project.spec.destinations[0].namespace === 'todo' && project.spec.destinations[0].namespace === app.todo.spec.destination.namespace && project.spec.destinations[0].server === app.todo.spec.destination.server, "the project allows exactly the todo app's destination");
  check(project.spec.clusterResourceWhitelist.length === 1 && project.spec.clusterResourceWhitelist[0].kind === 'Namespace' && project.spec.orphanedResources.warn === true, 'the project allows only Namespace as a cluster-wide resource, and warns about orphaned resources');
  check(app.todo.spec.syncPolicy.syncOptions.includes('SkipDryRunOnMissingResource=true') && app.todo.spec.syncPolicy.syncOptions.includes('CreateNamespace=true') && app.todo.spec.syncPolicy.retry.limit >= 5 && app.todo.spec.syncPolicy.retry.backoff.maxDuration, 'todo skips the dry run for object types that do not exist yet, and retries with back-off');

  const helm = find('helm');
  const tooMuch = path.join(dir, 'charts/todo/templates/too-much.yaml');
  check(fs.existsSync(tooMuch) && /kind: ClusterRole/.test(fs.readFileSync(tooMuch, 'utf8')), 'the drill file charts/todo/templates/too-much.yaml is a ClusterRole');
  fs.unlinkSync(tooMuch);   // it is for the drill only
  if (!helm) skip('helm not installed');
  else {
    const t = run(helm, ['template', 'todo', 'charts/todo'], { cwd: dir });
    const kinds = new Set(yamlDocs(t.stdout).map((d) => d.kind));
    const clusterScoped = ['ClusterRole', 'ClusterRoleBinding', 'CustomResourceDefinition', 'Namespace', 'StorageClass', 'PersistentVolume', 'MutatingWebhookConfiguration', 'ValidatingWebhookConfiguration'];
    check(t.status === 0 && ![...kinds].some((k) => clusterScoped.includes(k)), `the todo chart renders only namespaced objects (${[...kinds].join(', ')}), so the fence lets all of it through`);
    check(clusterScoped.includes('ClusterRole') && !project.spec.clusterResourceWhitelist.some((w) => w.kind === 'ClusterRole') && /kind: ClusterRole\b/.test(page), 'the drill ClusterRole is a cluster-wide kind the fence does not allow');
  }

  // ---- bootstrap.sh, run against stand-in tools that only record what they are asked to do
  const script = read('bootstrap.sh');
  const argo = /ARGOCD_VERSION=(\S+)/.exec(script)[1], ngf = /NGF_VERSION=(\S+)/.exec(script)[1];
  const p1 = bashBlocks(P1).map((b) => b.code).join('\n');
  check(new RegExp(`--version ${ngf.replace(/\./g, '\\.')}`).test(p1) && p1.includes(`ref=v${ngf}`) && /31437/.test(script) && /containerPort: 31437/.test(read('kind-config.yaml')), `the gateway commands match part 1 (version ${ngf}, node port 31437 from kind-config.yaml)`);
  check(run('bash', ['-n', 'bootstrap.sh'], { cwd: dir }).status === 0, 'bootstrap.sh is valid bash');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-shims-'));
  const log = path.join(bin, 'calls.log');
  for (const tool of ['kind', 'kubectl', 'helm']) fs.writeFileSync(path.join(bin, tool), `#!/usr/bin/env bash\necho "${tool} $*" >> "${log}"\n${tool === 'kubectl' ? 'if [[ "$*" == *jsonpath* ]]; then printf c2VjcmV0; fi' : ''}\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(dir, 'infra'), { recursive: true });
  fs.copyFileSync(path.join(dir, 'bootstrap.sh'), path.join(dir, 'infra', 'bootstrap.sh'));
  fs.chmodSync(path.join(dir, 'infra', 'bootstrap.sh'), 0o755);
  const exec = run(path.join(dir, 'infra', 'bootstrap.sh'), [], { cwd: os.tmpdir(), env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const idx = (re) => calls.findIndex((c) => re.test(c));
  const order = [/^kind create cluster --name todo --config infra\/kind-config\.yaml$/, /^kubectl kustomize .*ref=v/, /^helm install ngf oci:\/\/ghcr\.io\/nginx\/charts\/nginx-gateway-fabric --version/, /^kubectl -n nginx-gateway wait/, /^kubectl create namespace argocd/, new RegExp(`^kubectl apply -n argocd .*argo-cd/${argo.replace(/\./g, '\\.')}/manifests/install\\.yaml`), /^kubectl -n argocd rollout status/, /^kubectl apply -f infra\/bootstrap\/root\.yaml/, /^kubectl -n argocd get secret/].map(idx);
  check(exec.status === 0 && order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), 'run from another folder with stand-in tools, bootstrap.sh does its nine steps in order: cluster, gateway, Argo CD, root app, password', exec.stderr + '\n' + calls.join('\n'));
  check(/Argo CD admin password:\nsecret\n/.test(exec.stdout), 'it prints the admin password it read from the cluster');
  const installUrl = `https://raw.githubusercontent.com/argoproj/argo-cd/${argo}/manifests/install.yaml`;
  const head = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-L', '-m', '20', installUrl]);
  if (head.stdout === '000') skip('no network, Argo CD install URL not checked');
  else check(head.stdout === '200', `Argo CD ${argo} has an install.yaml at the pinned URL (HTTP ${head.stdout})`);
  check(!/stable\/manifests/.test(script), 'the script pins Argo CD instead of using the stable link');

  // ---- the pull request check
  const wf = read('.github/workflows/platform-check.yml');
  const al = find('actionlint');
  if (al) { const r = run(al, ['.github/workflows/platform-check.yml'], { cwd: dir }); check(r.status === 0, 'actionlint accepts platform-check.yml', r.stdout + r.stderr); } else skip('actionlint not installed');
  check(/pull_request:/.test(wf) && /infra\/platform\/\*\*/.test(wf) && /charts\/\*\*/.test(wf) && !/actions\/checkout@v[1-4]\b/.test(wf), 'the check runs on pull requests that touch infra/platform/ or charts/');
  const yq = find('yq');
  const steps = yamlDocs(wf)[0].jobs.render.steps;
  const stepRun = (name) => steps.find((s) => s.name === name).run;
  if (!helm || !yq) skip('helm or yq not installed, the pull request check was not run');
  else {
    const asRepo = (from) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-repo-')); fs.cpSync(path.join(from, 'platform'), path.join(d, 'infra', 'platform'), { recursive: true }); fs.cpSync(path.join(from, 'charts'), path.join(d, 'charts'), { recursive: true }); return d; };
    const runCheck = (fromDir) => {
      const extraDir = asRepo(fromDir);
      const sh = (name) => run('bash', ['-ec', stepRun(name)], { cwd: extraDir, env: { ...process.env, PATH: path.dirname(yq) + path.delimiter + path.dirname(helm) + path.delimiter + process.env.PATH } });
      const repos = sh('Add chart repositories');
      if (repos.status !== 0) return { skipped: true, out: repos.stderr };
      return { render: sh('Render the platform charts'), lint: sh('Check the todo chart') };
    };
    const good = runCheck(dir);
    if (good.skipped) skip('no network, the pull request check was not run: ' + good.out.split('\n')[0]);
    else {
      check(good.render.status === 0, 'the check, run as written, renders all three platform charts at their pinned versions', good.render.stderr);
      check(good.lint.status === 0, 'helm lint --strict is clean on the todo chart', good.lint.stdout + good.lint.stderr);
      // what the drills claim: a loud mistake fails the check, a quiet one does not
      const variant = (edit) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-variant-')); fs.cpSync(dir, d, { recursive: true }); edit(d); return runCheck(d); };
      const loud1 = variant((d) => fs.writeFileSync(path.join(d, 'platform/apps/loki.yaml'), read('platform/apps/loki.yaml').replace('targetRevision: 7.3.0', 'targetRevision: 99.0.0')));
      check(loud1.render.status !== 0, 'drill: a chart version that does not exist fails the check');
      const loud2 = variant((d) => fs.writeFileSync(path.join(d, 'platform/monitoring-values.yaml'), read('platform/monitoring-values.yaml').replace('  sidecar:', 'sidecar:')));
      check(loud2.render.status !== 0, 'drill: a values file with broken indentation fails the check');
      const quiet = variant((d) => fs.writeFileSync(path.join(d, 'platform/monitoring-values.yaml'), read('platform/monitoring-values.yaml').replace('serviceMonitorSelectorNilUsesHelmValues', 'serviceMonitorSelectorNilUseHelmValues')));
      check(quiet.render.status === 0, 'drill: the misspelled setting passes the check, as the page says it does');
      const rendered = run(helm, ['template', 'mon', 'kube-prometheus-stack', '--repo', 'https://prometheus-community.github.io/helm-charts', '--version', '92.3.0', '-n', 'monitoring', '-f', path.join(dir, 'platform/monitoring-values.yaml')]);
      const withTypo = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-typo-'));
      const typoFile = path.join(withTypo, 'v.yaml');
      fs.writeFileSync(typoFile, read('platform/monitoring-values.yaml').replace('serviceMonitorSelectorNilUsesHelmValues', 'serviceMonitorSelectorNilUseHelmValues'));
      const typo = run(helm, ['template', 'mon', 'kube-prometheus-stack', '--repo', 'https://prometheus-community.github.io/helm-charts', '--version', '92.3.0', '-n', 'monitoring', '-f', typoFile]);
      const sel = (out) => (yamlDocs(out).find((d) => d.kind === 'Prometheus') || { spec: {} }).spec.serviceMonitorSelector;
      check(rendered.status === 0 && typo.status === 0 && JSON.stringify(sel(rendered.stdout)) === '{}' && sel(typo.stdout).matchLabels.release === 'mon', 'drill: with the typo, Prometheus only watches ServiceMonitors labelled release: mon, which the todo chart does not carry');
    }
    // step 11: an older Alloy chart really exists and renders with part 2's values
    const old = (/targetRevision: (1\.\d+\.\d+)<\/code> in <code>infra\/platform\/apps\/alloy\.yaml/.exec(page) || [])[1];
    const r = run(helm, ['template', 'alloy', 'alloy', '--repo', 'https://grafana.github.io/helm-charts', '--version', old || '0', '-n', 'monitoring', '-f', path.join(dir, 'platform/alloy-values.yaml')]);
    if (r.status !== 0 && /dial tcp|no such host|Could not resolve|timeout/i.test(r.stderr)) skip('no network, the older Alloy chart was not rendered');
    else check(!!old && r.status === 0, `step 11: Alloy chart ${old} exists and renders with the values from part 2`, r.stderr);
  }
  process.exit(summary());
}

main();
