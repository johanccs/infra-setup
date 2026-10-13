// Learn track, level 4 (governance): keep dependencies current, a stable required check with a merge queue, code owners.
(function () {
  'use strict';
  var GA = window.GA, H = GA.h, lab = GA.lab, dl = GA.dl;

  lab({
    id: 'A17', assist: 'dependabot', tag: 'Lab 17', title: 'Let Dependabot keep everything current', level: 3, lint: false, preview: false,
    task: '<p>Pinned actions, NuGet packages, npm packages and base images all go out of date. Write <code>.github/dependabot.yml</code> so Dependabot opens pull requests for all four, once a week:</p><ol><li><code>version: 2</code>, and one entry under <code>updates</code> for each: <code>github-actions</code> (directory <code>/</code>), <code>nuget</code> (<code>/src/api</code>), <code>npm</code> (<code>/src/ui</code>) and <code>docker</code> (both <code>/src/api</code> and <code>/src/ui</code>, as a list with <code>directories</code>).</li><li>Every entry has <code>schedule.interval: weekly</code>.</li><li>Put all GitHub Actions updates into <b>one</b> pull request with <code>groups</code> (a group called <code>actions</code> with <code>patterns: [\'*\']</code>).</li><li>For <code>nuget</code> and <code>npm</code>, wait 7 days after a new release before proposing it: <code>cooldown</code> with <code>default-days: 7</code>.</li></ol>',
    starter: 'version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n    schedule:\n      interval: daily\n',
    solution: 'version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n    schedule:\n      interval: weekly\n    groups:\n      actions:\n        patterns: [\'*\']\n  - package-ecosystem: nuget\n    directory: /src/api\n    schedule:\n      interval: weekly\n    cooldown:\n      default-days: 7\n  - package-ecosystem: npm\n    directory: /src/ui\n    schedule:\n      interval: weekly\n    cooldown:\n      default-days: 7\n  - package-ecosystem: docker\n    directories:\n      - /src/api\n      - /src/ui\n    schedule:\n      interval: weekly\n',
    checks: [
      { label: '<code>version: 2</code>', test: function (d) { return d.version === 2; } },
      { label: 'There is an entry for <code>github-actions</code>, <code>nuget</code>, <code>npm</code> and <code>docker</code>', test: function (d) { var e = H.list(d.updates).map(function (u) { return u['package-ecosystem']; }); return ['github-actions', 'nuget', 'npm', 'docker'].every(function (x) { return e.indexOf(x) >= 0; }); } },
      { label: 'Directories: <code>/</code> for actions, <code>/src/api</code> for NuGet, <code>/src/ui</code> for npm', test: function (d) { var f = function (n) { return H.list(d.updates).filter(function (u) { return u['package-ecosystem'] === n; })[0] || {}; }; return f('github-actions').directory === '/' && f('nuget').directory === '/src/api' && f('npm').directory === '/src/ui'; } },
      { label: '<code>docker</code> uses <code>directories</code> with <code>/src/api</code> and <code>/src/ui</code>', test: function (d) { var u = H.list(d.updates).filter(function (x) { return x['package-ecosystem'] === 'docker'; })[0]; return !!u && H.list(u.directories).indexOf('/src/api') >= 0 && H.list(u.directories).indexOf('/src/ui') >= 0 && u.directory === undefined; } },
      { label: 'Every entry runs weekly', test: function (d) { var u = H.list(d.updates); return u.length >= 4 && u.every(function (x) { return x.schedule && x.schedule.interval === 'weekly'; }); } },
      { label: 'GitHub Actions updates are grouped: group <code>actions</code> with <code>patterns: [\'*\']</code>', test: function (d) { var u = H.list(d.updates).filter(function (x) { return x['package-ecosystem'] === 'github-actions'; })[0]; var g = u && u.groups && u.groups.actions; return !!g && H.list(g.patterns).indexOf('*') >= 0; } },
      { label: '<code>nuget</code> and <code>npm</code> have <code>cooldown.default-days: 7</code>', test: function (d) { return ['nuget', 'npm'].every(function (n) { var u = H.list(d.updates).filter(function (x) { return x['package-ecosystem'] === n; })[0]; return !!u && u.cooldown && Number(u.cooldown['default-days']) === 7; }); } },
    ],
    traps: [
      { test: function (d) { var ok = ['bazel', 'bun', 'bundler', 'cargo', 'composer', 'conda', 'deno', 'devcontainers', 'docker', 'docker-compose', 'dotnet-sdk', 'helm', 'mix', 'julia', 'elm', 'gitsubmodule', 'github-actions', 'gomod', 'gradle', 'maven', 'nix', 'npm', 'nuget', 'opentofu', 'pip', 'pre-commit', 'pub', 'rust-toolchain', 'sbt', 'swift', 'terraform', 'uv', 'vcpkg']; return H.list(d.updates).some(function (u) { return u && u['package-ecosystem'] && ok.indexOf(u['package-ecosystem']) < 0; }); }, msg: 'That is not a Dependabot package ecosystem name. The ones you need are <code>github-actions</code>, <code>nuget</code>, <code>npm</code> and <code>docker</code> (note the hyphen in the first).', line: function (t) { return H.lineOf(t, /package-ecosystem/); } },
      { test: function (d) { return H.list(d.updates).some(function (u) { return u && u.directory !== undefined && u.directories !== undefined; }); }, msg: 'Use <code>directory</code> for one folder or <code>directories</code> for a list, not both.' },
      { test: function (d) { return H.list(d.updates).some(function (u) { return u && !(u.schedule && u.schedule.interval); }); }, msg: 'Every entry needs <code>schedule.interval</code> (<code>daily</code>, <code>weekly</code>, <code>monthly</code>, …).' },
    ],
    hints: ['Every entry has the same three keys: <code>package-ecosystem</code>, <code>directory</code> (or <code>directories</code>) and <code>schedule</code>.', '<code>groups</code> sits inside an entry. The group\'s name (<code>actions</code>) is a key, and <code>patterns</code> lists which dependencies belong to it. <code>\'*\'</code> needs quotes in YAML.', '<code>cooldown</code> is a map: <code>default-days: 7</code>.'],
    explain: dl([
      ['<code>github-actions</code> with <code>directory: /</code>', 'For actions, <code>/</code> means: look in <code>.github/workflows</code> and the root <code>action.yml</code>. Dependabot understands <code>uses: owner/repo@&lt;sha&gt; # v1.2.3</code> and updates the SHA and the comment together.'],
      ['<code>groups</code>', 'Without it, Dependabot opens a pull request for every dependency. A group turns all matching updates into one.'],
      ['<code>cooldown</code>', 'A new release is not proposed until it is that many days old. Most malicious releases are caught within days, so a short wait is cheap protection. Version updates get a 3-day default cooldown even with none configured; security updates are never delayed.'],
      ['More ecosystems', 'The Todo project also has Helm charts (<code>helm</code>), Terraform (<code>terraform</code>) and a pinned SDK (<code>dotnet-sdk</code>). Dependabot supports each with the same shape.'],
    ]),
  });

  lab({
    id: 'A18', tag: 'Lab 18', title: 'One required check, ready for a merge queue', level: 5,
    task: '<p>The ruleset on <code>main</code> will require status checks. Requiring <code>api</code> and <code>ui</code> by name breaks the day you rename or add a job, and a skipped required job counts as passed. Real teams require <b>one</b> stable check that summarises the rest.</p><ol><li>Start the workflow on <code>merge_group</code> as well as <code>pull_request</code> (without it, nothing runs when a pull request enters the merge queue, and it can never merge).</li><li>Add a job <code>ci-ok</code> that <code>needs</code> both <code>api</code> and <code>ui</code> and <b>always runs</b> (<code>if: always()</code>), so it still reports when they fail.</li><li>Its single step must fail the job when any needed job failed or was cancelled: <code>if: contains(needs.*.result, \'failure\') || contains(needs.*.result, \'cancelled\')</code> and <code>run: exit 1</code>.</li></ol><p>You then require only <code>ci-ok</code> in the ruleset (a setting, not YAML).</p>',
    starter: 'name: CI\non:\n  pull_request:\n    branches: [main]\njobs:\n  api:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build and test the API"\n  ui:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build and test the UI"\n',
    solution: 'name: CI\non:\n  pull_request:\n    branches: [main]\n  merge_group:\njobs:\n  api:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build and test the API"\n  ui:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build and test the UI"\n  ci-ok:\n    needs: [api, ui]\n    if: always()\n    runs-on: ubuntu-latest\n    steps:\n      - name: Fail if a job failed or was cancelled\n        if: contains(needs.*.result, \'failure\') || contains(needs.*.result, \'cancelled\')\n        run: exit 1\n',
    preview: { preset: 'pr', presets: ['pr', 'merge-queue'] },
    checks: [
      { label: 'The workflow starts on <code>merge_group</code> and still on <code>pull_request</code>', test: function (d) { var o = H.on(d); return o.merge_group !== undefined && o.pull_request !== undefined; } },
      { label: '<code>ci-ok</code> needs <code>api</code> and <code>ui</code>', test: function (d) { var n = H.list((H.job(d, 'ci-ok') || {}).needs); return n.indexOf('api') >= 0 && n.indexOf('ui') >= 0; } },
      { label: '<code>ci-ok</code> always runs: <code>if: always()</code>', test: function (d) { var j = H.job(d, 'ci-ok'); if (!j || j.if === undefined) return false; var ctx = function (a, b) { return { needs: { api: { result: a }, ui: { result: b } }, __status: { success: false, failure: a === 'failure' || b === 'failure', cancelled: false } }; }; return H.evalIf(j.if, ctx('failure', 'success')) === true && H.evalIf(j.if, ctx('success', 'success')) === true && /always\s*\(\s*\)/.test(String(j.if)); } },
      { label: 'The step fails the job when a needed job failed or was cancelled', test: function (d) { var st = H.steps(H.job(d, 'ci-ok') || {}).filter(function (s) { return /exit\s+1/.test(s.run || '') && s.if !== undefined; })[0]; if (!st) return false; var ctx = function (a, b) { return { needs: { api: { result: a }, ui: { result: b } } }; }; return H.evalIf(st.if, ctx('failure', 'success')) === true && H.evalIf(st.if, ctx('success', 'cancelled')) === true && H.evalIf(st.if, ctx('success', 'success')) === false; } },
    ],
    traps: [
      { test: function (d) { var j = H.job(d, 'ci-ok'); return j && j.if === undefined; }, msg: 'Without <code>if: always()</code> the gate job is <em>skipped</em> when <code>api</code> fails, and a skipped job reports success, so the required check would pass.' },
      { test: function (d) { var o = H.on(d); return o.merge_group === undefined && o.pull_request !== undefined && H.job(d, 'ci-ok'); }, msg: 'Add <code>merge_group:</code> to <code>on</code>. A merge queue starts workflows with the <code>merge_group</code> event only, so a required check that does not listen for it never reports.' },
    ],
    hints: ['<code>merge_group:</code> needs no options. Add it next to <code>pull_request</code>.', 'A job with <code>needs</code> is skipped when a needed job fails, unless it has a status check function in its <code>if</code>: <code>always()</code> keeps it running.', '<code>needs.*.result</code> is the list of every needed job\'s result, so <code>contains(needs.*.result, \'failure\')</code> asks "did any fail?".'],
    explain: dl([
      ['<code>merge_group</code>', 'A merge queue builds a temporary branch with your change on top of the latest <code>main</code> and the changes ahead of it, and runs your required checks there. It starts workflows with the <code>merge_group</code> event (type <code>checks_requested</code>).'],
      ['A skipped job is a success', 'A job skipped by <code>if</code> reports success. A whole workflow skipped by a path filter reports nothing at all, so a check that is required stays "pending" for ever. That is why you should not put path filters on required workflows.'],
      ['The gate job', '<code>ci-ok</code> always runs and always reports. Rename or add jobs freely: the required check stays <code>ci-ok</code>. <code>needs.*.result</code> collects the results of every job it needs.'],
    ]),
  });

  // CODEOWNERS: the last matching line wins. The checker handles the patterns GitHub documents for the common cases.
  function codeowners(text) {
    return text.split('\n').map(function (l) { return l.replace(/\s+#.*$/, '').trim(); }).filter(function (l) { return l && l[0] !== '#'; }).map(function (l) { var p = l.split(/\s+/); return { pattern: p[0], owners: p.slice(1) }; });
  }
  function patRe(p) {
    var anchored = p[0] === '/', dir = p[p.length - 1] === '/';
    var core = p.replace(/^\//, '').replace(/\/$/, '');
    var re = core.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
    if (core === '*' ) return /.*/;
    return new RegExp((anchored || core.indexOf('/') >= 0 ? '^' : '(^|/)') + re + (dir || !/\.[a-z0-9]+$/i.test(core) ? '(/.*)?' : '') + '$');
  }
  GA.codeownersFor = function (text, path) { var o = []; codeowners(text).forEach(function (r) { if (patRe(r.pattern).test(path)) o = r.owners; }); return o; };
  lab({
    id: 'A19', tag: 'Lab 19', title: 'Who must review changes to the pipeline', level: 3, lint: false, preview: false, format: 'text',
    task: '<p>Anyone who can edit a workflow can read its secrets and change what gets deployed. Make sure the right people review those files. Write <code>.github/CODEOWNERS</code> so that:</p><ol><li>the team <code>@octo-org/todo-devs</code> owns everything by default (<code>*</code>);</li><li>the team <code>@octo-org/platform</code> owns <code>/.github/</code> (workflows and Dependabot settings) and <code>/infra/</code>;</li><li>the file stays in order: <b>the last matching line wins</b>, so the specific rules come after <code>*</code>.</li></ol><p>Then, in the ruleset for <code>main</code>, you turn on "Require review from Code Owners". That part is a setting.</p>',
    starter: '# Each line is a pattern, then its owners\n*  @octo-org/todo-devs\n',
    solution: '# Each line is a pattern, then its owners\n*  @octo-org/todo-devs\n/.github/  @octo-org/platform\n/infra/    @octo-org/platform\n',
    checks: [
      { label: 'Everything is owned by <code>@octo-org/todo-devs</code> by default', test: function (d, t) { return GA.codeownersFor(t, 'src/api/Program.cs').join(' ') === '@octo-org/todo-devs'; } },
      { label: 'Files under <code>.github/</code> belong to <code>@octo-org/platform</code> alone', test: function (d, t) { return GA.codeownersFor(t, '.github/workflows/ci.yml').join(' ') === '@octo-org/platform' && GA.codeownersFor(t, '.github/dependabot.yml').join(' ') === '@octo-org/platform'; } },
      { label: 'Files under <code>infra/</code> belong to <code>@octo-org/platform</code> alone', test: function (d, t) { return GA.codeownersFor(t, 'infra/terraform/cluster/main.tf').join(' ') === '@octo-org/platform'; } },
      { label: 'Application code is still owned by the dev team, not by platform', test: function (d, t) { return GA.codeownersFor(t, 'src/ui/src/app/app.ts').join(' ') === '@octo-org/todo-devs'; } },
    ],
    traps: [
      { test: function (d, t) { var r = codeowners(t); var star = r.findIndex(function (x) { return x.pattern === '*'; }); return star > 0 && r.slice(0, star).some(function (x) { return /github|infra/.test(x.pattern); }); }, msg: 'The last matching line wins. A rule written <em>before</em> <code>*</code> is overridden by it. Put the specific rules after the general one.' },
      { test: function (d, t) { return codeowners(t).some(function (x) { return /^!/.test(x.pattern); }); }, msg: '<code>!</code> negation does not work in CODEOWNERS (it does in <code>.gitignore</code>).' },
      { test: function (d, t) { return codeowners(t).some(function (x) { return x.owners.some(function (o) { return !/^@[\w.-]+(\/[\w.-]+)?$/.test(o) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o); }); }); }, msg: 'An owner is <code>@username</code>, <code>@org/team-name</code> or an email address.' },
    ],
    hints: ['A line is a pattern, spaces, then the owners. All owners of one pattern go on the <b>same</b> line.', 'A pattern that starts with <code>/</code> is anchored to the repository root. One that ends with <code>/</code> matches a directory and everything below it.', 'The order matters: the last pattern that matches a file decides its owners.'],
    explain: dl([
      ['Last match wins', 'For <code>.github/workflows/ci.yml</code> both <code>*</code> and <code>/.github/</code> match. The later one wins, so only platform is requested.'],
      ['Teams need write access', 'A user or team listed here must have write access to the repository, or the line assigns no owner.'],
      ['Required, not just requested', 'Owners are requested automatically, but a review is only <em>required</em> if the ruleset says "Require review from Code Owners". The file is read from the pull request\'s base branch, so a pull request cannot change its own reviewers.'],
    ]),
  });
})();
