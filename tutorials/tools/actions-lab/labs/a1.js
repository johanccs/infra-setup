// Learn track, level 1: the first workflow, building the .NET API, choosing when it runs, jobs that depend on each other.
(function () {
  'use strict';
  var GA = window.GA, H = GA.h, lab = GA.lab, dl = GA.dl;

  lab({
    id: 'A1', tag: 'Lab 1', title: 'Hello from the runner', level: 1,
    task: '<p>The file below already runs, but it only echoes <code>TODO</code> on every push. Change it so that:</p><ol><li>it starts on pushes to <code>main</code> only, and on every pull request;</li><li>it runs on a GitHub-hosted Ubuntu machine;</li><li>one step prints the repository name, using the <code>github</code> context;</li><li>another step prints the runner\'s operating system, using the <code>runner</code> context.</li></ol>',
    starter: 'name: Hello\n# 1. When: pushes to main, and pull requests\non: push\njobs:\n  hello:\n    # 2. Where: a GitHub-hosted Ubuntu machine\n    runs-on: ubuntu-latest\n    steps:\n      # 3 and 4. What: print the repository, then the operating system\n      - run: echo "TODO"\n',
    solution: 'name: Hello\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  hello:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Say hello\n        run: echo "Hello from ${{ github.repository }}"\n      - name: Show the machine\n        run: echo "This runs on ${{ runner.os }}"\n',
    checks: [
      { label: 'Starts on pushes to <code>main</code> only', test: function (d) { var p = H.on(d).push; return !!p && H.list(p.branches).indexOf('main') >= 0 && H.list(p.branches).length === 1; } },
      { label: 'Also starts on <code>pull_request</code>', test: function (d) { return H.on(d).pull_request !== undefined; } },
      { label: 'Runs on <code>ubuntu-latest</code>', test: function (d) { var js = Object.values(H.jobs(d)); return js.length > 0 && js.every(function (j) { return j['runs-on'] === 'ubuntu-latest'; }); } },
      { label: 'A step prints <code>${{ github.repository }}</code>', test: function (d) { return /\$\{\{\s*github\.repository\s*\}\}/.test(H.runText(d)); } },
      { label: 'A step prints <code>${{ runner.os }}</code>', test: function (d) { return /\$\{\{\s*runner\.os\s*\}\}/.test(H.runText(d)); } },
    ],
    traps: [
      { test: function (d) { var p = H.on(d).push; return p && H.list(p.branches).indexOf('master') >= 0; }, msg: 'The default branch of the repository you built is <code>main</code>, not <code>master</code>.' },
      { test: function (d, t) { return /\$\{\{\s*github\.repo\s*\}\}/.test(t); }, msg: '<code>github.repo</code> is not a property. The name of the repository is <code>github.repository</code>.', line: function (t) { return H.lineOf(t, /github\.repo\s*\}/); } },
    ],
    hints: ['In YAML, a trigger with options is a map: <code>push:</code> on one line, then <code>branches: [main]</code> indented under it.', 'Two events side by side go under <code>on:</code> as two keys. <code>pull_request:</code> with nothing after it means "every pull request".', 'A context is read inside <code>${{ }}</code>: <code>${{ github.repository }}</code> and <code>${{ runner.os }}</code>.'],
    explain: dl([
      ['<code>on:</code>', 'The events that start the workflow. Each key is an event; the options for it sit below.'],
      ['<code>branches: [main]</code>', 'Only pushes to <code>main</code> start it. Without this filter every push to every branch would.'],
      ['<code>jobs: hello:</code>', 'A job. <code>hello</code> is its id, used by other jobs to refer to it.'],
      ['<code>runs-on</code>', 'The kind of machine. GitHub starts a fresh <code>ubuntu-latest</code> virtual machine for the job and throws it away afterwards.'],
      ['<code>steps</code>', 'A list. Each step runs a shell command (<code>run</code>) or an action (<code>uses</code>). They run in order, on the same machine.'],
      ['<code>${{ … }}</code>', 'An expression. GitHub replaces it with the value <b>before</b> the shell sees the command. <code>github</code> and <code>runner</code> are contexts: objects full of facts about the run.'],
    ]),
  });

  lab({
    id: 'A2', tag: 'Lab 2', title: 'Build and test the .NET API', level: 1,
    task: '<p>Turn the placeholder into a real build for the Todo API (<code>src/api</code>). In this order, the job must:</p><ol><li>check out the code with <code>actions/checkout</code>;</li><li>install .NET 10 with <code>actions/setup-dotnet</code> (any <code>10.0.x</code> patch);</li><li><b>restore</b> the packages, then <b>build</b> without restoring again (<code>--no-restore</code>), then <b>test</b> without building again (<code>--no-build</code>).</li></ol><p>Use the current major version of each action. The checker knows which one that is.</p>',
    starter: 'name: API CI\non:\n  pull_request:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: src/api\n    steps:\n      # 1. the code   2. .NET 10   3. restore, build, test\n      - run: echo "TODO"\n',
    solution: 'name: API CI\non:\n  pull_request:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: src/api\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-dotnet@v6\n        with:\n          dotnet-version: 10.0.x\n      - run: dotnet restore\n      - run: dotnet build --no-restore --configuration Release\n      - run: dotnet test --no-build --configuration Release\n',
    checks: [
      { label: 'Checks out the code with <code>actions/checkout@v7</code>', test: function (d) { return H.hasStepUses(d, 'actions/checkout', function (s, u) { return H.isCurrent(u); }); } },
      { label: 'Installs .NET 10 with <code>actions/setup-dotnet@v6</code> and <code>dotnet-version</code>', test: function (d) { return H.hasStepUses(d, 'actions/setup-dotnet', function (s, u) { return H.isCurrent(u) && s.with && /^10(\.|$)/.test(String(s.with['dotnet-version'])); }); } },
      { label: 'Runs <code>dotnet restore</code>', test: function (d) { return /dotnet restore/.test(H.runText(d)); } },
      { label: 'Builds with <code>dotnet build --no-restore</code>', test: function (d) { return /dotnet build\b[^\n]*--no-restore/.test(H.runText(d)); } },
      { label: 'Tests with <code>dotnet test --no-build</code>', test: function (d) { return /dotnet test\b[^\n]*--no-build/.test(H.runText(d)); } },
      { label: 'The steps are in the right order', test: function (d) { var t = H.runText(d), a = t.indexOf('dotnet restore'), b = t.indexOf('dotnet build'), c = t.indexOf('dotnet test'); var s = H.all(d).map(function (x) { return x.uses ? GA.parseUses(x.uses).repo : 'run'; }); return a >= 0 && a < b && b < c && s.indexOf('actions/checkout') < s.indexOf('actions/setup-dotnet') && s.indexOf('actions/setup-dotnet') < s.indexOf('run'); } },
    ],
    traps: [
      { test: function (d) { var t = H.runText(d), b = t.indexOf('dotnet build'), c = t.indexOf('dotnet test'); return b >= 0 && c >= 0 && c < b; }, msg: '<code>dotnet test</code> comes before <code>dotnet build</code>. With <code>--no-build</code> it would test code that was never built.', line: function (t) { return H.lineOf(t, /dotnet test/); } },
      { test: function (d) { return H.hasStepUses(d, 'actions/setup-dotnet', function (s) { return s.with && s.with['dotnet-version'] !== undefined && !/^\d/.test(String(s.with['dotnet-version'])); }); }, msg: '<code>dotnet-version</code> is a version such as <code>10.0.x</code>, not a name.', line: function (t) { return H.lineOf(t, /dotnet-version/); } },
    ],
    hints: ['<code>uses: actions/checkout@v7</code> needs no <code>with:</code>. <code>setup-dotnet</code> does: its input is <code>dotnet-version</code>.', 'The three <code>dotnet</code> commands can be three separate <code>run</code> steps, or one <code>run: |</code> block with three lines.', 'The job sets <code>working-directory: src/api</code> for every <code>run</code> step, so you can write <code>dotnet restore</code> without a path.'],
    explain: dl([
      ['<code>defaults.run.working-directory</code>', 'Every <code>run</code> step in this job starts in <code>src/api</code>. Steps with <code>uses</code> are not affected.'],
      ['<code>actions/checkout@v7</code>', 'Downloads your repository onto the runner. A fresh runner has nothing, so nearly every job starts with this.'],
      ['<code>actions/setup-dotnet@v6</code>', 'Installs the SDK you ask for. GitHub-hosted runners already carry some versions, but this makes the version part of the file, so a build today and one next year use the same SDK.'],
      ['<code>--no-restore</code>, <code>--no-build</code>', 'Each command reuses the work of the one before. Without them, <code>build</code> would restore again and <code>test</code> would build again.'],
    ]),
  });

  lab({
    id: 'A3', tag: 'Lab 3', title: 'Choose when it runs', level: 2,
    task: '<p>The build runs on every push to every branch. Change the <code>on:</code> block so that it runs:</p><ol><li>on pushes to <code>main</code> and to any <code>release/**</code> branch, but not when only files under <code>docs/</code> changed;</li><li>on pull requests into <code>main</code>, only when something under <code>src/</code> changed;</li><li>when someone starts it by hand (<code>workflow_dispatch</code>) with a <code>choice</code> input called <code>configuration</code>: options <code>Debug</code> and <code>Release</code>, default <code>Release</code>;</li><li>every Monday at 06:30 UTC.</li></ol><p>Below the editor, the preview shows what would happen for different events. Try them.</p>',
    starter: 'name: API CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet build src/api\n',
    solution: 'name: API CI\non:\n  push:\n    branches:\n      - main\n      - \'release/**\'\n    paths-ignore:\n      - \'docs/**\'\n  pull_request:\n    branches: [main]\n    paths:\n      - \'src/**\'\n  workflow_dispatch:\n    inputs:\n      configuration:\n        description: Build configuration\n        type: choice\n        options: [Debug, Release]\n        default: Release\n  schedule:\n    - cron: \'30 6 * * 1\'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet build src/api\n',
    preview: { preset: 'push-main' },
    checks: [
      { label: 'A push to <code>main</code> that changes code runs it', test: function (d) { return GA.eventMatches(d, { name: 'push', ref: 'refs/heads/main', paths: ['src/api/Program.cs'] }).runs; } },
      { label: 'A push to <code>release/1.4</code> runs it, a push to <code>feature/login</code> does not', test: function (d) { return GA.eventMatches(d, { name: 'push', ref: 'refs/heads/release/1.4', paths: ['src/ui/main.ts'] }).runs && !GA.eventMatches(d, { name: 'push', ref: 'refs/heads/feature/login', paths: ['src/api/Program.cs'] }).runs; } },
      { label: 'A push to <code>main</code> that only changes <code>docs/</code> does not run it', test: function (d) { return !GA.eventMatches(d, { name: 'push', ref: 'refs/heads/main', paths: ['docs/README.md', 'docs/setup/ci.md'] }).runs; } },
      { label: 'A pull request into <code>main</code> runs it only when <code>src/</code> changed', test: function (d) { var pr = function (p, b) { return GA.eventMatches(d, { name: 'pull_request', ref: 'refs/pull/7/merge', base_ref: b || 'main', action: 'opened', paths: p }).runs; }; return pr(['src/api/Program.cs']) && !pr(['README.md']) && !pr(['src/api/Program.cs'], 'develop'); } },
      { label: '<code>workflow_dispatch</code> has a <code>choice</code> input <code>configuration</code> (Debug, Release; default Release)', test: function (d) { var i = (H.on(d).workflow_dispatch || {}).inputs; var c = i && i.configuration; return !!c && c.type === 'choice' && H.list(c.options).indexOf('Debug') >= 0 && H.list(c.options).indexOf('Release') >= 0 && c.default === 'Release'; } },
      { label: 'A schedule runs it on Mondays at 06:30 (<code>30 6 * * 1</code>)', test: function (d) { var s = H.on(d).schedule; return H.list(s).some(function (x) { return x && /^30 6 \* \* (1|MON)$/i.test(String(x.cron).trim()); }); } },
    ],
    traps: [
      { test: function (d) { var p = H.on(d).push; return p && p.branches && p['branches-ignore']; }, msg: '<code>branches</code> and <code>branches-ignore</code> cannot be used together for the same event. Use <code>branches</code> with <code>!pattern</code> entries to include and exclude.' },
      { test: function (d, t) { return /cron:\s*['"]?@/.test(t); }, msg: 'Shortcuts such as <code>@weekly</code> are not supported. Write the five cron fields.', line: function (t) { return H.lineOf(t, /cron:/); } },
      { test: function (d) { var p = H.on(d).push; return p && H.list(p.paths).length && p['paths-ignore']; }, msg: '<code>paths</code> and <code>paths-ignore</code> cannot be used together for the same event.' },
    ],
    hints: ['A branch pattern with <code>/</code> or <code>*</code> in it must be quoted in YAML: <code>\'release/**\'</code>. <code>**</code> matches slashes, so <code>release/1.4</code> and <code>release/1.4/hotfix</code> both match.', 'To skip pushes that touch only docs, use <code>paths-ignore: [\'docs/**\']</code>. A push still runs if it also changes a file outside <code>docs/</code>.', 'The cron fields are minute, hour, day of month, month, day of week. Monday is <code>1</code>.'],
    explain: dl([
      ['<code>branches</code> + <code>paths-ignore</code>', 'When both are present, a push must satisfy both: be on a listed branch <em>and</em> change at least one file that is not ignored.'],
      ['<code>\'release/**\'</code>', 'Quotes are needed because <code>*</code> is special in YAML. <code>**</code> matches any characters, including <code>/</code>.'],
      ['<code>pull_request</code> <code>branches</code>', 'For pull requests, <code>branches</code> filters on the <b>target</b> branch (the one you merge into), not the branch you work on.'],
      ['<code>workflow_dispatch</code>', 'Adds a "Run workflow" button, and lets <code>gh workflow run</code> start it. The file must be on the default branch for the button to show.'],
      ['<code>schedule</code>', 'POSIX cron in UTC, on the latest commit of the default branch. The shortest interval is every 5 minutes. Avoid the top of the hour: runs are delayed when load is high.'],
    ]),
  });

  lab({
    id: 'A4', tag: 'Lab 4', title: 'Jobs that wait for each other', level: 3,
    task: '<p>Three jobs run side by side right now. Make them a pipeline:</p><ol><li><code>test</code> starts only after <code>build</code> succeeded;</li><li><code>publish</code> starts after both, and only for a <b>push to main</b>, never for a pull request;</li><li><code>build</code> works out a version and hands it on: give the job an output called <code>version</code> that reads the step output, and have the step write it to <code>$GITHUB_OUTPUT</code>;</li><li><code>publish</code> prints that version with the <code>needs</code> context.</li></ol>',
    starter: 'name: Pipeline\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - id: ver\n        run: echo "1.0.${{ github.run_number }}"\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "testing"\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "publishing"\n',
    solution: 'name: Pipeline\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    outputs:\n      version: ${{ steps.ver.outputs.version }}\n    steps:\n      - id: ver\n        run: echo "version=1.0.${{ github.run_number }}" >> "$GITHUB_OUTPUT"\n  test:\n    needs: build\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "testing"\n  publish:\n    needs: [build, test]\n    if: github.event_name == \'push\' && github.ref == \'refs/heads/main\'\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "publishing ${{ needs.build.outputs.version }}"\n',
    checks: [
      { label: '<code>test</code> needs <code>build</code>', test: function (d) { var j = H.job(d, 'test'); return !!j && H.list(j.needs).indexOf('build') >= 0; } },
      { label: '<code>publish</code> needs <code>build</code> and <code>test</code>', test: function (d) { var j = H.job(d, 'publish'); return !!j && H.list(j.needs).indexOf('build') >= 0 && H.list(j.needs).indexOf('test') >= 0; } },
      { label: '<code>publish</code> runs for a push to <code>main</code> and not for a pull request', test: function (d) { var j = H.job(d, 'publish'); if (!j || j.if === undefined) return false; var push = H.evalIf(j.if, H.gh('push', 'refs/heads/main')), pr = H.evalIf(j.if, H.gh('pull_request', 'refs/pull/7/merge')), feat = H.evalIf(j.if, H.gh('push', 'refs/heads/feature/x')); return push === true && pr === false && feat === false; } },
      { label: '<code>build</code> has an output <code>version</code> that reads <code>steps.ver.outputs.version</code>', test: function (d) { var j = H.job(d, 'build'); return !!j && j.outputs && /\$\{\{\s*steps\.ver\.outputs\.version\s*\}\}/.test(String(j.outputs.version)); } },
      { label: 'The step writes <code>version=…</code> to <code>$GITHUB_OUTPUT</code>', test: function (d) { return /version=[^\n]*>>\s*"?\$GITHUB_OUTPUT"?/.test(H.runText(d)); } },
      { label: '<code>publish</code> prints <code>${{ needs.build.outputs.version }}</code>', test: function (d) { var j = H.job(d, 'publish'); return !!j && /\$\{\{\s*needs\.build\.outputs\.version\s*\}\}/.test(H.steps(j).map(function (s) { return s.run || ''; }).join('\n')); } },
    ],
    traps: [
      { test: function (d, t) { return /::set-output/.test(t); }, msg: '<code>::set-output</code> was removed. Append <code>name=value</code> to the file named by <code>$GITHUB_OUTPUT</code> instead.', line: function (t) { return H.lineOf(t, /::set-output/); } },
      { test: function (d, t) { return /if:\s*["']?\s*\$\{\{[^}]*\}\}\s*[=!]=/.test(t); }, msg: 'Part of the condition sits outside <code>${{ }}</code>. The whole text becomes a non-empty string, which is always true. Put the entire condition inside the braces, or leave the braces off.', line: function (t) { return H.lineOf(t, /if:/); } },
      { test: function (d, t) { return /if:\s*github\.ref\s*==\s*['"]main['"]/.test(t); }, msg: '<code>github.ref</code> is the full ref, <code>refs/heads/main</code>. The short name is <code>github.ref_name</code>.', line: function (t) { return H.lineOf(t, /if:/); } },
    ],
    hints: ['Wait for a job with <code>needs: build</code>; wait for several with a list: <code>needs: [build, test]</code>.', 'A job output is a map under the job: <code>outputs:</code> then <code>version: ${{ steps.ver.outputs.version }}</code>. <code>ver</code> is the step\'s <code>id</code>.', 'The condition: <code>github.event_name == \'push\' && github.ref == \'refs/heads/main\'</code>. Write it without <code>${{ }}</code>, or put all of it inside one.'],
    explain: dl([
      ['<code>needs</code>', 'Jobs start in parallel unless you say otherwise. <code>needs</code> makes a job wait, and skips it if a job it needs fails or is skipped.'],
      ['<code>if</code> on a job', 'Evaluated before the job starts. A job whose condition is false is <em>skipped</em>, which shows as grey in the run, and counts as success for branch protection.'],
      ['<code>steps.ver.outputs.version</code>', 'A step writes outputs by appending <code>name=value</code> to the file <code>$GITHUB_OUTPUT</code>. The job lists which step outputs it exposes, and other jobs read them as <code>needs.&lt;job&gt;.outputs.&lt;name&gt;</code>.'],
      ['Why <code>github.ref</code> not <code>ref_name</code>', 'Both work. <code>github.ref</code> is the full <code>refs/heads/main</code>; <code>github.ref_name</code> is just <code>main</code>. Pick one and be consistent. Tags look like <code>refs/tags/v1.2.0</code>.'],
    ]),
  });
})();
