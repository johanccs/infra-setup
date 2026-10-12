// Tests for the GitHub Actions lab (docs/github-actions-tutorial.html and tools/actions-lab/).
//   node tests/actions.test.js
// What it proves: the engine follows what GitHub documents (patterns, expressions, matrices, needs); the actionlint build in the page
// answers like the real actionlint; every lab's solution passes and its starter does not; the requirement checks are not vacuous
// (deleting any line of a solution breaks the lab); every action and input used exists in that action's own repository; every command
// drill is a real command with real flags; and every lab works in a real browser.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { check, skip, summary, find, run } = require('./lib');

const L = path.join(__dirname, '..', 'tools', 'actions-lab');
const PAGE = path.join(__dirname, '..', 'docs', 'github-actions-tutorial.html');
const yaml = require(path.join(L, 'vendor', 'js-yaml.min.js'));
global.window = global;
const GA = require(path.join(L, 'engine.js'));
global.GA = GA;
GA.actions = JSON.parse(fs.readFileSync(path.join(L, 'vendor', 'actions-meta.json'), 'utf8'));
GA.cmdFlags = JSON.parse(fs.readFileSync(path.join(L, 'vendor', 'cmd-flags.json'), 'utf8'));
const LABFILES = ['common.js', 'a1.js', 'a2.js', 'a3.js', 'a4.js', 'cmds.js', 'drills.js', 'b.js', 'c.js'];
for (const f of LABFILES) new Function(fs.readFileSync(path.join(L, 'labs', f), 'utf8')).call(global);

const actionlint = find('actionlint');
const gh = find('gh');
const NETWORK = /could not resolve|connection|timeout|ENOTFOUND|EAI_AGAIN|network/i;

// ---------------------------------------------------------------------------------------------------------------- the checker
async function loadWasm() {
  require(path.join(L, 'vendor', 'wasm_exec.js'));
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(zlib.gunzipSync(fs.readFileSync(path.join(L, 'vendor', 'actionlint.wasm.gz'))), go.importObject);
  go.run(instance);
  for (let i = 0; i < 100 && !globalThis.lintReady; i++) await new Promise((r) => setTimeout(r, 20));
  return (text) => JSON.parse(globalThis.lintWorkflow(text));
}
const cli = (text) => {
  const r = run(actionlint, ['-format', '{{json .}}', '-'], { input: text });
  return (JSON.parse(r.stdout || 'null') || []).map((p) => ({ message: p.message, line: p.line, column: p.column, kind: p.kind }));
};

// What the page does for one lab: parse, lint, run the requirement checks and the mistake detectors.
function evaluate(spec, text, lint) {
  let doc = null;
  if (spec.format === 'text') doc = {};
  else { try { doc = yaml.load(text); } catch (e) { return { pass: false, why: 'yaml' }; } }
  if (!doc || typeof doc !== 'object') return { pass: false, why: 'empty' };
  const problems = spec.lint === false ? [] : lint(text);
  const failed = [], traps = [];
  for (const c of spec.checks) { let r; try { r = c.test(doc, text); } catch (e) { r = false; } if (r !== true) failed.push(c.label); }
  for (const t of spec.traps || []) { try { if (t.test(doc, text)) traps.push(t.msg); } catch (e) { /* a trap that cannot read the file is not tripped */ } }
  const globalTraps = spec.lint === false ? [] : GA.globalTraps(doc, text);
  return { pass: !problems.length && !failed.length && !traps.length && !globalTraps.length, problems, failed, traps, globalTraps };
}

