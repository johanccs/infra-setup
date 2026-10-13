// Help while typing: which keys fit on the line the cursor is on, and the next line a file still needs.
// Pure functions on text, so the tests can run them without a browser. The key lists follow GitHub's workflow syntax
// (the tests compare them with the lists the real actionlint prints).
(function () {
  'use strict';
  var GA = (typeof window !== 'undefined' ? window : global).GA;

  // kind: 'val' is "key: value" on one line, 'map' has its keys on the next lines, 'list' has "- " items on the next lines.
  function K(key, kind, desc) { return { key: key, kind: kind, desc: desc }; }
  var FILTERS = {
    branches: K('branches', 'val', 'Only for these branches (patterns such as main or release/**)'),
    'branches-ignore': K('branches-ignore', 'val', 'For every branch except these. Not together with branches'),
    tags: K('tags', 'val', 'Only for these tags (a pattern such as v*)'),
    'tags-ignore': K('tags-ignore', 'val', 'For every tag except these. Not together with tags'),
    paths: K('paths', 'list', 'Only when a changed file matches one of these patterns'),
    'paths-ignore': K('paths-ignore', 'list', 'Not when every changed file matches these patterns'),
    types: K('types', 'val', 'Only for these activity types, for example [opened, synchronize]'),
  };
  var pick = function (names) { return names.map(function (n) { return FILTERS[n]; }); };
  var STEP = [
    K('name', 'val', 'The text shown for this step in the log'),
    K('id', 'val', 'A short id, so later steps can read steps.<id>.outputs'),
    K('uses', 'val', 'Run an action: owner/repo@version'),
    K('run', 'val', 'Run a shell command. Use run: | for several lines'),
    K('with', 'map', 'The inputs of the action in uses'),
    K('env', 'map', 'Environment variables for this step only'),
    K('if', 'val', 'Run this step only when the expression is true'),
    K('shell', 'val', 'The shell for run: bash, pwsh, python, sh, cmd, powershell'),
    K('working-directory', 'val', 'The folder the run command starts in'),
    K('continue-on-error', 'val', 'true: the job goes on when this step fails'),
    K('timeout-minutes', 'val', 'Stop this step after so many minutes'),
  ];
  var PERMS = ['contents', 'id-token', 'packages', 'pull-requests', 'security-events', 'attestations', 'actions', 'checks', 'deployments', 'issues', 'pages', 'statuses', 'discussions', 'models', 'artifact-metadata', 'repository-projects']
    .map(function (s) { return K(s, 'val', ({ contents: 'The repository\'s files: read to check out, write to push or create releases', 'id-token': 'write lets the job ask for an OIDC token (keyless cloud login, signing)', packages: 'write to push to GitHub Packages or ghcr.io', 'pull-requests': 'write to comment on or label pull requests', 'security-events': 'write to upload code scanning results (CodeQL, SARIF)', attestations: 'write to store build attestations', actions: 'Runs and artifacts of GitHub Actions itself', checks: 'Check runs', deployments: 'Deployments', issues: 'Issues and their comments', pages: 'write to deploy GitHub Pages', statuses: 'Commit statuses' })[s] || 'Permission scope for GITHUB_TOKEN: read, write or none'); });
  var S = {
    workflow: { where: 'the top level of the workflow', keys: [
      K('name', 'val', 'The workflow\'s name in the Actions tab'),
      K('run-name', 'val', 'The name of each run. May use expressions'),
      K('on', 'map', 'The events that start the workflow'),
      K('permissions', 'map', 'What GITHUB_TOKEN may do, for every job'),
      K('env', 'map', 'Environment variables for every job'),
      K('defaults', 'map', 'Default shell and working directory for run steps'),
      K('concurrency', 'map', 'Let only one run of a group go at a time'),
      K('jobs', 'map', 'The jobs. Each key under it is a job id you choose'),
    ] },
    on: { where: 'on: the events', keys: [
      K('push', 'map', 'A commit or tag is pushed'),
      K('pull_request', 'map', 'A pull request is opened, updated or reopened'),
      K('workflow_dispatch', 'map', 'Started by hand (button, gh workflow run, API)'),
      K('workflow_call', 'map', 'Called by another workflow: this file is reusable'),
      K('workflow_run', 'map', 'Another workflow was requested or completed'),
      K('schedule', 'list', 'On a timer: a list of cron lines, in UTC'),
      K('merge_group', 'map', 'A pull request entered the merge queue'),
      K('release', 'map', 'A release was published, created or edited'),
      K('pull_request_target', 'map', 'Like pull_request, but runs the base branch\'s workflow with secrets. Dangerous with fork code'),
      K('issues', 'map', 'An issue was opened, labeled, closed'),
      K('issue_comment', 'map', 'A comment on an issue or pull request'),
      K('deployment_status', 'map', 'A deployment changed status'),
    ] },
    'on.push': { where: 'the push event', keys: pick(['branches', 'branches-ignore', 'tags', 'tags-ignore', 'paths', 'paths-ignore']) },
    'on.pull_request': { where: 'the pull_request event', keys: pick(['branches', 'branches-ignore', 'paths', 'paths-ignore', 'types']) },
    'on.workflow_dispatch': { where: 'the workflow_dispatch event', keys: [K('inputs', 'map', 'Values the person fills in when starting the run')] },
    'on.workflow_call': { where: 'the workflow_call event', keys: [K('inputs', 'map', 'Values the caller passes with with:'), K('secrets', 'map', 'Secrets the caller passes'), K('outputs', 'map', 'Values handed back to the caller')] },
    'on.workflow_run': { where: 'the workflow_run event', keys: [K('workflows', 'val', 'The names of the workflows to wait for, for example [CI]'), FILTERS.types, FILTERS.branches, FILTERS['branches-ignore']] },
    'on.types': { where: 'this event', keys: [FILTERS.types] },
    'on.schedule.item': { where: 'a schedule entry', keys: [K('cron', 'val', 'Five fields in quotes: minute hour day month weekday, in UTC')] },
    'dispatch.input': { where: 'a workflow_dispatch input', keys: [K('description', 'val', 'The label shown in the form'), K('type', 'val', 'string, boolean, number, choice or environment'), K('required', 'val', 'true: the run cannot start without it'), K('default', 'val', 'The value when nothing is given'), K('options', 'list', 'The choices, for type: choice')] },
    'call.input': { where: 'a workflow_call input', keys: [K('description', 'val', 'What the input is for'), K('type', 'val', 'string, boolean or number. Required here'), K('required', 'val', 'true: the caller must pass it'), K('default', 'val', 'The value when the caller passes nothing')] },
    'call.secret': { where: 'a workflow_call secret', keys: [K('description', 'val', 'What the secret is for'), K('required', 'val', 'true: the caller must pass it')] },
    'call.output': { where: 'a workflow_call output', keys: [K('description', 'val', 'What the output is'), K('value', 'val', 'Where it comes from: ${{ jobs.<job>.outputs.<name> }}')] },
    permissions: { where: 'permissions', value: 'read, write or none', keys: PERMS },
    concurrency: { where: 'concurrency', keys: [K('group', 'val', 'Runs with the same group name wait for each other'), K('cancel-in-progress', 'val', 'true: a new run cancels the one in progress')] },
    defaults: { where: 'defaults', keys: [K('run', 'map', 'Defaults for run steps')] },
    'defaults.run': { where: 'defaults.run', keys: [K('shell', 'val', 'The shell for every run step'), K('working-directory', 'val', 'The folder every run step starts in')] },
    job: { where: 'a job', keys: [
      K('runs-on', 'val', 'The machine for the job, for example ubuntu-latest'),
      K('steps', 'list', 'The steps, run in order on that machine'),
      K('needs', 'val', 'Wait for these jobs to succeed first'),
      K('if', 'val', 'Run the job only when the expression is true'),
      K('name', 'val', 'The name shown in the run. The key above stays the job id'),
      K('permissions', 'map', 'What GITHUB_TOKEN may do in this job. Replaces the workflow\'s'),
      K('environment', 'val', 'The deployment environment: its secrets, variables and approvals'),
      K('env', 'map', 'Environment variables for every step of the job'),
      K('timeout-minutes', 'val', 'Stop the job after so many minutes (the default is 360)'),
      K('strategy', 'map', 'Run the job several times: a matrix'),
      K('outputs', 'map', 'Values other jobs read with needs.<job>.outputs'),
      K('concurrency', 'map', 'Let only one job of a group go at a time'),
      K('defaults', 'map', 'Default shell and working directory for this job'),
      K('continue-on-error', 'val', 'true: the run goes on when this job fails'),
      K('uses', 'val', 'Call a reusable workflow instead of steps'),
      K('with', 'map', 'Inputs for the reusable workflow in uses'),
      K('secrets', 'val', 'Secrets for the reusable workflow: a map, or inherit'),
      K('container', 'map', 'Run the steps inside this container image'),
      K('services', 'map', 'Containers started beside the job, such as a database'),
    ] },
    step: { where: 'a step', keys: STEP },
    strategy: { where: 'strategy', keys: [K('matrix', 'map', 'The values to combine. Each key is a name you choose'), K('fail-fast', 'val', 'false: the other matrix jobs go on when one fails'), K('max-parallel', 'val', 'How many matrix jobs run at once')] },
    matrix: { where: 'the matrix', free: 'Any name you choose, with a list of values, for example os: [ubuntu-latest, windows-latest].', keys: [K('include', 'list', 'Extra combinations, or extra values for existing ones'), K('exclude', 'list', 'Combinations to leave out')] },
    environment: { where: 'environment', keys: [K('name', 'val', 'The environment\'s name'), K('url', 'val', 'A link shown on the deployment')] },
    container: { where: 'a container', keys: [K('image', 'val', 'The image to run'), K('credentials', 'map', 'username and password for a private registry'), K('env', 'map', 'Environment variables in the container'), K('ports', 'list', 'Ports to publish'), K('volumes', 'list', 'Volumes to mount'), K('options', 'val', 'Extra docker create options')] },
    // action.yml
    action: { where: 'the top level of action.yml', keys: [K('name', 'val', 'The action\'s name'), K('description', 'val', 'One line about what it does'), K('inputs', 'map', 'The values the caller gives under with:'), K('outputs', 'map', 'The values the action hands back'), K('runs', 'map', 'How the action runs'), K('author', 'val', 'Who wrote it'), K('branding', 'map', 'Icon and colour on the Marketplace')] },
    'action.input': { where: 'an action input', keys: [K('description', 'val', 'What the input is for'), K('required', 'val', 'true: the caller must give it'), K('default', 'val', 'The value when the caller gives nothing')] },
    'action.output': { where: 'an action output', keys: [K('description', 'val', 'What the output is'), K('value', 'val', 'Where it comes from: ${{ steps.<id>.outputs.<name> }}')] },
    'action.runs': { where: 'runs', keys: [K('using', 'val', 'composite for an action made of steps'), K('steps', 'list', 'The steps. Every run step needs shell:')] },
    // dependabot.yml
    dependabot: { where: 'the top level of dependabot.yml', keys: [K('version', 'val', 'Always 2'), K('updates', 'list', 'One entry per package ecosystem and folder'), K('registries', 'map', 'Private registries Dependabot may read')] },
    'dependabot.update': { where: 'an update entry', keys: [K('package-ecosystem', 'val', 'github-actions, nuget, npm, docker, ...'), K('directory', 'val', 'The folder with the manifest, for example /'), K('directories', 'list', 'Several folders in one entry'), K('schedule', 'map', 'How often to look'), K('groups', 'map', 'Put several updates into one pull request'), K('open-pull-requests-limit', 'val', 'How many version-update pull requests may be open (default 5)'), K('labels', 'list', 'Labels for the pull requests'), K('cooldown', 'map', 'Wait some days after a release before proposing it'), K('commit-message', 'map', 'A prefix for the commit messages'), K('ignore', 'list', 'Dependencies or versions to skip')] },
    'dependabot.schedule': { where: 'schedule', keys: [K('interval', 'val', 'daily, weekly, monthly, quarterly, semiannually, yearly or cron'), K('day', 'val', 'The weekday, for weekly'), K('time', 'val', 'hh:mm, in quotes'), K('timezone', 'val', 'For example Europe/Amsterdam')] },
  };
  var FREE = {
    jobs: 'A job id you choose: letters, digits, - and _ (for example build). Other jobs name it in needs.',
    env: 'A variable name you choose, in capitals by habit: NAME: value.',
    inputs: 'An input name you choose. Its settings go on the lines under it.',
    outputs: 'An output name you choose, with the expression that gives its value.',
    secrets: 'A secret name. Its settings go on the lines under it.',
    services: 'A name you choose for the service container (it becomes its host name).',
    groups: 'A group name you choose.',
  };
  var VALUES = {
    'runs-on': [['ubuntu-latest', 'GitHub\'s Linux runner. The usual choice'], ['ubuntu-24.04', 'A fixed Ubuntu version'], ['ubuntu-24.04-arm', 'Linux on ARM'], ['windows-latest', 'Windows Server'], ['macos-latest', 'macOS on Apple silicon'], ['${{ matrix.os }}', 'From a matrix value called os']],
    shell: [['bash', 'Bash with -e and pipefail: a failing command stops the step'], ['pwsh', 'PowerShell Core'], ['python', 'Run the lines as Python'], ['sh', 'POSIX sh'], ['cmd', 'Windows cmd'], ['powershell', 'Windows PowerShell']],
    'cancel-in-progress': [['true', 'A new run cancels the one in progress. Right for checks'], ['false', 'A new run waits. Right for deployments']],
    'fail-fast': [['false', 'Let the other matrix jobs finish'], ['true', 'Cancel the others at the first failure (the default)']],
    'continue-on-error': [['true', 'A failure here does not fail the job'], ['false', 'The default']],
    'persist-credentials': [['false', 'Do not leave the token in .git/config'], ['true', 'The default']],
    required: [['true', 'It must be given'], ['false', 'It may be left out']],
    using: [['composite', 'An action made of steps']],
    secrets: [['inherit', 'Pass all of the caller\'s secrets to the reusable workflow']],
    'package-ecosystem': [['github-actions', 'The actions in your workflows'], ['nuget', '.NET packages'], ['npm', 'npm packages'], ['docker', 'Base images in Dockerfiles']],
    interval: [['weekly', 'Once a week'], ['daily', 'Every weekday'], ['monthly', 'Once a month']],
    if: [['github.event_name == \'push\'', 'Only for a push'], ['github.ref == \'refs/heads/main\'', 'Only on main'], ['github.event_name != \'pull_request\'', 'Not for a pull request'], ['always()', 'Even when an earlier step or job failed or was cancelled'], ['${{ !cancelled() }}', 'Unless the run was cancelled'], ['failure()', 'Only when something before it failed']],
  };
  var PERM_VALUES = [['read', 'May read'], ['write', 'May read and change'], ['none', 'No access']];
  var TYPES = { dispatch: [['string', 'Free text'], ['boolean', 'A tick box: true or false'], ['choice', 'One of the options you list'], ['number', 'A number'], ['environment', 'One of the repository\'s environments']], call: [['string', 'Text'], ['boolean', 'true or false'], ['number', 'A number']] };
  var CONTEXTS = [['github.', 'Facts about the run: github.ref, github.sha, github.event_name, github.actor, github.repository'], ['secrets.', 'Encrypted secrets: secrets.NAME. Not available in if:'], ['vars.', 'Configuration variables: vars.NAME'], ['inputs.', 'Inputs of workflow_dispatch or workflow_call'], ['needs.', 'Jobs this job needs: needs.<job>.outputs.<name>, needs.<job>.result'], ['steps.', 'Earlier steps of this job: steps.<id>.outputs.<name>'], ['matrix.', 'The values of this matrix job'], ['env.', 'Variables set with env:'], ['runner.', 'The machine: runner.os, runner.temp'], ['job.', 'This job: job.status'], ['hashFiles(', 'A hash of files, for cache keys: hashFiles(\'**/package-lock.json\')'], ['contains(', 'contains(text or list, item)'], ['startsWith(', 'startsWith(text, start)'], ['format(', 'format(\'{0}-{1}\', a, b)'], ['fromJSON(', 'Turn JSON text into a value'], ['toJSON(', 'Turn a value into JSON text'], ['always()', 'True even after a failure or a cancel'], ['!cancelled()', 'True unless the run was cancelled'], ['failure()', 'True when something before it failed']];

  // ------------------------------------------------------------------ where the cursor is
  function lineInfo(raw) {
    var m = /^( *)(- +)?(.*)$/.exec(raw.replace(/\t/g, '  '));
    var indent = m[1].length, dash = !!m[2], body = m[3];
    var km = /^(['"]?)([\w.\/-]+)\1\s*:(?:\s+(.*)|\s*)$/.exec(body);
    return { indent: indent, dash: dash, keyIndent: indent + (dash ? m[2].length : 0), key: km ? km[2] : null, value: km ? (km[3] || '').replace(/\s+#.*$/, '') : null, blank: body.trim() === '' && !dash, comment: /^#/.test(body), body: body };
  }
  // The keys above a line, outermost first. A list item is '-'.
  function pathOf(lines, idx, keyIndent, isDash) {
    var path = [], cur = keyIndent, afterDash = !!isDash;
    for (var i = idx - 1; i >= 0 && cur >= 0; i--) {
      var li = lineInfo(lines[i]);
      if (li.blank || li.comment) continue;
      if (li.dash && li.indent < cur) { path.unshift('-'); cur = li.indent; afterDash = true; if (li.key && /^[|>]/.test(li.value || '') && li.keyIndent < keyIndent) path.push(li.key + '|'); continue; }
      if (!li.dash && li.key && li.value === '' && (li.indent < cur || (afterDash && li.indent === cur))) { path.unshift(li.key); cur = li.indent; afterDash = false; if (cur === 0) break; }
      else if (!li.dash && li.indent < cur) {
        // a line that is not "key:" cannot be a parent, unless it opens a block of text (run: |): then the line is inside that text
        if (li.key && /^[|>]/.test(li.value || '')) path.unshift(li.key + '|');
        cur = li.indent;
      }
    }
    return path;
  }
  // The keys already written in the same block as line idx (same parent, same indent), with their values.
  function siblings(lines, idx, keyIndent, isDash) {
    var out = {};
    function take(i) { var li = lineInfo(lines[i]); if (li.key && li.keyIndent === keyIndent) out[li.key] = li.value; }
    for (var i = idx - 1; i >= 0 && !isDash; i--) {              // a line that starts with "- " begins a new item: nothing above belongs to it
      var a = lineInfo(lines[i]); if (a.blank || a.comment) continue;
      if (a.keyIndent < keyIndent && !(a.dash && a.keyIndent === keyIndent)) break;
      take(i); if (a.dash && a.keyIndent === keyIndent) break;
    }
    for (var j = idx + 1; j < lines.length; j++) {
      var b = lineInfo(lines[j]); if (b.blank || b.comment) continue;
      if (b.keyIndent < keyIndent || (b.dash && b.indent < keyIndent)) break;
      take(j);
    }
    return out;
  }
  function schemaFor(path, kind) {
    var n = path.length, p = path.join('/'), last = path[n - 1];
    if (kind === 'action') {
      if (n === 0) return S.action;
      if (/^inputs\/[^/]+$/.test(p)) return S['action.input'];
      if (/^outputs\/[^/]+$/.test(p)) return S['action.output'];
      if (p === 'runs') return S['action.runs'];
      if (p === 'runs/steps/-') return S.step;
      if (p === 'inputs' || p === 'outputs') return { where: p, free: FREE[p], keys: [] };
      if (/\/env$/.test(p)) return { where: 'env', free: FREE.env, keys: [] };
      return null;
    }
    if (kind === 'dependabot') {
      if (n === 0) return S.dependabot;
      if (p === 'updates/-') return S['dependabot.update'];
      if (p === 'updates/-/schedule') return S['dependabot.schedule'];
      if (p === 'updates/-/groups') return { where: 'groups', free: FREE.groups, keys: [] };
      return null;
    }
    if (n === 0) return S.workflow;
    if (p === 'on') return S.on;
    if (n === 2 && path[0] === 'on') {
      if (path[1] === 'pull_request_target') return S['on.pull_request'];
      if (path[1] === 'schedule') return null;
      return S['on.' + path[1]] || S['on.types'];
    }
    if (p === 'on/schedule/-') return S['on.schedule.item'];
    if (/^on\/workflow_dispatch\/inputs\/[^/]+$/.test(p)) return S['dispatch.input'];
    if (/^on\/workflow_call\/inputs\/[^/]+$/.test(p)) return S['call.input'];
    if (/^on\/workflow_call\/secrets\/[^/]+$/.test(p)) return S['call.secret'];
    if (/^on\/workflow_call\/outputs\/[^/]+$/.test(p)) return S['call.output'];
    if (/^on\/workflow_(dispatch|call)\/(inputs|outputs|secrets)$/.test(p)) return { where: last, free: FREE[last], keys: [] };
    if (p === 'permissions' || /^jobs\/[^/]+\/permissions$/.test(p)) return S.permissions;
    if (p === 'concurrency' || /^jobs\/[^/]+\/concurrency$/.test(p)) return S.concurrency;
    if (p === 'defaults' || /^jobs\/[^/]+\/defaults$/.test(p)) return S.defaults;
    if (/(^|\/)defaults\/run$/.test(p)) return S['defaults.run'];
    if (p === 'jobs') return { where: 'jobs', free: FREE.jobs, keys: [] };
    if (/^jobs\/[^/]+$/.test(p)) return S.job;
    if (/^jobs\/[^/]+\/steps\/-$/.test(p)) return S.step;
    if (/^jobs\/[^/]+\/strategy$/.test(p)) return S.strategy;
    if (/^jobs\/[^/]+\/strategy\/matrix$/.test(p)) return S.matrix;
    if (/^jobs\/[^/]+\/environment$/.test(p)) return S.environment;
    if (/^jobs\/[^/]+\/(container|services\/[^/]+)$/.test(p)) return S.container;
    if (last === 'env' || last === 'outputs' || last === 'services') return { where: last, free: FREE[last], keys: [] };
    return null;
  }
  function actionOf(uses) {
    var u = GA.parseUses ? GA.parseUses(uses) : null;
    if (!u || !u.repo) return null;
    var full = u.repo + (u.path ? '/' + u.path : '');
    return (GA.actions || {})[full] ? { name: full, meta: GA.actions[full] } : null;
  }

  // What fits at the cursor. Returns null when there is nothing useful to say.
  //   { where, items: [{ label, insert, desc }], from, to, free, value }   (from..to is the text an item replaces)
  GA.suggest = function (text, pos, kind) {
    if (kind === 'none') return null;
    var before = text.slice(0, pos), lineStart = before.lastIndexOf('\n') + 1;
    var lines = text.split('\n'), idx = before.split('\n').length - 1;
    var head = text.slice(lineStart, pos), rest = lines[idx].slice(head.length);
    // inside ${{ ... }}: contexts and functions
    var open = head.lastIndexOf('${{');
    if (open >= 0 && head.indexOf('}}', open) < 0) {
      var word = /[\w.!]*$/.exec(head)[0];
      var cs = CONTEXTS.filter(function (c) { return c[0].toLowerCase().indexOf(word.toLowerCase()) === 0; });
      if (!cs.length && word.indexOf('.') < 0) cs = CONTEXTS;
      if (!cs.length) return null;
      return { where: 'an expression ${{ }}', value: true, from: pos - (cs === CONTEXTS ? 0 : word.length), to: pos, items: cs.map(function (c) { return { label: c[0], insert: c[0], desc: c[1] }; }) };
    }
    var m = /^( *)(- +)?(.*)$/.exec(head.replace(/\t/g, '  '));
    var keyIndent = m[1].length + (m[2] ? m[2].length : 0), typed = m[3];
    var path = pathOf(lines, idx, m[2] ? m[1].length : keyIndent, !!m[2]);
    if (m[2]) path.push('-');
    var sib = siblings(lines, idx, keyIndent, !!m[2]);
    var cm = /^(['"]?)([\w.\/-]+)\1\s*:\s*(.*)$/.exec(typed);
    if (cm) {                                                    // after "key: " : values
      var key = cm[2], vp = cm[3], vals = null, where = key;
      var pj = path.join('/');
      if (key === 'uses' && path[path.length - 1] === '-') {
        vals = Object.keys(GA.actions || {}).map(function (r) { return [r + '@' + GA.actions[r].use, 'The version the lessons use (' + GA.actions[r].latestRelease + ')']; });
        where = 'uses: an action';
      } else if (key === 'type' && /^on\/workflow_dispatch\/inputs\//.test(pj)) vals = TYPES.dispatch;
      else if (key === 'type' && /^on\/workflow_call\/inputs\//.test(pj)) vals = TYPES.call;
      else if (/(^|\/)permissions$/.test(pj)) vals = PERM_VALUES;
      else if (key === 'permissions' && (path.length === 0 || /^jobs\/[^/]+$/.test(pj))) vals = [['{}', 'No permissions at all'], ['read-all', 'Read everything. Broader than most jobs need']];
      else if (key === 'required' && !/^on\/|^inputs\//.test(pj)) vals = null;
      else if (key === 'secrets' && !/^jobs\/[^/]+$/.test(pj)) vals = null;
      else if (key === 'if' && kind && kind !== 'workflow') vals = null;
      else vals = VALUES[key] || null;
      if (!vals) return null;
      var vs = vals.filter(function (v) { return v[0].toLowerCase().indexOf(vp.toLowerCase()) === 0 || (key === 'uses' && v[0].toLowerCase().indexOf(vp.toLowerCase()) >= 0); });
      if (!vs.length || (vs.length === 1 && vs[0][0] === vp)) return null;
      return { where: where, value: true, from: pos - vp.length, to: pos + (/^\S*$/.test(rest) ? rest.length : 0), items: vs.map(function (v) { return { label: v[0], insert: v[0], desc: v[1] }; }) };
    }
    if (/[^\w.\/-]/.test(typed)) return null;                     // text that is not the start of a key
    var pjoin = path.join('/'), starts = null;
    if (!m[2] && (/^jobs\/[^/]+\/steps$/.test(pjoin) || pjoin === 'runs/steps')) starts = ['the steps list', [['- name: ', 'Start a step with a name, then give it uses or run'], ['- uses: ', 'Start a step that runs an action'], ['- run: ', 'Start a step that runs a command']]];
    else if (!m[2] && pjoin === 'on/schedule') starts = ['the schedule list', [['- cron: ', 'One timer: five fields in quotes, in UTC']]];
    else if (!m[2] && pjoin === 'updates' && kind === 'dependabot') starts = ['the updates list', [['- package-ecosystem: ', 'Start an entry: github-actions, nuget, npm, docker']]];
    if (starts) {
      var st = starts[1].filter(function (x) { return x[0].indexOf(typed) === 0 || x[0].slice(2).indexOf(typed) === 0; });
      return st.length ? { where: starts[0], value: false, from: pos - typed.length, to: pos, items: st.map(function (x) { return { label: x[0].trim(), insert: x[0], desc: x[1] }; }) } : null;
    }
    var sc = schemaFor(path, kind || 'workflow'), keys, whereText, free;
    var withOf = path[path.length - 1] === 'with' && path[path.length - 2] === '-';
    if (withOf) {                                                 // the inputs of this step's action
      var itemIndent = keyIndent - 2, stepKeys = siblings(lines, idx - 0, itemIndent);
      for (var q = idx - 1; q >= 0 && !stepKeys.uses; q--) { var lq = lineInfo(lines[q]); if (lq.key === 'uses' && lq.keyIndent === itemIndent) stepKeys.uses = lq.value; if (lq.dash && lq.indent < itemIndent) break; }
      var act = actionOf(stepKeys.uses);
      if (!act) return null;
      keys = Object.keys(act.meta.inputs).map(function (k) { var inp = act.meta.inputs[k]; return K(k, 'val', (inp.required && inp.default === null ? 'Required. ' : '') + (inp.description ? String(inp.description).split('\n')[0].slice(0, 110) : 'An input of ' + act.name) + (inp.default !== null && inp.default !== '' && String(inp.default).length < 40 ? ' (default: ' + inp.default + ')' : '')); });
      keys.sort(function (a, b) { return (/^Required/.test(b.desc) ? 1 : 0) - (/^Required/.test(a.desc) ? 1 : 0); });
      whereText = 'with: the inputs of ' + act.name;
    } else if (sc) { keys = sc.keys; whereText = sc.where; free = sc.free; } else return null;
    var fit = keys.filter(function (k) { return !(k.key in sib) || k.key === typed; }).filter(function (k) { return k.key.toLowerCase().indexOf(typed.toLowerCase()) === 0; });
    if (!fit.length && typed) fit = keys.filter(function (k) { return !(k.key in sib) && k.key.toLowerCase().indexOf(typed.toLowerCase()) > 0; });
    if (sc && sc === S.step) {                                    // a step is run or uses, never both
      if ('run' in sib) fit = fit.filter(function (k) { return k.key !== 'uses' && k.key !== 'with'; });
      if ('uses' in sib) fit = fit.filter(function (k) { return k.key !== 'run' && k.key !== 'shell' && k.key !== 'working-directory'; });
    }
    if (sc && sc === S.job) {                                     // a job has steps, or calls a reusable workflow
      if ('steps' in sib || 'runs-on' in sib) fit = fit.filter(function (k) { return ['uses', 'with', 'secrets'].indexOf(k.key) < 0; });
      if ('uses' in sib) fit = fit.filter(function (k) { return ['runs-on', 'steps', 'environment', 'env', 'timeout-minutes', 'container', 'services', 'outputs', 'defaults', 'continue-on-error'].indexOf(k.key) < 0; });
    }
    if (!fit.length && !free) return null;
    var pad = new Array(keyIndent + 1).join(' ');
    return {
      where: whereText, free: free || null, value: false, from: pos - typed.length, to: pos + (/^[\w.\/-]*:?\s*$/.test(rest) ? rest.length : 0),
      items: fit.map(function (k) {
        var ins = k.kind === 'val' ? k.key + ': ' : k.kind === 'list' ? k.key + ':\n' + pad + '  - ' : k.key + ':\n' + pad + '  ';
        return { label: k.key, insert: ins, desc: k.desc };
      }),
    };
  };
  GA.assistSchema = S;
  GA.assistValues = VALUES;

  // ------------------------------------------------------------------ the next line a file still needs
  function norm(s) { return s.replace(/\s+#.*$/, '').replace(/^\s*-\s+/, '').replace(/["']/g, '').replace(/\s+/g, ' ').trim(); }
  function entries(text) {
    var lines = text.split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      var li = lineInfo(lines[i]);
      if (li.blank || li.comment) continue;
      if (li.dash && li.body.trim() === '') continue;
      var path = pathOf(lines, i, li.dash ? li.indent : li.keyIndent, li.dash);
      if (li.dash) path.push('-');
      out.push({ n: i + 1, raw: lines[i], path: path.join('/'), crumbs: path, key: li.key, text: norm(lines[i]) });
    }
    return out;
  }
  // Compare what is typed with a reference file, by place in the file and not by line number.
  //   { kind: 'missing' | 'differs' | 'done', line, n, crumbs, yours, yoursN, left }
  GA.nextLine = function (userText, refText) {
    var ref = entries(refText), mine = entries(userText);
    var pool = {};
    mine.forEach(function (e) { var k = e.path + '|' + e.text; (pool[k] = pool[k] || []).push(e); });
    var missing = [], used = {};
    ref.forEach(function (r) {
      var k = r.path + '|' + r.text;
      if (pool[k] && pool[k].length) { used[pool[k].shift().n] = true; return; }
      missing.push(r);
    });
    if (!missing.length) return { kind: 'done', left: 0 };
    // a line of yours in the same place with the same key, but another value
    var differs = [], absent = [];
    missing.forEach(function (r) {
      var alt = r.key ? mine.filter(function (e) { return !used[e.n] && e.path === r.path && e.key === r.key; })[0] : null;
      if (alt) { used[alt.n] = true; differs.push({ r: r, alt: alt }); } else absent.push(r);
    });
    if (absent.length) return { kind: 'missing', line: absent[0].raw, n: absent[0].n, crumbs: absent[0].crumbs, left: absent.length };
    return { kind: 'differs', line: differs[0].r.raw, n: differs[0].r.n, crumbs: differs[0].r.crumbs, yours: differs[0].alt.raw, yoursN: differs[0].alt.n, left: 0 };
  };
  // One line about a key, for the "next line" box.
  GA.describeKey = function (crumbs, key, kind) {
    var sc = schemaFor(crumbs, kind || 'workflow');
    if (!sc) return null;
    var k = sc.keys.filter(function (x) { return x.key === key; })[0];
    return k ? k.desc : null;
  };
  GA.assistInternals = { lineInfo: lineInfo, pathOf: pathOf, schemaFor: schemaFor, entries: entries };
})();
