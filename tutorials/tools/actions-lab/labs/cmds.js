// Command drills: the gh and git commands you need to run and debug a pipeline without looking them up.
// The flags each command accepts are read from the real tools (vendor/cmd-flags.json), so a valid flag is never rejected.
(function () {
  'use strict';
  var GA = window.GA;
  var table = GA.cmdFlags || {};
  // Build a spec for one command. need: flags that must be present. pos: what each positional argument must be.
  function spec(cmd, o) {
    o = o || {};
    var flags = {};
    var t = table[cmd] || {};
    Object.keys(t).forEach(function (n) {
      var f = t[n];
      if (f.onlyShort) flags[n] = { alias: [], value: f.value ? true : false };
      else flags[n] = { alias: f.short ? [f.short] : [], value: f.value ? true : false };
    });
    Object.keys(o.need || {}).forEach(function (n) {
      var d = o.need[n];
      if (!flags[n]) flags[n] = { alias: d.alias || [], value: d.value === undefined ? true : d.value };
      Object.keys(d).forEach(function (k) { flags[n][k] = d[k]; });
    });
    return { cmd: cmd.split(' '), what: o.what, positionals: o.pos || [], flags: flags, check: o.check };
  }
  GA.cmdSpec = spec;
  var pos = function (re, label, what, hint) { return { match: re, label: label, what: what, hint: hint }; };
  function drill(id, prompt, specs, answer, hints, after, rows) { GA.cmds[id] = { prompt: prompt, specs: specs, answer: answer, hints: hints || [], after: after || '', rows: rows }; }
  var both = function (seen, names) { return names.reduce(function (a, n) { return a.concat(seen[n] || []); }, []); };

  drill('run-manual', '<p>Start the workflow file <code>deploy.yml</code> by hand, on the branch <code>main</code>, and give it the input <code>environment</code> with the value <code>staging</code>.</p>',
    spec('gh workflow run', { what: 'start a workflow that has <code>workflow_dispatch</code>', pos: [pos(/^deploy(\.ya?ml)?$/, 'the workflow file', 'the workflow to start'), ], need: { '--ref': { value: 'main', required: true, what: 'the branch or tag whose copy of the workflow runs', hint: 'which branch to run it on' }, '--raw-field': { what: 'an input for the workflow, as <code>name=value</code>, sent as text' }, '--field': { what: 'an input for the workflow, as <code>name=value</code>' } },
      check: function (i) { return both(i.seen, ['--raw-field', '--field']).indexOf('environment=staging') >= 0 ? [] : ['Pass the input with <code>-f environment=staging</code> (<code>-f</code> or <code>--raw-field</code> sends it as text).']; } }),
    'gh workflow run deploy.yml --ref main -f environment=staging', ['The command is <code>gh workflow run</code> followed by the workflow file.', 'Which branch: <code>--ref</code>. Each input is <code>-f name=value</code>.'],
    'The workflow must have <code>workflow_dispatch</code> and be on the default branch for this to work. Inputs you pass appear as <code>inputs.environment</code>.');

  drill('run-list', '<p>List the last <b>5</b> runs of <code>ci.yml</code> on the branch <code>main</code>.</p>',
    spec('gh run list', { what: 'list workflow runs', need: { '--workflow': { required: true, value: /^ci(\.ya?ml)?$/, alias: ['-w'], what: 'only runs of this workflow', hint: 'filter by workflow' }, '--branch': { required: true, value: 'main', alias: ['-b'], what: 'only runs on this branch' }, '--limit': { required: true, value: '5', alias: ['-L'], what: 'at most this many runs' } } }),
    'gh run list --workflow ci.yml --branch main --limit 5', ['Three filters: workflow, branch, limit. Each has a short form too.'], 'The first column of the output holds each run\'s id, which the other <code>gh run</code> commands take.');

  drill('run-watch', '<p>Follow run <code>1234567890</code> live in the terminal, and make the command <b>exit with an error</b> if the run fails, so a script can react.</p>',
    spec('gh run watch', { what: 'follow a run until it finishes', pos: [pos(/^\d+$/, 'the run id', 'which run to follow')], need: { '--exit-status': { value: false, required: true, what: 'exit with a non-zero code when the run fails' } } }),
    'gh run watch 1234567890 --exit-status', ['The run id is a plain argument. The flag you want says "exit status".'], 'Handy after <code>git push</code> in a script: the exit code tells you whether the pipeline passed.');

  drill('run-log-failed', '<p>Print only the logs of the <b>failed steps</b> of run <code>1234567890</code>.</p>',
    spec('gh run view', { what: 'show a run', pos: [pos(/^\d+$/, 'the run id', 'which run to look at')], need: { '--log-failed': { value: false, required: true, what: 'print the log of failed steps only, not the whole run' } } }),
    'gh run view 1234567890 --log-failed', ['<code>gh run view</code> has <code>--log</code> for everything and a second flag for failures only.'], 'This is usually the first command after a red run: it skips the thousands of lines from the steps that passed.');

  drill('run-rerun', '<p>Re-run only the jobs of run <code>1234567890</code> that failed (and the jobs that depend on them).</p>',
    spec('gh run rerun', { what: 're-run a run', pos: [pos(/^\d+$/, 'the run id', 'which run to re-run')], need: { '--failed': { value: false, required: true, what: 'only the failed jobs, plus the jobs that need them' } } }),
    'gh run rerun 1234567890 --failed', ['The flag is a single word: failed.'], 'A run can be re-run up to 50 times. Add <code>--debug</code> to re-run with debug logging on.');

  drill('run-cancel', '<p>Cancel run <code>1234567890</code>.</p>',
    spec('gh run cancel', { what: 'cancel a run', pos: [pos(/^\d+$/, 'the run id', 'which run to cancel')] }),
    'gh run cancel 1234567890', ['It is the verb you would guess.']);

  drill('run-download', '<p>Download the artifact named <code>ui-dist</code> of run <code>1234567890</code> into the folder <code>./site</code>.</p>',
    spec('gh run download', { what: 'download artifacts of a run', pos: [pos(/^\d+$/, 'the run id', 'which run to download from')], need: { '--name': { required: true, value: 'ui-dist', alias: ['-n'], what: 'only the artifact with this name' }, '--dir': { required: true, value: /^\.?\/?site\/?$/, alias: ['-D'], what: 'where to put the files' } } }),
    'gh run download 1234567890 --name ui-dist --dir ./site', ['Two flags: which artifact, and which directory. Both have one-letter forms.']);

  drill('secret-set', '<p>Store a secret called <code>DOCKERHUB_TOKEN</code> in the environment <code>production</code>. <b>Do not put the value on the command line.</b> You will be asked for it.</p>',
    spec('gh secret set', { what: 'create or update a secret', pos: [pos(/^DOCKERHUB_TOKEN$/, 'the secret name', 'the secret\'s name')], need: { '--env': { required: true, value: 'production', alias: ['-e'], what: 'store it in this environment, not the whole repository' }, '--body': { forbidden: 'Leave out <code>--body</code>. A value typed on the command line is saved in your shell history and visible in the process list. Without it, <code>gh</code> asks for the value.' } } }),
    'gh secret set DOCKERHUB_TOKEN --env production', ['An environment secret needs the flag that names the environment.'], 'Without <code>--body</code>, gh reads the value from a prompt or from standard input (<code>gh secret set NAME &lt; token.txt</code>), so it never lands in your history.');

  drill('variable-set', '<p>Set the repository <b>variable</b> <code>DOCKERHUB_USERNAME</code> to <code>octocat</code>.</p>',
    spec('gh variable set', { what: 'create or update a variable', pos: [pos(/^DOCKERHUB_USERNAME$/, 'the variable name', 'the variable\'s name')], need: { '--body': { required: true, value: 'octocat', alias: ['-b'], what: 'the value (not secret, so it can be on the command line)' } } }),
    'gh variable set DOCKERHUB_USERNAME --body octocat', ['Variables are not secret, so their value can go on the command line.'], 'Read it in a workflow as <code>${{ vars.DOCKERHUB_USERNAME }}</code>.');

  drill('secret-list', '<p>List the names of the secrets in the environment <code>production</code>.</p>',
    spec('gh secret list', { what: 'list secrets (names only; values are never shown)', need: { '--env': { required: true, value: 'production', alias: ['-e'], what: 'the environment' } } }),
    'gh secret list --env production', ['Same flag as for setting an environment secret.']);

  drill('workflow-disable', '<p>Stop the workflow <code>nightly.yml</code> from running, without deleting the file.</p>',
    spec('gh workflow disable', { what: 'disable a workflow', pos: [pos(/^nightly(\.ya?ml)?$/, 'the workflow', 'which workflow to disable')] }),
    'gh workflow disable nightly.yml', ['The opposite of <code>enable</code>.'], 'Scheduled workflows in a public repository are disabled automatically after 60 days without repository activity. <code>gh workflow enable</code> turns one back on.');

  drill('git-tag', '<p>Create the tag <code>v1.2.0</code> on your current commit and push <b>that tag</b> to <code>origin</code>, so the release workflow starts. Write both commands on one line, joined with <code>&amp;&amp;</code>.</p>',
    [spec('git tag', { what: 'create a tag', pos: [pos(/^v1\.2\.0$/, 'the tag name', 'the name of the tag')] }), spec('git push', { what: 'upload to a remote', pos: [pos(/^origin$/, 'the remote', 'where to push'), pos(/^v1\.2\.0$/, 'the tag', 'push just this tag')] })],
    'git tag v1.2.0 && git push origin v1.2.0', ['First create the tag, then push it by name: <code>git push origin &lt;tag&gt;</code>.'], 'A workflow with <code>on: push: tags: [\'v*\']</code> starts for this. Pushing a branch does not push tags, which is why the tag is named.', 2);

  drill('git-empty', '<p>Run the pipeline again on your current branch <b>without changing any file</b>: make an empty commit with the message <code>ci: run again</code> and push it. One line, with <code>&amp;&amp;</code>.</p>',
    [spec('git commit', { what: 'record a commit', need: { '--allow-empty': { value: false, required: true, what: 'allow a commit that changes nothing' }, '--message': { required: true, value: 'ci: run again', alias: ['-m'], what: 'the commit message' } } }), spec('git push', { what: 'upload to the remote' })],
    'git commit --allow-empty -m "ci: run again" && git push', ['An empty commit needs one extra flag, or git refuses.'], 'Prefer <code>gh run rerun</code> to re-run the same commit. An empty commit makes a new commit, and so a new run on the new SHA.', 2);

  drill('api-sha', '<p>Print only the <b>full commit SHA</b> that the tag <code>v7</code> of <code>actions/checkout</code> points at, by calling the GitHub API with <code>gh api</code>.</p>',
    spec('gh api', { what: 'call the GitHub API', pos: [pos(/^\/?repos\/actions\/checkout\/commits\/v7$/, 'the API path', 'the endpoint for the commit that a ref points at', 'repos/actions/checkout/commits/v7')], need: { '--jq': { required: true, value: /^\.sha$/, alias: ['-q'], what: 'a jq filter: print only the <code>sha</code> field' } } }),
    'gh api repos/actions/checkout/commits/v7 --jq .sha', ['The endpoint is <code>repos/OWNER/REPO/commits/REF</code>, and <code>REF</code> can be a tag.', 'Add a filter so only one field prints: <code>--jq .sha</code>.'], 'This is how you get the SHA to pin in <code>uses: actions/checkout@&lt;sha&gt; # v7</code>. It gives the commit even when the tag is annotated.');

  drill('attest-verify', '<p>Check that the image <code>oci://docker.io/octocat/todo-api@sha256:abc123</code> has a build attestation from a workflow of the organisation <code>octocat</code>.</p>',
    spec('gh attestation verify', { what: 'verify an artifact attestation', pos: [pos(/^oci:\/\/docker\.io\/octocat\/todo-api@sha256:abc123$/, 'the image', 'the artifact to check (an <code>oci://</code> reference)')], need: { '--owner': { required: true, value: 'octocat', alias: ['-o'], what: 'the organisation whose workflow must have built it' } } }),
    'gh attestation verify oci://docker.io/octocat/todo-api@sha256:abc123 --owner octocat', ['An image is written as <code>oci://registry/name@sha256:…</code>.', 'Say whose workflow you trust with a flag for the owner.'], 'Use <code>--repo octocat/infra-setup</code> to demand one repository instead of any in the organisation.');

  drill('cache-delete', '<p>Delete <b>all</b> the caches of the repository.</p>',
    spec('gh cache delete', { what: 'delete Actions caches', need: { '--all': { value: false, required: true, alias: ['-a'], what: 'every cache, not just one key' } } }),
    'gh cache delete --all', ['One flag with a one-letter form.'], 'Caches are removed after 7 days without use anyway. Delete by hand after a poisoned or corrupt cache.');

  drill('pr-checks', '<p>Wait for the checks of pull request <code>7</code> to finish.</p>',
    spec('gh pr checks', { what: 'show the status checks of a pull request', pos: [pos(/^7$/, 'the pull request number', 'which pull request')], need: { '--watch': { value: false, required: true, what: 'keep refreshing until every check has finished' } } }),
    'gh pr checks 7 --watch', ['Look for a flag that means "keep watching".'], 'Add <code>--required</code> to show only the checks that the ruleset requires.');

  GA.cmds['lint-local'] = { prompt: '<p>Check every workflow in your repository with <b>actionlint</b> before you push. Run it from the repository root, with no file names (it finds <code>.github/workflows</code> itself).</p>',
    specs: { cmd: ['actionlint'], what: 'lint workflow files', positionals: [], flags: { '-color': { alias: [], value: false }, '-config-file': { alias: [], value: true }, '-debug': { alias: [], value: false }, '-format': { alias: [], value: true }, '-ignore': { alias: [], value: true }, '-init-config': { alias: [], value: false }, '-no-color': { alias: [], value: false }, '-oneline': { alias: [], value: false }, '-pyflakes': { alias: [], value: true }, '-shellcheck': { alias: [], value: true }, '-stdin-filename': { alias: [], value: true }, '-verbose': { alias: [], value: false }, '-version': { alias: [], value: false } } },
    answer: 'actionlint', hints: ['The tool is called actionlint. With no arguments it checks the whole repository.'], after: 'This is the same rule set the lab on this page uses. Run it in a pre-commit hook or as the first job of your pull request check.' };
})();