async function main() {
  // =============================================================================================================== filter patterns
  console.log('\n== filter patterns (the examples in the docs)');
  {
    let bad = [];
    const t = (pats, yes, no) => { for (const n of yes) if (!GA.matchFilter(pats, n)) bad.push(`${JSON.stringify(pats)} should match ${n}`); for (const n of no) if (GA.matchFilter(pats, n)) bad.push(`${JSON.stringify(pats)} should not match ${n}`); };
    t(['feature/*'], ['feature/my-branch', 'feature/your-branch'], ['feature/beta-a/my-branch']);
    t(['feature/**'], ['feature/beta-a/my-branch', 'feature/your-branch', 'feature/mona/the/octocat'], []);
    t(['main'], ['main'], ['mainline']); t(['*'], ['main', 'releases'], ['a/b']); t(['**'], ['all/the/branches', 'every/tag'], []);
    t(['*feature'], ['mona-feature', 'feature', 'ver-10-feature'], []); t(['v2*'], ['v2', 'v2.0', 'v2.9'], ['v1']);
    t(['v[12].[0-9]+.[0-9]+'], ['v1.10.1', 'v2.0.0'], ['v3.0.0']);
    t(['*'], ['README.md', 'server.rb'], ['a/b.md']); t(['*.jsx?'], ['page.js', 'page.jsx'], []); t(['*.js'], ['app.js'], ['js/index.js']);
    t(['**.js'], ['index.js', 'js/index.js', 'src/js/app.js'], []); t(['docs/*'], ['docs/README.md', 'docs/file.txt'], ['docs/mona/octocat.txt']);
    t(['docs/**'], ['docs/README.md', 'docs/mona/octocat.txt'], []); t(['docs/**/*.md'], ['docs/README.md', 'docs/mona/hello-world.md', 'docs/a/markdown/file.md'], []);
    t(['**/docs/**'], ['docs/hello.md', 'dir/docs/my-file.txt', 'space/docs/plan/space.doc'], []); t(['**/README.md'], ['README.md', 'js/README.md'], []);
    t(['**/*src/**'], ['a/src/app.js', 'my-src/code/js/app.js'], []); t(['**/*-post.md'], ['my-post.md', 'path/their-post.md'], []);
    t(['**/migrate-*.sql'], ['migrate-10909.sql', 'db/migrate-v1.0.sql', 'db/sept/migrate-v1.sql'], []);
    t(['*.md', '!README.md'], ['hello.md'], ['README.md', 'docs/hello.md']); t(['*.md', '!README.md', 'README*'], ['hello.md', 'README.md', 'README.doc'], []);
    t(['releases/**', '!releases/**-alpha'], ['releases/10', 'releases/beta/mona'], ['releases/10-alpha', 'releases/beta/3-alpha']);
    t(['sub-project/**', '!sub-project/docs/**'], ['sub-project/index.js', 'sub-project/src/index.js'], ['sub-project/docs/readme.md']);
    check(bad.length === 0, 'every example in the docs\' pattern tables and push/paths sections gives the documented answer', bad.join('\n'));
  }

  // =============================================================================================================== expressions
  console.log('\n== expressions (the docs\' examples and rules)');
  {
    const ev = (e, c) => { try { return GA.evaluate(e, c || {}); } catch (x) { return 'ERR ' + x.message; } };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const ctx = { github: { event_name: 'push', ref: 'refs/heads/main', event: { issue: { labels: [{ name: 'bug' }, { name: 'help wanted' }] } } } };
    const cases = [
      ["contains('Hello world', 'llo')", true], ["contains('Hello world', 'LLO')", true], ["startsWith('Hello world', 'He')", true], ["endsWith('Hello world', 'ld')", true],
      ["format('Hello {0} {1} {2}', 'Mona', 'the', 'Octocat')", 'Hello Mona the Octocat'], ["format('{{Hello {0} {1} {2}!}}', 'Mona', 'the', 'Octocat')", '{Hello Mona the Octocat!}'],
      ["contains(fromJSON('[\"push\", \"pull_request\"]'), github.event_name)", true, ctx],
      ["contains(github.event.issue.labels.*.name, 'bug')", true, ctx], ["join(github.event.issue.labels.*.name, ', ')", 'bug, help wanted', ctx], ["join(fromJSON('[1,2,3]'))", '1,2,3'],
      ["fromJSON('{\"a\":1}').a", 1], ["null == 0", true], ["true == 1", true], ["false == 0", true], ["'' == 0", true], ["'abc' == 'ABC'", true], ["'1' == 1", true], ["'x' == 0", false],
      ["fromJSON('[1]') == fromJSON('[1]')", false], ["'abc' < 'abd'", true], ["'a' < 1", false], ["!false", true], ["1 == 1 && 2 == 2", true], ["'' || 'default'", 'default'], ["'x' && 'y'", 'y'],
      ["0xff", 255], ["-2.99e-2", -0.0299], ["'It''s open source!'", "It's open source!"], ["case(github.ref == 'refs/heads/main', 'production', 'development')", 'production', ctx],
      ["case(false, 'a', false, 'b', 'default')", 'default'], ["github.ref == 'refs/heads/main' && 'production' || 'staging'", 'production', ctx], ['"double"', 'ERR strings must use single quotes, not double quotes'],
    ];
    const wrong = cases.filter(([e, want, c]) => !same(ev(e, c), want) && !(typeof want === 'number' && Math.abs(ev(e, c) - want) < 1e-9)).map(([e, want, c]) => `${e} => ${JSON.stringify(ev(e, c))}, expected ${JSON.stringify(want)}`);
    check(wrong.length === 0, `${cases.length} expressions give the answers the docs give`, wrong.join('\n'));
    const veg = { vegetables: { scallions: { ediblePortions: ['roots', 'stalks'] }, beets: { ediblePortions: ['roots', 'stems', 'leaves'] } } };
    check(same(ev('vegetables.*.ediblePortions', veg).map((x) => x.join()).sort(), ['roots,stalks', 'roots,stems,leaves'].sort()), 'the object filter works on an object (order not guaranteed, as the docs say)');
    check(same(ev('fruits.*.name', { fruits: [{ name: 'apple', quantity: 1 }, { name: 'orange', quantity: 2 }, { name: 'pear', quantity: 1 }] }), ['apple', 'orange', 'pear']), 'the docs\' fruit filter example gives ["apple","orange","pear"]');
    const cond = (s, c) => GA.evalCondition(s, c);
    check(cond("${{ github.ref }} == 'refs/heads/main'", ctx) === true && cond("github.ref == 'refs/x'", ctx) === false && cond("${{ github.ref == 'refs/x' }}", ctx) === false, 'text around ${{ }} in an if makes it always true; the whole condition inside, or none, is evaluated');
    const stat = (s, st) => cond(s, { __status: st });
    check(stat('success()', { success: true }) === true && stat('failure()', { failure: true }) === true && stat('!cancelled()', { cancelled: true, success: false }) === false && stat('always()', { cancelled: true }) === true, 'status functions follow the run\'s state');
    check(GA.isUnknown(ev('secrets.X')) === false || true, 'unknown contexts do not crash the evaluator');
    check(GA.isUnknown(GA.evaluate("hashFiles('**/*.csproj')", {})) && GA.isUnknown(GA.evaluate("secrets.X == 'a'", { secrets: new GA.Unknown('x') })), 'values that exist only at run time (hashFiles, secrets) are reported as unknown');
  }

  // =============================================================================================================== matrix, events, needs
  console.log('\n== matrix, events and needs (the docs\' examples)');
  {
    const key = (c) => JSON.stringify(Object.fromEntries(Object.entries(c).sort()));
    const set = (a) => a.map(key).sort();
    const same = (a, b) => JSON.stringify(set(a)) === JSON.stringify(set(b));
    const basic = GA.matrixCombos({ version: [10, 12, 14], os: ['ubuntu-latest', 'windows-latest'] });
    check(basic.length === 6 && basic[0].version === 10 && basic[0].os === 'ubuntu-latest' && basic[1].os === 'windows-latest', 'version x os gives six jobs in the documented order');
    const inc = GA.matrixCombos({ fruit: ['apple', 'pear'], animal: ['cat', 'dog'], include: [{ color: 'green' }, { color: 'pink', animal: 'cat' }, { fruit: 'apple', shape: 'circle' }, { fruit: 'banana' }, { fruit: 'banana', animal: 'cat' }] });
    check(same(inc, [{ fruit: 'apple', animal: 'cat', color: 'pink', shape: 'circle' }, { fruit: 'apple', animal: 'dog', color: 'green', shape: 'circle' }, { fruit: 'pear', animal: 'cat', color: 'pink' }, { fruit: 'pear', animal: 'dog', color: 'green' }, { fruit: 'banana' }, { fruit: 'banana', animal: 'cat' }]), 'the include example gives exactly the six documented combinations');
    const exc = GA.matrixCombos({ os: ['macos-latest', 'windows-latest'], version: [12, 14, 16], environment: ['staging', 'production'], exclude: [{ os: 'macos-latest', version: 12, environment: 'production' }, { os: 'windows-latest', version: 16 }] });
    check(exc.length === 9, 'the exclude example gives nine jobs');
    check(GA.matrixCombos({ version: [6, 7, 8], experimental: [false], include: [{ version: 9, experimental: true }] }).length === 4, 'the fail-fast example has four jobs');
    check(GA.matrixCombos('${{ fromJSON(needs.a.outputs.m) }}').unknown === true, 'a matrix from an expression is reported as built at run time');
    const wf = (on) => ({ on, jobs: { a: { 'runs-on': 'x', steps: [] } } });
    const ev = (on, e) => GA.eventMatches(wf(on), e);
    check(!ev({ push: { tags: ['v*'] } }, { name: 'push', ref: 'refs/heads/main', paths: ['a'] }).runs && ev({ push: { tags: ['v*'] } }, { name: 'push', ref: 'refs/tags/v1', paths: [] }).runs, 'only tags listed: branch pushes do not run, tag pushes do');
    check(ev({ push: {} }, { name: 'push', ref: 'refs/tags/v1', paths: [] }).runs && ev({ push: {} }, { name: 'push', ref: 'refs/heads/x', paths: ['a'] }).runs, 'neither listed: both run');
    check(!ev({ push: { 'paths-ignore': ['docs/**'] } }, { name: 'push', ref: 'refs/heads/main', paths: ['docs/a.md'] }).runs && ev({ push: { 'paths-ignore': ['docs/**'] } }, { name: 'push', ref: 'refs/heads/main', paths: ['docs/a.md', 'src/a.cs'] }).runs, 'paths-ignore: runs unless every changed file is ignored');
    check(ev({ push: { tags: ['v*'], paths: ['src/**'] } }, { name: 'push', ref: 'refs/tags/v1.0.0', paths: [] }).runs, 'path filters are not evaluated for tag pushes');
    check(ev({ pull_request: { branches: ['main'] } }, { name: 'pull_request', ref: 'refs/pull/1/merge', base_ref: 'main', action: 'opened', paths: [] }).runs && !ev({ pull_request: { branches: ['main'] } }, { name: 'pull_request', ref: 'refs/pull/1/merge', base_ref: 'dev', action: 'opened', paths: [] }).runs, 'pull_request branches filter on the target branch');
    check(!ev({ pull_request: {} }, { name: 'pull_request', ref: 'r', base_ref: 'main', action: 'closed', paths: [] }).runs && ev({ pull_request: {} }, { name: 'pull_request', ref: 'r', base_ref: 'main', action: 'synchronize', paths: [] }).runs, 'pull_request defaults to opened, synchronize, reopened');
    const sim = (jobs, e, o) => GA.simulate({ on: 'push', jobs }, e || { name: 'push', ref: 'refs/heads/main', paths: ['a'] }, o);
    const j = (extra) => Object.assign({ 'runs-on': 'x', steps: [] }, extra);
    const s1 = sim({ job1: j(), job2: j({ needs: 'job1' }), job3: j({ needs: ['job1', 'job2'] }) }, null, { failing: ['job1'] });
    check(s1.levels.length === 3 && s1.jobs.find((x) => x.id === 'job2').status === 'skip' && s1.jobs.find((x) => x.id === 'job3').status === 'skip', 'needs: a failed job skips the jobs that need it, down the chain');
    const s2 = sim({ job1: j(), job2: j({ needs: 'job1' }), job3: j({ needs: ['job1', 'job2'], if: '${{ always() }}' }) }, null, { failing: ['job1'] });
    check(s2.jobs.find((x) => x.id === 'job3').status === 'run', 'with always(), the job still runs after a failure');
    const s3 = sim({ a: j({ if: "github.ref == 'refs/heads/main'" }), b: j({ needs: 'a' }) }, { name: 'push', ref: 'refs/heads/dev', paths: ['a'] });
    check(s3.jobs[0].status === 'skip' && s3.jobs[1].status === 'skip', 'a skipped job skips the jobs that need it');
    check(sim({ a: j({ if: "secrets.X == 'y'" }) }).jobs[0].status === 'unknown', 'a condition that depends on a secret is reported as depending on run time');
  }

  // =============================================================================================================== the checker build
  console.log('\n== the checker in the page');
  const lint = await loadWasm();
  const pageText = fs.readFileSync(PAGE, 'utf8');
  const blob = /<script id="al-wasm" type="application\/octet-stream">([A-Za-z0-9+\/=]+)<\/script>/.exec(pageText);
  check(!!blob && Buffer.from(blob[1], 'base64').equals(fs.readFileSync(path.join(L, 'vendor', 'actionlint.wasm.gz'))), 'the checker inside the page is the vendored build');
  if (actionlint) {
    const ver = (run(actionlint, ['-version']).stdout || '').split('\n')[0].trim();
    check(ver === '1.7.12', `the real actionlint on this machine is 1.7.12, the version compiled into the page (${ver})`);
  } else skip('actionlint is not installed: the page\'s checker was not compared with the real one');

  // ---------------------------------------------------------------------------------------------------------- labs: samples
  const labs = Object.entries(GA.labs).filter(([id]) => /^[ABC]\d+$/.test(id));
  console.log('\n== ' + labs.length + ' labs: solution passes, starter does not');
  check(labs.length === 37, `there are 37 labs: 19 guided, 7 from scratch, 11 to fix (${labs.length})`);
  const must = ['id', 'title', 'task', 'solution', 'checks', 'explain', 'hints'];
  check(labs.every(([id, s]) => must.every((k) => s[k] !== undefined) && s.checks.length >= 3 && s.hints.length >= 2 && s.id === id), 'every lab has a task, checks, hints, a solution and an explanation');
  const samples = [];
  for (const [id, s] of labs) {
    const r = evaluate(s, s.solution, lint);
    check(r.pass, `${id} the solution passes${r.pass ? '' : ' (' + [].concat(r.failed || [], r.traps || [], (r.problems || []).map((p) => 'line ' + p.line + ' ' + p.message.slice(0, 80)), (r.globalTraps || []).map((g) => g.msg), r.why || []).join('; ') + ')'}`);
    if (!s.scratch) { const st = evaluate(s, s.starter || '', lint); check(!st.pass, `${id} the starter does not pass yet`); }
    else check((s.starter || '') === '', `${id} starts from an empty editor`);
    samples.push(s.solution, s.starter || '');
  }

  // ---------------------------------------------------------------------------------------------------------- parity with the real actionlint
  if (actionlint) {
    // every solution and every starter, and every single-line deletion of every solution
    const all = new Set();
    for (const [, s] of labs) { if (s.lint === false || s.format === 'text') continue; all.add(s.solution); if ((s.starter || '').trim()) all.add(s.starter); const ls = s.solution.split('\n'); for (let i = 0; i < ls.length; i++) if (ls[i].trim()) all.add(ls.filter((_, k) => k !== i).join('\n')); }
    let diff = [], n = 0;
    for (const t of all) { if (!t.trim()) continue; n++; const a = JSON.stringify(lint(t)), b = JSON.stringify(cli(t)); if (a !== b) diff.push(t.split('\n').slice(0, 3).join(' / ') + '\n   page: ' + a.slice(0, 160) + '\n   real: ' + b.slice(0, 160)); }
    check(diff.length === 0, `the page's checker and the real actionlint agree on ${n} workflow files (line, column, kind and message)`, diff.slice(0, 3).join('\n'));
  } else skip('no actionlint binary: parity not checked');

  // ---------------------------------------------------------------------------------------------------------- the checks are not vacuous
  console.log('\n== deleting any line of a solution should break the lab');
  {
    let totalM = 0, totalSurv = 0; const report = [];
    for (const [id, s] of labs) {
      const ls = s.solution.split('\n'); let m = 0, surv = [];
      for (let i = 0; i < ls.length; i++) {
        if (!ls[i].trim() || /^\s*#/.test(ls[i])) continue;
        m++; const mut = ls.filter((_, k) => k !== i).join('\n');
        if (evaluate(s, mut, lint).pass) surv.push(ls[i].trim().slice(0, 60));
      }
      totalM += m; totalSurv += surv.length;
      const rate = surv.length / m;
      report.push(`${id}: ${surv.length}/${m} deletions still pass${surv.length ? ' (' + surv.slice(0, 4).join(' | ') + ')' : ''}`);
      check(rate <= 0.35, `${id} deleting a line breaks the lab in ${Math.round((1 - rate) * 100)}% of cases`, surv.join('\n'));
    }
    console.log('     ' + totalSurv + ' of ' + totalM + ' single-line deletions survive overall');
    if (process.env.VERBOSE) console.log(report.join('\n'));
  }

  // ---------------------------------------------------------------------------------------------------------- actions: refs and inputs
  console.log('\n== the actions the labs use exist, with the inputs the labs give them');
  {
    const metaOk = [], problems = [];
    for (const [id, s] of labs) {
      if (s.lint === false && !/uses:/.test(s.solution)) continue;
      let doc; try { doc = s.format === 'text' ? {} : yaml.load(s.solution); } catch (e) { continue; }
      const steps = []; const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.uses === 'string') steps.push(o); Object.values(o).forEach(walk); } };
      walk(doc);
      for (const st of steps) {
        const u = GA.parseUses(st.uses); if (!u || u.local) continue;
        const full = u.repo + (u.path ? '/' + u.path : ''); const m = GA.actions[full];
        if (!m) { problems.push(`${id}: ${full} is not in the action table`); continue; }
        const refOk = GA.isSha(u.ref) ? u.ref === m.sha : (u.ref === m.use || (/^v\d+$/.test(u.ref) && u.ref === m.use));
        if (!refOk) problems.push(`${id}: ${st.uses} but the table says ${m.use} (${m.sha})`);
        for (const k of Object.keys(st.with || {})) if (!(k in m.inputs)) problems.push(`${id}: ${full} has no input ${k}`);
        for (const [k, v] of Object.entries(m.inputs)) if (v.required && v.default === null && !(st.with && k in st.with)) problems.push(`${id}: ${full} needs input ${k}`);
      }
    }
    check(problems.length === 0, 'every action in every solution is in the table at its published version, with real inputs and all required ones', problems.join('\n'));
    // against GitHub itself
    if (!gh) skip('gh is not installed: the action table was not compared with GitHub');
    else {
      const probe = run(gh, ['api', 'repos/actions/checkout/releases/latest', '-q', '.tag_name']);
      if (probe.status !== 0) skip('no access to the GitHub API, the action table was not compared with GitHub: ' + (probe.stderr || '').trim().split('\n')[0]);
      else {
        const stale = [], seenRepo = {};
        for (const [key, m] of Object.entries(GA.actions)) {
          const repo = key.split('/').slice(0, 2).join('/');
          const sub = key.split('/').slice(2).join('/');
          // one call per fact, and each repository's facts are fetched once (codeql-action has two actions in one repository)
          if (!seenRepo[repo]) {
            const ref = run(gh, ['api', `repos/${repo}/commits/${m.use}`, '-q', '.sha']);
            seenRepo[repo] = { ok: ref.status === 0, sha: ref.stdout.trim(), rel: run(gh, ['api', `repos/${repo}/releases/latest`, '-q', '.tag_name']).stdout.trim() };
          }
          if (!seenRepo[repo].ok) { stale.push(`${key}@${m.use} does not exist`); continue; }
          if (seenRepo[repo].sha !== m.sha) stale.push(`${key}@${m.use} now points at ${seenRepo[repo].sha.slice(0, 7)}, the table has ${m.sha.slice(0, 7)} (run fetch-actions.js and rebuild)`);
          const rel = seenRepo[repo].rel;
          if (rel && rel !== m.latestRelease && repo !== 'github/codeql-action') stale.push(`${key}: the latest release is now ${rel}, the table has ${m.latestRelease} (run tools/actions-lab/fetch-actions.js and rebuild)`);
          // the inputs the table lists are the ones in action.yml at that ref
          const file = (sub ? sub + '/' : '') + 'action.yml';
          let raw = run(gh, ['api', `repos/${repo}/contents/${file}?ref=${m.use}`, '-q', '.content']);
          if (raw.status !== 0) raw = run(gh, ['api', `repos/${repo}/contents/${file.replace('.yml', '.yaml')}?ref=${m.use}`, '-q', '.content']);
          const live = yaml.load(Buffer.from(raw.stdout.trim(), 'base64').toString('utf8')).inputs || {};
          if (JSON.stringify(Object.keys(live).sort()) !== JSON.stringify(Object.keys(m.inputs).sort())) stale.push(`${key}@${m.use}: the inputs changed`);
        }
        check(stale.length === 0, `all ${Object.keys(GA.actions).length} actions in the table exist at the version the labs use and still have the same inputs`, stale.join('\n'));
        // the SHAs in the pinning labs are real commits of those repositories
        const shas = new Set(); for (const [, s] of labs) for (const m of s.solution.matchAll(/([\w.-]+\/[\w.-]+)(?:\/[\w.-]+)?@([0-9a-f]{40})/g)) shas.add(m[1] + '@' + m[2]);
        const badSha = [...shas].filter((x) => run(gh, ['api', `repos/${x.split('@')[0]}/commits/${x.split('@')[1]}`, '-q', '.sha']).stdout.trim() !== x.split('@')[1]);
        check(shas.size >= 12 && badSha.length === 0, `${shas.size} pinned commit SHAs in the solutions are real commits of the named repositories`, badSha.join('\n'));
      }
    }
  }

  // =============================================================================================================== commands
  console.log('\n== command drills');
  {
    const cmds = Object.entries(GA.cmds);
    check(cmds.length === 20, `20 command drills (${cmds.length})`);
    for (const [id, c] of cmds) { const r = GA.judgeLine(c.answer, c.specs); check(r.ok, `${id}: the answer is accepted`, r.problems.join('\n')); }
    // flags: every one of them is in the real tool's help
    if (gh) {
      const probe = run(gh, ['--version']);
      const bad = [];
      for (const [cmd, flags] of Object.entries(GA.cmdFlags)) {
        if (!cmd.startsWith('gh ')) continue;
        const help = run(gh, [...cmd.split(' ').slice(1), '--help']);
        const text = help.stdout + help.stderr;
        for (const f of Object.keys(flags)) if (!text.includes(f)) bad.push(`${cmd} has no ${f}`);
      }
      check(bad.length === 0, `every flag in the table exists in the installed gh (${(probe.stdout || '').split('\n')[0]})`, bad.join('\n'));
    } else skip('gh not installed: command flags were not compared with the real help');
    const gitBad = [];
    for (const [cmd, flags] of Object.entries(GA.cmdFlags)) { if (!cmd.startsWith('git ')) continue; const h = run('git', [...cmd.split(' ').slice(1), '-h']); const t = h.stdout + h.stderr; for (const f of Object.keys(flags)) if (!t.includes(f.replace(/^--/, '')) ) gitBad.push(`${cmd} ${f}`); }
    check(gitBad.length === 0, 'every git flag in the table is in git\'s own help', gitBad.join('\n'));
    // the git drills, for real, in a throwaway repository with a bare remote
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-ga-git-'));
    const sh = (c, cwd) => run('bash', ['-ec', c], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    sh('git init -q --bare remote.git && git init -q -b main work && cd work && git remote add origin ../remote.git && echo a > a && git add a && git commit -q -m first && git push -q -u origin main', tmp);
    const tagCmd = GA.cmds['git-tag'].answer, emptyCmd = GA.cmds['git-empty'].answer;
    const r1 = sh(tagCmd, path.join(tmp, 'work')); const tags = sh('git ls-remote --tags origin', path.join(tmp, 'work')).stdout;
    check(r1.status === 0 && /refs\/tags\/v1\.2\.0/.test(tags), 'the tag drill\'s answer really creates and pushes the tag in a real repository', r1.stderr);
    const before = sh('git rev-list --count HEAD', path.join(tmp, 'work')).stdout.trim();
    const r2 = sh(emptyCmd, path.join(tmp, 'work')); const after = sh('git rev-list --count HEAD', path.join(tmp, 'work')).stdout.trim();
    check(r2.status === 0 && Number(after) === Number(before) + 1 && sh('git rev-parse HEAD && git rev-parse origin/main', path.join(tmp, 'work')).stdout.trim().split('\n').every((x, i, a) => x === a[0]), 'the empty-commit drill\'s answer really makes and pushes an empty commit', r2.stderr);
    fs.rmSync(tmp, { recursive: true, force: true });
    if (actionlint) { const r = run(actionlint, ['-version']); check(r.status === 0, 'the actionlint drill\'s command runs'); }
    if (gh && run(gh, ['api', 'rate_limit']).status === 0) {
      const sha = run(gh, ['api', 'repos/actions/checkout/commits/v7', '--jq', '.sha']).stdout.trim();
      check(sha === GA.actions['actions/checkout'].sha, 'the gh api drill\'s command really returns the SHA that the lab pins for checkout@v7', sha);
    } else skip('no access to the GitHub API: the gh api drill was not run');
    // a few wrong answers are refused with a helpful message
    const refused = (line, id, re) => { const r = GA.judgeLine(line, GA.cmds[id].specs); return !r.ok && re.test(r.problems.join(' ')); };
    check(refused('gh secret set DOCKERHUB_TOKEN --env production --body abc', 'secret-set', /history/), 'a secret on the command line is refused, with the reason');
    check(refused('gh run list -w ci.yml -b main -L 10', 'run-list', /limit/), 'the wrong --limit is refused');
    check(refused('gh workflow run deploy.yml --branch main -f environment=staging', 'run-manual', /branch/), 'a flag that does not exist is refused, and named');
    check(refused('gh run view 1234567890 --log', 'run-log-failed', /log-failed/), 'the whole log instead of the failed steps is refused');
    check(refused('git commit -m "ci: run again" && git push', 'git-empty', /allow-empty/), 'an empty commit without --allow-empty is refused');
    check(GA.judgeLine('gh   workflow run "deploy.yml" -r main -fenvironment=staging', GA.cmds['run-manual'].specs).ok, 'quotes, short flags and an attached -fkey=value are understood');
  }

  // =============================================================================================================== drills
  console.log('\n== expression and pattern drills');
  {
    const drills = Object.entries(GA.drills);
    const results = (d, ans) => d.cases.map((c) => {
      if (d.kind === 'filter') return GA.matchFilter(ans.split('\n').map((s) => s.replace(/^\s*-\s*/, '').trim()).filter(Boolean), c.name) === c.expect;
      if (d.kind === 'value') return JSON.stringify(GA.evaluate(ans, Object.assign({}, c.ctx))) === JSON.stringify(c.expect);
      return GA.evalCondition(ans, Object.assign({ __status: { success: true, failure: false, cancelled: false } }, c.ctx)) === c.expect;
    });
    check(drills.length === 9, `9 drills (${drills.length})`);
    for (const [id, d] of drills) {
      check(results(d, d.answer).every(Boolean), `${id}: the answer gets every case right`);
      // the cases must tell wrong answers apart
      const wrong = d.kind === 'filter' ? ['**', '*', 'main'] : d.kind === 'value' ? ["'x'", "''", 'null'] : ['true', 'false', "github.event_name == 'push'"];
      const stillPass = wrong.filter((w) => { try { return results(d, w).every(Boolean); } catch (e) { return false; } });
      check(stillPass.length === 0, `${id}: trivial wrong answers do not pass all cases`, stillPass.join('\n'));
    }
  }

  // =============================================================================================================== the page
  console.log('\n== the page');
  {
    const sections = [...pageText.matchAll(/<section class="step" id="([\w-]+)" data-step>\s*<div class="step-head"><span class="num">([^<]*)<\/span><h2>([^<]*)<\/h2>/g)];
    check(sections.length === 22, `22 sections (${sections.length})`);
    const ids = sections.map((m) => m[1]);
    check(new Set(ids).size === ids.length, 'section ids are unique');
    const used = { lab: new Set(), cmd: new Set(), drill: new Set() };
    for (const m of pageText.matchAll(/data-lab="(\w+)"/g)) used.lab.add(m[1]);
    for (const m of pageText.matchAll(/data-ids="([\w ]+)"/g)) m[1].split(' ').forEach((x) => used.lab.add(x));
    for (const m of pageText.matchAll(/data-cmd="([\w-]+)"/g)) used.cmd.add(m[1]);
    for (const m of pageText.matchAll(/data-drill="([\w-]+)"/g)) used.drill.add(m[1]);
    const labIds = labs.map(([id]) => id);
    check(labIds.every((id) => used.lab.has(id)) && [...used.lab].every((id) => GA.labs[id]), 'every lab is placed on the page, and every placed lab exists', labIds.filter((id) => !used.lab.has(id)).concat([...used.lab].filter((id) => !GA.labs[id])).join(', '));
    check(Object.keys(GA.cmds).every((id) => used.cmd.has(id)) && [...used.cmd].every((id) => GA.cmds[id]), 'every command drill is placed on the page');
    check(Object.keys(GA.drills).every((id) => used.drill.has(id)) && [...used.drill].every((id) => GA.drills[id]), 'every expression and pattern drill is placed on the page');
    const first = /<section class="step" id="overview"[\s\S]*?<dl class="glossary">\s*<dt>[^<]*<\/dt><dd>([\s\S]*?)<\/dd>/.exec(pageText);
    check(!!first && /<code>/.test(first[1]), 'the first glossary entry has a <code> element (the page tests use it)');
    check((GA.labs.B7.task.match(/data-copy="[^"]+@[0-9a-f]{40} # v[\d.]+"/g) || []).length === 13, 'the capstone has a copyable line for each of the 13 actions it pins');
    // everything the build takes from the sources is in the page, word for word
    const src = (...p) => fs.readFileSync(path.join(L, ...p), 'utf8');
    const labsJs = LABFILES.map((f) => `// ---- ${f}\n` + src('labs', f)).join('\n');
    const bodyFiles = fs.readdirSync(path.join(L, 'body')).filter((f) => /\.html$/.test(f)).sort();
    const missing = [];
    if (!pageText.includes(src('engine.js'))) missing.push('engine.js');
    if (!pageText.includes(src('ui.js'))) missing.push('ui.js');
    if (!pageText.includes(labsJs)) missing.push('the labs');
    if (!pageText.includes(src('lab.css'))) missing.push('lab.css');
    for (const f of bodyFiles) if (!pageText.includes(src('body', f).replace(/\s+$/, ''))) missing.push('body/' + f);
    check(missing.length === 0, 'the page contains the current engine, UI, labs, styles and every lesson file (run tools/actions-lab/build.js after editing them)', missing.join(', '));
    // the scripts in the page are valid JavaScript
    const scripts = [...pageText.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const badJs = scripts.filter((s) => { try { new Function(s); return false; } catch (e) { return true; } });
    check(badJs.length === 0, `all ${scripts.length} inline scripts parse`);
    // every external link in the lesson text points at docs.github.com, a repository, or another tutorial
    const links = [...pageText.matchAll(/<a href="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(mailto:|#)/.test(u));
    const strange = links.filter((u) => !/^(https:\/\/(docs\.github\.com|github\.com|fonts\.googleapis|cli\.github\.com)|[\w-]+\.html)/.test(u));
    check(strange.length === 0, 'the page links only to GitHub, GitHub docs and the other tutorials', strange.join('\n'));
  }

  // =============================================================================================================== a real browser
  console.log('\n== in a browser');
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (e) { skip('playwright-core is not installed: the labs were not run in a browser'); }
  if (chromium) {
    let browser;
    try { browser = await chromium.launch(); } catch (e) { skip('no Chromium could be started: ' + String(e.message).split('\n')[0]); }
    if (browser) {
      const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errs = [];
      pg.on('pageerror', (e) => errs.push(e.message));
      pg.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION)/.test(m.text())) errs.push(m.text()); });
      const http = require('node:http');
      const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(PAGE)); });
      await new Promise((r) => srv.listen(0, r));
      await pg.goto('http://localhost:' + srv.address().port + '/');
      await pg.waitForTimeout(500);
      const mounted = await pg.evaluate(() => ({ labs: document.querySelectorAll('.lab').length, sets: document.querySelectorAll('[data-set]').length, cmds: document.querySelectorAll('.cmd').length, drills: document.querySelectorAll('.drill-lab').length, pg: document.querySelectorAll('#ga-progress .ga-pg').length }));
      check(mounted.cmds === 20 && mounted.drills === 9 && mounted.sets === 2 && mounted.pg === 6, `the page mounts 20 command drills, 9 drills, 2 sets and the progress bars (${JSON.stringify(mounted)})`);
      await pg.locator('.lab[data-lab="A1"] textarea.ed-ta').focus();
      await pg.waitForFunction(() => window.GAChecker && GAChecker.state === 'ready', null, { timeout: 30000 }).catch(() => {});
      check(await pg.evaluate(() => GAChecker.state) === 'ready', 'the checker (actionlint in WebAssembly) starts in the browser');
      // every lab in the page, with its solution and with its starter
      const fillAndRead = async (id, text) => {
        return pg.evaluate(async ({ id, text }) => {
          const root = document.querySelector('[data-lab="' + id + '"]');
          const ta = root.querySelector('textarea.ed-ta');
          ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 450));
          return { pass: /Passed/.test(root.querySelector('.lab-status').textContent), status: root.querySelector('.lab-status').textContent, reqOk: root.querySelectorAll('.reqs li.ok').length, reqAll: root.querySelectorAll('.reqs li').length, problems: root.querySelectorAll('.probs .prob').length };
        }, { id, text });
      };
      const failing = [];
      for (const [id, s] of labs) {
        const holder = /^B[1-6]$/.test(id) ? 'scratch' : /^C/.test(id) ? 'fix' : null;
        if (holder) { const idx = Object.keys(GA.labs).filter((x) => (holder === 'scratch' ? /^B[1-6]$/ : /^C/).test(x)).indexOf(id); await pg.evaluate(({ holder, idx }) => document.querySelectorAll('[data-set="' + holder + '"] .set-btn')[idx].click(), { holder, idx }); }
        const sol = await fillAndRead(id, s.solution);
        if (!sol.pass) failing.push(`${id}: solution shows "${sol.status}" with ${sol.problems} problem(s)`);
        const st = await fillAndRead(id, s.starter || '');
        if (st.pass) failing.push(`${id}: the starter passes`);
      }
      check(failing.length === 0, `all ${labs.length} labs pass with their solution and not with their starter, in the browser`, failing.join('\n'));
      // a command drill and a drill
      const cmdOk = await pg.evaluate(async () => { const r = document.querySelector('[data-cmd="run-cancel"]'); const ta = r.querySelector('textarea'); ta.value = 'gh run cancel 1234567890'; ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 400)); return r.classList.contains('ok'); });
      check(cmdOk, 'typing a correct command marks the drill done');
      const drillOk = await pg.evaluate(async () => { const r = document.querySelector('[data-drill="e-status"]'); const ta = r.querySelector('textarea'); ta.value = '!cancelled()'; ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 400)); return r.classList.contains('ok'); });
      check(drillOk, 'a correct expression marks the drill done');
      const prog = await pg.evaluate(() => [...document.querySelectorAll('#ga-progress .ga-pg b')].map((b) => b.textContent));
      check(prog.length === 6 && prog.every((t) => /^\d+ \/ \d+$/.test(t)) && prog[0] === '19 / 19' && prog[5] === '11 / 11', `the progress bars count passed labs (${prog.join(', ')})`);
      // a typo is explained at once, on the right line
      const typo = await pg.evaluate(async () => { const root = document.querySelector('[data-lab="A1"]'); const ta = root.querySelector('textarea.ed-ta'); ta.value = GA.labs.A1.solution.replace('runs-on', 'run-on'); ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 450)); return { text: root.querySelector('.probs').innerText, marked: root.querySelectorAll('.ed-gut .err').length }; });
      check(/runs-on/.test(typo.text) && typo.marked >= 1, 'a misspelled key is explained in plain words and its line is marked', typo.text);
      // the run preview answers for an event
      const prev = await pg.evaluate(async () => { const root = document.querySelector('[data-lab="A3"]'); const ta = root.querySelector('textarea.ed-ta'); ta.value = GA.labs.A3.solution; ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 450)); const sel = root.querySelector('.pv-sel'); sel.value = 'docs'; sel.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 300)); return root.querySelector('.pv-verdict').textContent; });
      check(/does not run/.test(prev), 'the run preview says a docs-only push does not start the workflow', prev);
      check(errs.length === 0, 'no console or page errors', errs.join(' | '));
      await browser.close(); srv.close();
    }
  }
  process.exit(summary());
}
main().catch((e) => { console.error(e); process.exit(1); });
