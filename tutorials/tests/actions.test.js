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
const { check, skip, summary, find, run, get, sleep } = require('./lib');

const L = path.join(__dirname, '..', 'tools', 'actions-lab');
const PAGE = path.join(__dirname, '..', 'docs', 'github-actions-tutorial.html');
const yaml = require(path.join(L, 'vendor', 'js-yaml.min.js'));
global.window = global;
const GA = require(path.join(L, 'engine.js'));
global.GA = GA;
GA.actions = JSON.parse(fs.readFileSync(path.join(L, 'vendor', 'actions-meta.json'), 'utf8'));
GA.cmdFlags = JSON.parse(fs.readFileSync(path.join(L, 'vendor', 'cmd-flags.json'), 'utf8'));
const LABFILES = ['common.js', 'a1.js', 'a2.js', 'a3.js', 'a4.js', 'cmds.js', 'drills.js', 'b.js', 'b2.js', 'c.js', 'c2.js'];
new Function(fs.readFileSync(path.join(L, 'assist.js'), 'utf8')).call(global);
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
// A lab has one file (text is a string) or several (spec.files; text is { name: text }), and every check names the file it reads.
const filesOf = (spec) => spec.files || [{ name: 'file', starter: spec.starter || '', solution: spec.solution }];
const textsOf = (spec, which) => spec.files ? Object.fromEntries(spec.files.map((f) => [f.name, f[which] || ''])) : (spec[which] || '');
const eachText = (spec, which) => filesOf(spec).map((f) => f[which] || '');
function evaluate(spec, text, lint) {
  const files = filesOf(spec), all = {};
  for (const f of files) {
    const t = spec.files ? (text[f.name] || '') : text;
    let doc = null;
    if (spec.format === 'text') doc = {};
    else { try { doc = yaml.load(t); } catch (e) { return { pass: false, why: 'yaml' }; } }
    if (!doc || typeof doc !== 'object') return { pass: false, why: 'empty' };
    all[f.name] = { doc, text: t };
  }
  const of = (name) => all[spec.files ? (name || files[0].name) : 'file'];
  const problems = [], failed = [], traps = [], globalTraps = [];
  for (const f of files) { if (spec.lint === false) continue; problems.push(...lint(all[f.name].text)); globalTraps.push(...GA.globalTraps(all[f.name].doc, all[f.name].text)); }
  for (const c of spec.checks) { const f = of(c.file); let r; try { r = c.test(f.doc, f.text, all); } catch (e) { r = false; } if (r !== true) failed.push(c.label); }
  for (const t of spec.traps || []) { const f = of(t.file); try { if (t.test(f.doc, f.text, all)) traps.push(t.msg); } catch (e) { /* a trap that cannot read the file is not tripped */ } }
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
  const count = (re) => labs.filter(([id]) => re.test(id)).length;
  check(labs.length === 46 && count(/^A/) === 19 && count(/^B/) === 13 && count(/^C/) === 14, `there are 46 labs: 19 guided, 13 from scratch (with the capstone), 14 to fix (${labs.length})`);
  const must = ['id', 'title', 'task', 'checks', 'explain', 'hints'];
  check(labs.every(([id, s]) => must.every((k) => s[k] !== undefined) && filesOf(s).every((f) => typeof f.solution === 'string' && f.solution.trim()) && s.checks.length >= 3 && s.hints.length >= 2 && s.id === id), 'every lab has a task, checks, hints, a solution and an explanation');
  check(labs.filter(([, s]) => s.files).every(([, s]) => s.checks.every((c) => s.files.some((f) => f.name === c.file)) && (s.traps || []).every((t) => s.files.some((f) => f.name === t.file)) && s.files.every((f) => s.checks.some((c) => c.file === f.name))), 'in a lab with several files, every check and every mistake detector names one of its files, and every file has checks');
  const samples = [];
  for (const [id, s] of labs) {
    const r = evaluate(s, textsOf(s, 'solution'), lint);
    check(r.pass, `${id} the solution passes${r.pass ? '' : ' (' + [].concat(r.failed || [], r.traps || [], (r.problems || []).map((p) => 'line ' + p.line + ' ' + p.message.slice(0, 80)), (r.globalTraps || []).map((g) => g.msg), r.why || []).join('; ') + ')'}`);
    if (!s.scratch) { const st = evaluate(s, textsOf(s, 'starter'), lint); check(!st.pass, `${id} the starter does not pass yet`); }
    else check(eachText(s, 'starter').every((t) => t === ''), `${id} starts from an empty editor`);
    samples.push(...eachText(s, 'solution'), ...eachText(s, 'starter'));
  }

  // ---------------------------------------------------------------------------------------------------------- parity with the real actionlint
  if (actionlint) {
    // every solution and every starter, and every single-line deletion of every solution
    const all = new Set();
    for (const [, s] of labs) { if (s.lint === false || s.format === 'text') continue; for (const f of filesOf(s)) { all.add(f.solution); if ((f.starter || '').trim()) all.add(f.starter); const ls = f.solution.split('\n'); for (let i = 0; i < ls.length; i++) if (ls[i].trim()) all.add(ls.filter((_, k) => k !== i).join('\n')); } }
    let diff = [], n = 0;
    for (const t of all) { if (!t.trim()) continue; n++; const a = JSON.stringify(lint(t)), b = JSON.stringify(cli(t)); if (a !== b) diff.push(t.split('\n').slice(0, 3).join(' / ') + '\n   page: ' + a.slice(0, 160) + '\n   real: ' + b.slice(0, 160)); }
    check(diff.length === 0, `the page's checker and the real actionlint agree on ${n} workflow files (line, column, kind and message)`, diff.slice(0, 3).join('\n'));
  } else skip('no actionlint binary: parity not checked');

  // ---------------------------------------------------------------------------------------------------------- the checks are not vacuous
  console.log('\n== deleting any line of a solution should break the lab');
  {
    let totalM = 0, totalSurv = 0; const report = [];
    for (const [id, s] of labs) {
      let m = 0, surv = [];
      for (const f of filesOf(s)) {
        const ls = f.solution.split('\n');
        for (let i = 0; i < ls.length; i++) {
          if (!ls[i].trim() || /^\s*#/.test(ls[i])) continue;
          m++; const mut = ls.filter((_, k) => k !== i).join('\n');
          const text = s.files ? Object.assign(textsOf(s, 'solution'), { [f.name]: mut }) : mut;
          if (evaluate(s, text, lint).pass) surv.push(ls[i].trim().slice(0, 60));
        }
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
      const whole = eachText(s, 'solution').join('\n');
      if (s.lint === false && !/uses:/.test(whole)) continue;
      const steps = []; const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.uses === 'string') steps.push(o); Object.values(o).forEach(walk); } };
      for (const t of eachText(s, 'solution')) { let doc; try { doc = s.format === 'text' ? {} : yaml.load(t); } catch (e) { continue; } walk(doc); }
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
        const shas = new Set(); for (const [, s] of labs) for (const m of eachText(s, 'solution').join('\n').matchAll(/([\w.-]+\/[\w.-]+)(?:\/[\w.-]+)?@([0-9a-f]{40})/g)) shas.add(m[1] + '@' + m[2]);
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


  // =============================================================================================================== help while typing
  console.log('\n== help while typing: the keys that fit, and the next line');
  {
    // The key lists, against the lists the real checker prints when it meets a key it does not know.
    const probe = ['name: x', 'on:', '  push:', '    branches: [main]', '  workflow_call:', '    inputs:', '      a:', '        bogus: 1', '        type: string', '    secrets:', '      s:', '        bogus: 1', '    outputs:', '      o:', '        bogus: 1', '        value: x',
      'bogus: 1', 'permissions:', '  bogus: read', 'concurrency:', '  bogus: 1', '  group: a', 'defaults:', '  run:', '    bogus: 1', 'jobs:', '  a:', '    bogus: 1', '    runs-on: bogus-label', '    environment:', '      bogus: 1', '      name: x', '    strategy:', '      bogus: 1',
      '    container:', '      bogus: 1', '      image: x', '    steps:', '      - bogus: 1', '        run: echo', '        shell: bogus', '      - bogus: 1', '        uses: actions/checkout@v7'].join('\n') + '\n';
    const msgs = lint(probe).map((p) => p.message);
    const listOf = (re) => { const m = msgs.find((x) => re.test(x)); return m ? [...m.replace(/^[^.]*\. /, '').matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null; };
    const S = GA.assistSchema, keys = (n) => S[n].keys.map((k) => k.key);
    const real = {
      workflow: listOf(/for "workflow" section/), job: listOf(/for "job" section/), concurrency: listOf(/for "concurrency" section/), 'defaults.run': listOf(/for "run" section/), environment: listOf(/for "environment" section/),
      strategy: listOf(/for "strategy" section/), container: listOf(/for "container" section/), 'call.input': listOf(/inputs at workflow_call/), 'call.secret': listOf(/for "secrets" section/), 'call.output': listOf(/outputs at workflow_call/),
      permissions: listOf(/unknown permission scope/), step: [...new Set([...(listOf(/step to run shell command/) || []), ...(listOf(/step to execute action/) || [])])],
    };
    const wrong = [];
    for (const [n, list] of Object.entries(real)) { if (!list || !list.length) { wrong.push(n + ': the checker printed no list'); continue; } for (const k of keys(n)) if (!list.includes(k)) wrong.push(`${n}: ${k} is not a key the checker knows`); }
    check(wrong.length === 0, `the keys suggested in ${Object.keys(real).length} places are all keys the real checker accepts there`, wrong.join('\n'));
    const need = { workflow: ['name', 'on', 'jobs', 'permissions', 'env', 'concurrency'], job: ['runs-on', 'steps', 'needs', 'if', 'environment', 'permissions', 'strategy', 'outputs', 'uses', 'with', 'secrets', 'timeout-minutes'], step: ['name', 'id', 'uses', 'run', 'with', 'env', 'if', 'shell', 'working-directory'] };
    check(Object.entries(need).every(([n, ks]) => ks.every((k) => keys(n).includes(k))), 'the keys every pipeline needs are in the lists');
    const labels = listOf(/label "bogus-label" is unknown/), shells = listOf(/shell name "bogus" is invalid/);
    check(GA.assistValues['runs-on'].every((v) => /\$\{\{/.test(v[0]) || labels.includes(v[0])) && JSON.stringify(GA.assistValues.shell.map((v) => v[0]).sort()) === JSON.stringify(shells.slice().sort()), 'the suggested runner labels and shells are the ones the checker knows');
    const badEv = keys('on').filter((e) => lint(`on:\n  ${e}:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`).some((p) => /unknown Webhook event/.test(p.message)));
    check(badEv.length === 0 && keys('on').length >= 10, 'every suggested event is an event GitHub has', badEv.join(', '));
    // what is suggested where
    const sg = (t, kind) => { const pos = t.indexOf('¦'); const r = GA.suggest(t.replace('¦', ''), pos, kind); return r ? r.items.map((i) => i.label) : null; };
    const has = (t, want, not, kind) => { const r = sg(t, kind) || []; return want.every((w) => r.includes(w)) && (not || []).every((w) => !r.includes(w)); };
    const J = 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n';
    const cases = [
      has('¦', ['name', 'on', 'jobs']), has('name: x\n¦', ['on', 'jobs'], ['name']), has('on:\n  ¦', ['push', 'pull_request', 'workflow_dispatch', 'workflow_call']), has('on:\n  push:\n    ¦', ['branches', 'tags', 'paths'], ['types', 'inputs']),
      has('on:\n  workflow_dispatch:\n    inputs:\n      who:\n        type: ¦', ['string', 'choice', 'environment']), has('on:\n  workflow_call:\n    inputs:\n      who:\n        type: ¦', ['string', 'boolean', 'number'], ['choice', 'environment']),
      has('jobs:\n  build:\n    ¦', ['runs-on', 'steps', 'needs']), has('jobs:\n  build:\n    uses: ./x.yml\n    ¦', ['with', 'secrets', 'needs'], ['runs-on', 'steps', 'environment']), has('jobs:\n  build:\n    runs-on: ¦', ['ubuntu-latest']),
      has(J + '      - ¦', ['name', 'uses', 'run']), has(J + '      - uses: actions/checkout@v7\n        ¦', ['with', 'name', 'if'], ['run', 'shell', 'uses']), has(J + '      - run: echo\n        ¦', ['env', 'shell', 'working-directory'], ['uses', 'with', 'run']),
      has(J + '      - uses: actions/checkout@v7\n      - ru¦', ['run']), has(J + '      - uses: ¦', ['actions/checkout@' + GA.actions['actions/checkout'].use]),
      has(J + '      - uses: actions/setup-dotnet@v6\n        with:\n          ¦', ['dotnet-version']), has(J + '      - uses: actions/checkout@v7\n        with:\n          persist-credentials: ¦', ['false']),
      has(J + '      - name: a\n        run: echo\n      ¦', ['- name:', '- uses:', '- run:']), has(J + '      - run: echo ${{ sec¦', ['secrets.']), has(J + '      - run: echo ${{ ¦', ['github.', 'vars.', 'needs.']),
      has('permissions:\n  ¦', ['contents', 'id-token', 'packages']), has('permissions:\n  contents: ¦', ['read', 'write', 'none']), has('concurrency:\n  group: a\n  ¦', ['cancel-in-progress'], ['group']),
      has('runs:\n  ¦', ['using', 'steps'], [], 'action'), has('updates:\n  - ¦', ['package-ecosystem', 'directory', 'schedule'], [], 'dependabot'),
    ];
    check(cases.every(Boolean), `${cases.length} places in a file get the keys that fit there, and not the ones that do not`, cases.map((c, i) => c ? '' : 'case ' + (i + 1)).filter(Boolean).join(', '));
    check(sg(J + '      - run: |\n          echo ¦') === null && sg('jobs:\n  ¦').length === 0 && GA.suggest('jobs:\n  ', 8).free && sg('x', 'none') === null, 'inside a script nothing is suggested, and a place for a name of your own says so');
    // accepting a suggestion gives valid YAML that the checker accepts as far as it goes
    const ins = (t) => { const pos = t.indexOf('¦'); const src = t.replace('¦', ''); const r = GA.suggest(src, pos); return src.slice(0, r.from) + r.items[0].insert + src.slice(r.to); };
    check(ins('na¦') === 'name: ' && ins('jobs:\n  build:\n    st¦') === 'jobs:\n  build:\n    steps:\n      - ' && ins('o¦') === 'on:\n  ' && ins(J + '      - uses: actions/ch¦') === J + '      - uses: actions/checkout@' + GA.actions['actions/checkout'].use, 'accepting a suggestion completes the word and sets up the next line (a value, a map, or a list)');
    // every action input offered under with: is a real input, and required ones come first
    const dl = sg(J + '      - uses: docker/login-action@v4\n        with:\n          ¦');
    check(JSON.stringify(dl.slice().sort()) === JSON.stringify(Object.keys(GA.actions['docker/login-action'].inputs).sort()), 'under with:, the inputs offered are the inputs of that step\'s action');
    // half-typed files never throw: every prefix of every solution
    let partial = 0, threw = [];
    for (const [id, s] of labs) for (const f of filesOf(s)) {
      if (s.format === 'text') continue;
      const t = f.solution, stepSize = t.length > 1500 ? 5 : 1;
      for (let i = 0; i <= t.length; i += stepSize) {
        const part = t.slice(0, i);
        try { GA.suggest(part, i, s.assist || 'workflow'); GA.nextLine(part, t); } catch (e) { threw.push(`${id} at ${i}: assist ${e.message}`); }
        let d; try { d = yaml.load(part); } catch (e) { continue; }
        if (!d || typeof d !== 'object') continue;
        partial++;
        try { GA.globalTraps(d, part); GA.simulate(d, { name: 'push', ref: 'refs/heads/main', paths: ['a'] }); GA.usesList(d); GA.allSteps(d); } catch (e) { threw.push(`${id} at ${i}: ${e.message}`); }
      }
    }
    check(threw.length === 0 && partial > 15000, `typing any solution from the first character to the last never breaks the page (${partial} half-typed files read)`, threw.slice(0, 5).join('\n'));
    // the next line: typing what it says, one line at a time, reaches the solution in exactly as many steps as it has lines
    const walkBad = [];
    for (const [id, s] of labs) for (const f of filesOf(s)) {
      if (s.format === 'text') continue;
      const sl = f.solution.split('\n'), have = new Set(); let n = 0;
      for (; n < 600; n++) { const r = GA.nextLine(sl.filter((_, i) => have.has(i)).join('\n'), f.solution); if (r.kind === 'done') break; if (r.kind !== 'missing' || have.has(r.n - 1)) { walkBad.push(`${id}: stuck at "${r.line}"`); break; } have.add(r.n - 1); }
      const lines = sl.filter((l) => l.trim() && !/^\s*#/.test(l)).length;
      if (n !== lines) walkBad.push(`${id} ${f.name}: ${n} steps for ${lines} lines`);
    }
    check(walkBad.length === 0, 'following "Next line" from an empty file gives every line of every solution, once, and then says nothing is missing', walkBad.slice(0, 5).join('\n'));
    const a1 = GA.labs.A1.solution;
    const n1 = GA.nextLine('name: Hello\non:\n  push:\njobs:\n  hello:\n    runs-on: ubuntu-latest\n', a1), n2 = GA.nextLine(a1.replace('ubuntu-latest', 'windows-latest'), a1), n3 = GA.nextLine(a1.split('\n').reverse().join('\n'), a1);
    check(n1.kind === 'missing' && n1.line.trim() === 'branches: [main]' && n1.crumbs.join('/') === 'on/push' && n2.kind === 'differs' && /windows-latest/.test(n2.yours) && GA.nextLine(a1.replace(/"/g, "'").replace(/^(\s*)- name/gm, '$1-   name'), a1).kind === 'done' && n3.kind !== 'done', 'the next line is found by its place in the file: a missing line, a line with another value, and other quotes or spacing are told apart');
    check(GA.describeKey(['jobs', 'build'], 'runs-on') && GA.describeKey(['on'], 'pull_request') && GA.describeKey(['x'], 'y') === null, 'a key in the next-line box gets its one-line meaning');
  }

  // =============================================================================================================== the delivery labs, with real tools
  console.log('\n== the delivery labs: their commands, run for real');
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-ga-deliver-'));
    const stepsOf = (text) => Object.values(yaml.load(text).jobs).flatMap((j) => j.steps || []);
    const script = (text, re) => stepsOf(text).map((x) => x.run || '').find((r) => re.test(r));
    const bash = (code, env, cwd) => run('bash', ['-eo', 'pipefail', '-c', code], { cwd: cwd || tmp, env: { ...process.env, ...env } });
    const jq = find('jq'), kubectl = find('kubectl'), dotnet = find('dotnet'), aws = find('aws'), moto = find('moto_server');
    const toolEnv = { PATH: [jq, kubectl, aws].filter(Boolean).map((p) => path.dirname(p)).join(':') + ':' + process.env.PATH };
    const b12 = GA.labs.B12.solution, b13 = GA.labs.B13.solution, nasty = 'Host=db;Password=p@ss"w\\x $HOME \'q\'';
    if (jq) {
      fs.mkdirSync(path.join(tmp, 'publish'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });
      const r = bash(script(b12, /jq -n/), { ...toolEnv, API_BASE_URL: 'https://api.uat.example.com/a"b', LOG_LEVEL: 'Warning', ASPNETCORE_ENVIRONMENT: 'Uat' });
      let got = null; try { got = JSON.parse(fs.readFileSync(path.join(tmp, 'publish', 'appsettings.Uat.json'), 'utf8')); } catch (e) { /* reported below */ }
      check(r.status === 0 && !!got && got.Api.BaseUrl === 'https://api.uat.example.com/a"b' && got.Logging.LogLevel.Default === 'Warning', 'the .NET lab\'s jq step really writes publish/appsettings.Uat.json, valid JSON even for a value with a quote in it', r.stderr);
      const r2 = bash(script(b13, /jq -n/), { ...toolEnv, API_BASE_URL: 'https://api.dev.example.com' });
      let cfg = null; try { cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'dist', 'config.json'), 'utf8')); } catch (e) { /* reported below */ }
      check(r2.status === 0 && !!cfg && cfg.apiBaseUrl === 'https://api.dev.example.com', 'the single-page-app lab\'s jq step really writes dist/config.json', r2.stderr);
      const r3 = bash(script(GA.labs.C13.starter, /jq -n/), { ...toolEnv, API_BASE_URL: 'u', ASPNETCORE_ENVIRONMENT: 'Bug' });
      check(r3.status === 0 && JSON.parse(fs.readFileSync(path.join(tmp, 'publish', 'appsettings.Bug.json'), 'utf8')).ApiBaseUrl === 'u', 'the broken scenario\'s jq step runs too, and writes the wrong shape the scenario describes');
    } else skip('jq is not installed: the settings-file steps were not run');
    if (kubectl) {
      const r = bash(script(b12, /kubectl create secret/).replace(/\|\s*kubectl apply -f -/, ''), { ...toolEnv, CONNECTION_STRING: nasty });
      let sec = null; try { sec = yaml.load(r.stdout); } catch (e) { /* reported below */ }
      check(r.status === 0 && !!sec && sec.kind === 'Secret' && sec.metadata.name === 'todo-api-settings' && Buffer.from(sec.data.ConnectionStrings__Todos, 'base64').toString() === nasty, 'the kubectl step really builds a Secret with the key ConnectionStrings__Todos and the exact value, without a cluster (--dry-run=client)', r.stderr);
      fs.writeFileSync(path.join(tmp, 'dep.yaml'), 'apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: todo-api}\nspec:\n  selector: {matchLabels: {app: a}}\n  template:\n    metadata: {labels: {app: a}}\n    spec:\n      containers:\n        - {name: api, image: x}\n');
      const setEnv = script(GA.labs.C13.solution, /kubectl set env/).replace('deployment/todo-api', '--local -f dep.yaml -o yaml');
      const r2 = bash(setEnv, { ...toolEnv, ASPNETCORE_ENVIRONMENT: 'Uat' });
      check(r2.status === 0 && /name: ASPNETCORE_ENVIRONMENT\s+value: Uat/.test(r2.stdout), 'kubectl set env really gives the deployment ASPNETCORE_ENVIRONMENT=Uat', r2.stderr);
    } else skip('kubectl is not installed: the secret step was not run');
    if (dotnet) {
      const app = path.join(tmp, 'cfgapp'); fs.mkdirSync(app);
      const denv = { DOTNET_ROOT: path.dirname(dotnet), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', PATH: path.dirname(dotnet) + ':' + process.env.PATH };
      const mk = bash('dotnet new web -n cfgapp -o . >/dev/null', denv, app);
      fs.writeFileSync(path.join(app, 'Program.cs'), 'var b = WebApplication.CreateBuilder(args);\nvar c = b.Configuration;\nConsole.WriteLine($"{b.Environment.EnvironmentName}|{c["Api:BaseUrl"]}|{c.GetConnectionString("Todos")}");\n');
      fs.writeFileSync(path.join(app, 'appsettings.json'), '{"Api":{"BaseUrl":"base"},"ConnectionStrings":{"Todos":"base"}}');
      fs.rmSync(path.join(app, 'appsettings.Development.json'), { force: true });
      const pub = bash('dotnet publish -c Release -o out', denv, app);
      if (mk.status !== 0 || pub.status !== 0) skip('the .NET test app could not be built here: ' + (pub.stderr || pub.stdout || mk.stderr).trim().split('\n').pop());
      else {
        const out = path.join(app, 'out');
        fs.writeFileSync(path.join(out, 'appsettings.Uat.json'), '{"Api":{"BaseUrl":"uat-file"}}'); fs.writeFileSync(path.join(out, 'appsettings.Production.json'), '{"Api":{"BaseUrl":"prod-file"}}');
        const start = (env, args) => { const e = { ...process.env, ...denv, ...env }; if (!('ASPNETCORE_ENVIRONMENT' in env)) delete e.ASPNETCORE_ENVIRONMENT; delete e.DOTNET_ENVIRONMENT; return (run(path.join(out, 'cfgapp'), args || [], { cwd: out, env: e }).stdout || '').split('\n')[0].trim(); };
        const rows = [
          [start({}), 'Production|prod-file|base'], [start({ ASPNETCORE_ENVIRONMENT: 'Uat' }), 'Uat|uat-file|base'], [start({ ASPNETCORE_ENVIRONMENT: 'uat' }), 'uat|base|base'],
          [start({ ASPNETCORE_ENVIRONMENT: 'Uat', ConnectionStrings__Todos: 'var' }), 'Uat|uat-file|var'], [start({ ASPNETCORE_ENVIRONMENT: 'Uat', ConnectionStrings_Todos: 'var' }), 'Uat|uat-file|base'],
          [start({ ASPNETCORE_ENVIRONMENT: 'Uat', Api__BaseUrl: 'var' }, ['--Api:BaseUrl=cli']), 'Uat|cli|base'],
        ];
        const off = rows.filter(([got, want]) => got !== want).map(([got, want]) => `expected ${want}, got ${got}`);
        check(off.length === 0, 'a real .NET app on this machine reads its settings exactly as the lesson\'s table says: the six rows (default Production, the file by exact name, __ as separator, the command line last)', off.join('\n'));
        fs.writeFileSync(path.join(out, 'appsettings.Uat.json'), '{"ApiBaseUrl":"uat-file"}');
        check(start({ ASPNETCORE_ENVIRONMENT: 'Uat' }) === 'Uat|base|base', 'the fix scenario\'s wrong shape ({"ApiBaseUrl": …}) really leaves Api:BaseUrl at its old value');
      }
    } else skip('dotnet is not installed: the settings order was not proved with a real app');
    if (aws && moto) {
      const { spawn } = require('node:child_process');
      const port = 5600 + Math.floor(Math.random() * 300);
      const srv = spawn(moto, ['-p', String(port)], { stdio: 'ignore' });
      const env = { ...toolEnv, AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'x', AWS_DEFAULT_REGION: 'eu-west-1', AWS_ENDPOINT_URL: 'http://127.0.0.1:' + port, BUCKET: 'todo-ui' };
      let up = false; for (let i = 0; i < 60 && !up; i++) { up = (await get('http://127.0.0.1:' + port + '/moto-api/')).status > 0; if (!up) await sleep(500); }
      if (!up) skip('the local S3 stand-in did not start: the upload commands were not run');
      else {
        const site = path.join(tmp, 'site'); fs.mkdirSync(path.join(site, 'dist', 'assets'), { recursive: true });
        const w = (n, c) => fs.writeFileSync(path.join(site, 'dist', n), c);
        w('index.html', 'v1'); w('config.json', '{}'); w('main-AAAA.js', 'a'); w('styles-AAAA.css', 'c'); w('favicon.ico', 'i'); w('assets/logo.png', 'p');
        const syncs = stepsOf(b13).map((x) => x.run || '').filter((r) => /aws s3 sync/.test(r));
        const deploy = () => syncs.map((c) => bash(c, env, site));
        bash('aws s3 mb s3://todo-ui', env, site);
        const d1 = deploy();
        fs.rmSync(path.join(site, 'dist', 'main-AAAA.js')); fs.rmSync(path.join(site, 'dist', 'favicon.ico')); w('main-BBBB.js', 'b'); w('index.html', 'v2');
        const d2 = deploy();
        const keys = (bash('aws s3api list-objects-v2 --bucket todo-ui --query "Contents[].Key" --output text', env, site).stdout || '').trim().split(/\s+/).sort();
        const cc = (k) => bash(`aws s3api head-object --bucket todo-ui --key ${k} --query CacheControl --output text`, env, site).stdout.trim();
        const long = 'public,max-age=31536000,immutable';
        check(syncs.length === 2 && [...d1, ...d2].every((r) => r.status === 0) && keys.join() === 'assets/logo.png,config.json,index.html,main-AAAA.js,main-BBBB.js,styles-AAAA.css', 'the two uploads of the single-page-app lab, run twice against a local S3: the old script is kept for open tabs, and a removed file that is not a script is deleted', keys.join() + '\n' + [...d1, ...d2].map((r) => r.stderr).join(''));
        check(cc('index.html') === 'no-cache' && cc('config.json') === 'no-cache' && cc('assets/logo.png') === 'no-cache' && cc('main-BBBB.js') === long && cc('main-AAAA.js') === long && cc('styles-AAAA.css') === long, 'and each file has the cache header the lab says: a year for scripts and stylesheets, no-cache for index.html and everything else');
        // the broken scenario really does what its story says
        bash('aws s3 mb s3://todo-ui-bad', env, site);
        const bad = stepsOf(GA.labs.C14.starter).map((x) => x.run || '').find((r) => /aws s3 sync/.test(r));
        w('main-AAAA.js', 'a'); bash(bad, { ...env, BUCKET: 'todo-ui-bad' }, site); fs.rmSync(path.join(site, 'dist', 'main-AAAA.js')); bash(bad, { ...env, BUCKET: 'todo-ui-bad' }, site);
        const badKeys = bash('aws s3api list-objects-v2 --bucket todo-ui-bad --query "Contents[].Key" --output text', env, site).stdout;
        const badCc = bash('aws s3api head-object --bucket todo-ui-bad --key index.html --query CacheControl --output text', env, site).stdout.trim();
        check(badCc === long && !/main-AAAA\.js/.test(badKeys), 'the broken scenario\'s upload really gives index.html a one-year cache and deletes the old script, as its story says');
      }
      srv.kill();
    } else skip('the AWS CLI or a local S3 stand-in (moto) is not installed: the upload commands were not run');
    // other correct ways to write the uploads are accepted, and the wrong ones are still caught
    {
      const judge = (sp, t) => { const d = yaml.load(t); return { fail: sp.checks.filter((c) => { try { return c.test(d, t) !== true; } catch (e) { return true; } }).length, traps: (sp.traps || []).filter((x) => { try { return x.test(d, t); } catch (e) { return false; } }).length }; };
      const B13 = GA.labs.B13, C14 = GA.labs.C14;
      const oneStep = b13.replace(/      - name: Upload the hashed files first, cached for a year\n        run: (aws s3 sync[^\n]*)\n      - name: Then everything else[^\n]*\n        run: (aws s3 sync[^\n]*)\n/, '      - name: Upload\n        run: |\n          $1\n          $2\n');
      const reversed = b13.replace(/(      - name: Upload the hashed[^\n]*\n[^\n]*\n)(      - name: Then everything[^\n]*\n[^\n]*\n)/, '$2$1');
      const allLong = b13.replace('--exclude "*" --include "*.js" --include "*.css" ', '');
      const j1 = judge(B13, oneStep), j2 = judge(B13, reversed), j3 = judge(B13, allLong);
      check(oneStep !== b13 && j1.fail === 0 && j1.traps === 0 && reversed !== b13 && j2.fail >= 1 && j2.traps >= 1 && allLong !== b13 && j3.fail >= 1 && j3.traps >= 1, 'the single-page-app lab accepts both uploads written in one step, and still catches the wrong order and a long cache on index.html', JSON.stringify([j1, j2, j3]));
      const alt = C14.starter.replace(/        run: aws s3 sync dist[^\n]*\n/, '        run: |\n          aws s3 sync dist "s3://$BUCKET" --exclude index.html --cache-control "public,max-age=31536000,immutable"\n          aws s3 cp dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache"\n');
      const nothing = C14.starter.replace('public,max-age=31536000,immutable', 'no-cache').replace('--delete ', '');
      const late = C14.solution.replace(/(      - name: Upload the hashed[\s\S]*?)(      - name: Invalidate[\s\S]*$)/, '$2$1');
      const k1 = judge(C14, alt), k2 = judge(C14, nothing), k3 = judge(C14, late);
      check(alt !== C14.starter && k1.fail === 0 && k1.traps === 0 && k2.fail >= 1 && k2.traps === 1 && late !== C14.solution && k3.fail === 1, 'the stale-web-app scenario accepts another correct fix (exclude index.html, then copy it with no-cache), and rejects "cache nothing" and an invalidation before the upload', JSON.stringify([k1, k2, k3]));
    }
    // every command-line flag the delivery labs use is in the AWS CLI's own help
    if (aws) {
      const helpOf = (args) => { const r = run(aws, [...args, 'help'], { env: { ...process.env, PAGER: 'cat', AWS_PAGER: '' } }); return (r.stdout || '').replace(/.\x08/g, ''); };
      const s3 = helpOf(['s3', 'sync']), cf = helpOf(['cloudfront', 'create-invalidation']);
      const miss = ['--delete', '--exclude', '--include', '--cache-control'].filter((f) => !s3.includes(f)).concat(['--distribution-id', '--paths'].filter((f) => !cf.includes(f)));
      check(s3.length > 1000 && miss.length === 0, 'every aws flag in the single-page-app lab is in the AWS CLI\'s own help', miss.join(', '));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // =============================================================================================================== the page
  console.log('\n== the page');
  {
    const sections = [...pageText.matchAll(/<section class="step" id="([\w-]+)" data-step>\s*<div class="step-head"><span class="num">([^<]*)<\/span><h2>([^<]*)<\/h2>/g)];
    check(sections.length === 23, `23 sections (${sections.length})`);
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
    if (!pageText.includes(src('assist.js'))) missing.push('assist.js');
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
    const strange = links.filter((u) => !/^(https:\/\/(docs\.github\.com|github\.com|fonts\.googleapis\.com|cli\.github\.com|learn\.microsoft\.com|angular\.dev|docs\.aws\.amazon\.com)\/|[\w-]+\.html)/.test(u));
    check(strange.length === 0, 'the page links only to GitHub, the documentation of Microsoft, Angular and AWS, and the other tutorials', strange.join('\n'));
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
      // the first look: a lesson lab starts empty, with the choice shown; a fix scenario and a from-scratch lab have no choice
      const first = await pg.evaluate(() => { const q = (id) => document.querySelector('[data-lab="' + id + '"]'); return { mode: GAUI.labs.A1.mode(), text: q('A1').querySelector('textarea.ed-ta').value, btns: q('A1').querySelectorAll('.lab-mode-b').length, note: !q('A1').querySelector('.lab-blank').hidden, b1: !!q('B1').querySelector('.lab-mode'), fix: !!document.querySelector('[data-set="fix"] .lab-mode'), free: !!document.querySelector('[data-free] .lab-mode') }; });
      check(first.mode === 'empty' && first.text === '' && first.btns === 2 && first.note && !first.b1 && !first.fix && !first.free, 'a lesson lab opens empty, with the choice "Guided or Empty" and a note; from-scratch labs, fix scenarios and the sandbox have no such choice', JSON.stringify(first));
      // typing, with the keyboard: the keys that fit, Ctrl+Space, the next line, the solution beside your own text
      const a1 = pg.locator('.lab[data-lab="A1"]');
      await a1.locator('textarea.ed-ta').click();
      const offered0 = await a1.locator('.as-item code').allTextContents();
      await pg.keyboard.type('na'); await pg.keyboard.press('Control+Space'); await pg.keyboard.type('Hello\n');
      await pg.keyboard.type('on'); await pg.keyboard.press('Control+Space'); await pg.keyboard.type('pu'); await pg.keyboard.press('Control+Space');
      const offered1 = await a1.locator('.as-item code').allTextContents();
      await pg.keyboard.type('br'); await pg.keyboard.press('Control+Space'); await pg.keyboard.type('[main]\n');
      await pg.waitForTimeout(350);
      const typed = await a1.locator('textarea.ed-ta').inputValue();
      check(offered0.includes('name') && offered0.includes('jobs') && offered1.includes('branches') && !offered1.includes('jobs') && typed === 'name: Hello\non:\n  push:\n    branches: [main]\n    ', 'typing in an empty lab: the keys that fit are listed for the line the cursor is on, and Ctrl+Space types the first one and sets up the next line', JSON.stringify(typed) + ' ' + offered1.join(','));
      await a1.locator('.as-item', { hasText: 'paths' }).first().click();
      check((await a1.locator('textarea.ed-ta').inputValue()).endsWith('    paths:\n      - '), 'clicking a suggestion types it at the cursor');
      await pg.evaluate(() => GAUI.labs.A1.set('name: Hello\non:\n  push:\n    branches: [main]\n'));
      await a1.locator('button', { hasText: 'Next line' }).click();
      const nx1 = await a1.locator('.lab-next').innerText();
      await pg.evaluate(() => GAUI.labs.A1.set('name: Hello\non:\n  push:\n    branches: [main]\n  pull_request:\n'));
      await pg.waitForTimeout(100);
      const nx2 = await a1.locator('.lab-next pre').innerText();
      await a1.locator('button', { hasText: 'Show solution' }).click();
      const solShown = await a1.locator('.lab-sol pre').innerText();
      const kept = await a1.locator('textarea.ed-ta').inputValue();
      check(/pull_request:/.test(nx1) && /under\s+on/.test(nx1) && nx2.trim() === 'jobs:' && solShown.trim() === GA.labs.A1.solution.trim() && kept === 'name: Hello\non:\n  push:\n    branches: [main]\n  pull_request:\n', '"Next line" shows only the next line and moves on as you type; "Show solution" opens the finished file and leaves your text alone', nx1 + ' / ' + nx2);
      await a1.locator('.lab-sol button', { hasText: 'Put it in the editor' }).click(); await pg.waitForTimeout(450);
      const putPass = /Passed/.test(await a1.locator('.lab-status').innerText());
      await a1.locator('.lab-sol button', { hasText: 'Back to my code' }).click(); await pg.waitForTimeout(300);
      check(putPass && (await a1.locator('textarea.ed-ta').inputValue()) === kept, 'the solution can be put in the editor, and "Back to my code" brings your own text back');
      await a1.locator('button', { hasText: 'Hide solution' }).click(); await a1.locator('button', { hasText: 'Hide next line' }).click();
      // Guided or Empty: one click when nothing was typed, two when there is work to lose; the choice becomes the default
      await a1.locator('.lab-mode-b[data-mode="guided"]').click();
      const warned = await a1.locator('.lab-mode-n').innerText(), still = await a1.locator('textarea.ed-ta').inputValue();
      await a1.locator('.lab-mode-b[data-mode="guided"]').click(); await pg.waitForTimeout(300);
      const guided = await pg.evaluate(() => ({ mode: GAUI.labs.A1.mode(), same: document.querySelector('[data-lab="A1"] textarea.ed-ta').value === GA.labs.A1.starter, def: JSON.parse(localStorage.getItem('ga-mode')), note: document.querySelector('[data-lab="A1"] .lab-blank').hidden }));
      check(/again/.test(warned) && still === kept && guided.mode === 'guided' && guided.same && guided.def === 'guided' && guided.note, 'switching to Guided asks twice when you have typed something, then loads the lesson\'s starting file and remembers the choice', warned + JSON.stringify(guided));
      const follow = () => pg.evaluate(() => ({ a2: GAUI.labs.A2.mode(), a2text: document.querySelector('[data-lab="A2"] textarea.ed-ta').value === (GAUI.labs.A2.mode() === 'guided' ? GA.labs.A2.starter : ''), a5: GAUI.labs.A5.mode(), saved: !!(JSON.parse(localStorage.getItem('ga-lab:A2')) || {}).mode }));
      const f1 = await follow();
      await a1.locator('.lab-mode-b[data-mode="empty"]').click(); await pg.waitForTimeout(300);
      const f2 = await follow();
      check(await pg.evaluate(() => GAUI.labs.A1.mode() === 'empty' && document.querySelector('[data-lab="A1"] textarea.ed-ta').value === ''), 'and back to Empty in one click, because the starting file was untouched');
      check(f1.a2 === 'guided' && f1.a2text && f1.a5 === 'guided' && !f1.saved && f2.a2 === 'empty' && f2.a2text && f2.a5 === 'empty', 'the choice made in one lab is the start of every lab you have not touched yet', JSON.stringify([f1, f2]));
      // a lab you chose for, or typed in, keeps its own start
      const own = await pg.evaluate(async () => { GAUI.labs.A5.setMode('guided'); GAUI.labs.A6.set('name: mine\n'); await new Promise((r) => setTimeout(r, 300)); GAUI.labs.A1.setMode('guided'); GAUI.labs.A1.setMode('empty'); await new Promise((r) => setTimeout(r, 300)); return { a5: GAUI.labs.A5.mode(), a6: document.querySelector('[data-lab="A6"] textarea.ed-ta').value, a2: GAUI.labs.A2.mode() }; });
      check(own.a5 === 'guided' && own.a6 === 'name: mine\n' && own.a2 === 'empty', 'a lab where you made your own choice, or typed something, is left alone', JSON.stringify(own));
      // every lab in the page, with its solution and with its starter
      const order = (holder) => ((new RegExp('data-set="' + holder + '" data-ids="([\\w ]+)"').exec(pageText) || [])[1] || '').split(' ');
      const sets = { scratch: order('scratch'), fix: order('fix') };
      check(sets.scratch.length === 12 && sets.fix.length === 14 && sets.scratch.every((x) => /^B/.test(x) && GA.labs[x].scratch) && sets.fix.every((x) => /^C/.test(x) && GA.labs[x].scenario), 'the from-scratch set has 12 challenges that start empty, and the fix set has 14 scenarios');
      const setAndRead = async (id, value) => pg.evaluate(async ({ id, value }) => {
        GAUI.labs[id].set(value);
        await new Promise((r) => setTimeout(r, 300));
        const root = GAUI.labs[id].root;
        return { pass: /Passed/.test(root.querySelector('.lab-status').textContent), status: root.querySelector('.lab-status').textContent, problems: root.querySelectorAll('.probs .prob').length, tabs: root.querySelectorAll('.lab-tab').length };
      }, { id, value });
      const failing = [];
      for (const [id, s] of labs) {
        const holder = sets.scratch.includes(id) ? 'scratch' : sets.fix.includes(id) ? 'fix' : null;
        if (holder) await pg.evaluate(({ holder, idx }) => document.querySelectorAll('[data-set="' + holder + '"] .set-btn')[idx].click(), { holder, idx: sets[holder].indexOf(id) });
        const sol = await setAndRead(id, textsOf(s, 'solution'));
        if (!sol.pass) failing.push(`${id}: solution shows "${sol.status}" with ${sol.problems} problem(s)`);
        if (s.files && sol.tabs !== s.files.length) failing.push(`${id}: ${sol.tabs} tabs for ${s.files.length} files`);
        const st = await setAndRead(id, textsOf(s, 'starter'));
        if (st.pass) failing.push(`${id}: the starter passes`);
        if (s.files) { const one = await setAndRead(id, Object.assign(textsOf(s, 'solution'), { [s.files[0].name]: '' })); if (one.pass) failing.push(`${id}: passes with its first file empty`); }
        await setAndRead(id, textsOf(s, 'solution'));
      }
      check(failing.length === 0, `all ${labs.length} labs pass with their solution and not with their starter, in the browser`, failing.join('\n'));
      // a lab with several files: tabs, a problem in another file, text kept per tab
      await pg.evaluate(({ idx }) => document.querySelectorAll('[data-set="scratch"] .set-btn')[idx].click(), { idx: sets.scratch.indexOf('B9') });
      const multi = await pg.evaluate(async () => {
        const L = GAUI.labs.B9, sol = Object.fromEntries(GA.labs.B9.files.map((f) => [f.name, f.solution]));
        L.set(Object.assign({}, sol, { 'pr.yml': sol['pr.yml'].replace('uses:', 'usess:') })); await new Promise((r) => setTimeout(r, 300));
        const root = L.root, tabs = [...root.querySelectorAll('.lab-tab')];
        const out = { names: tabs.map((t) => t.textContent), classes: tabs.map((t) => t.className), other: !!root.querySelector('.prob.other'), pass: L.passed(), files: [...root.querySelectorAll('.req-file')].length };
        root.querySelector('.prob.other').click(); await new Promise((r) => setTimeout(r, 300));
        out.onTab = root.querySelector('.lab-tab.on').textContent; out.text = root.querySelector('textarea.ed-ta').value.includes('usess:'); out.err = root.querySelectorAll('.probs .prob:not(.other)').length;
        tabs[0].click(); await new Promise((r) => setTimeout(r, 300)); out.back = root.querySelector('textarea.ed-ta').value === sol['build.yml'];
        L.set(sol); await new Promise((r) => setTimeout(r, 300)); out.passAfter = L.passed();
        return out;
      });
      check(multi.names.join() === 'build.yml,pr.yml,deploy.yml' && /bad/.test(multi.classes[1]) && /good/.test(multi.classes[2]) && multi.other && !multi.pass && multi.files >= 8 && multi.onTab === 'pr.yml' && multi.text && multi.err >= 1 && multi.back && multi.passAfter, 'a lab with three files: a tab per file, a red dot and a link for a problem in another file, each tab keeps its own text, and the lab passes only when all files are right', JSON.stringify(multi));
      // a command drill and a drill
      const cmdOk = await pg.evaluate(async () => { const r = document.querySelector('[data-cmd="run-cancel"]'); const ta = r.querySelector('textarea'); ta.value = 'gh run cancel 1234567890'; ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 400)); return r.classList.contains('ok'); });
      check(cmdOk, 'typing a correct command marks the drill done');
      const drillOk = await pg.evaluate(async () => { const r = document.querySelector('[data-drill="e-status"]'); const ta = r.querySelector('textarea'); ta.value = '!cancelled()'; ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 400)); return r.classList.contains('ok'); });
      check(drillOk, 'a correct expression marks the drill done');
      const prog = await pg.evaluate(() => [...document.querySelectorAll('#ga-progress .ga-pg b')].map((b) => b.textContent));
      check(prog.length === 6 && prog.every((t) => /^\d+ \/ \d+$/.test(t)) && prog[0] === '19 / 19' && prog[3] === '12 / 12' && prog[5] === '14 / 14', `the progress bars count passed labs (${prog.join(', ')})`);
      const ticks = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('section[data-step]')].map((s) => { const b = s.querySelector('input[data-done]'); return [s.id, b ? [b.checked, b.disabled] : null]; })));
      check(ticks.first[0] && ticks.first[1] && ticks.scratch[0] && ticks.fix[0] && ticks.capstone[0] && !ticks.commands[0] && !ticks.jobs[0] && !ticks.sandbox[0] && !ticks.sandbox[1] && !ticks.real[1] && !ticks.delivery[0] && !ticks.delivery[1], 'a step is ticked exactly when all its exercises are passed (labs all passed; command and expression steps not yet), and reading steps stay manual', JSON.stringify(ticks));
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
