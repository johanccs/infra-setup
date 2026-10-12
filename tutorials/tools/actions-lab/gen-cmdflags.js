// Reads the real flags of every gh and git command the command drills use, from the installed tools' own help.
// Output: vendor/cmd-flags.json  { "gh run view": { "--log-failed": { "short": null, "value": false }, ... }, ... }
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const GH = ['workflow run', 'workflow list', 'workflow view', 'workflow enable', 'workflow disable', 'run list', 'run watch', 'run view', 'run rerun', 'run cancel', 'run download', 'secret set', 'secret list', 'secret delete', 'variable set', 'variable list', 'attestation verify', 'cache list', 'cache delete', 'pr checks', 'api'];
const GIT = ['tag', 'push', 'commit', 'rev-parse', 'ls-remote'];
const out = {};
function parseGh(text) {
  const flags = {};
  const re = /^\s+(?:(-\w), )?(--[\w-]+)(?: ([^\s].*?))?(?:\s{2,}|$)/;
  let on = false;
  for (const line of text.split('\n')) {
    if (/^(FLAGS|INHERITED FLAGS)\s*$/.test(line)) { on = true; continue; }
    if (/^[A-Z][A-Z ]+$/.test(line.trim()) && !/FLAGS/.test(line)) on = false;
    if (!on) continue;
    const m = re.exec(line);
    if (!m) continue;
    const typeTok = m[3] && !/^\s*$/.test(m[3]) && !/\s{2}/.test(m[3]) && m[3].split(/\s+/).length <= 2 && !/^[A-Z]/.test(m[3]) ? m[3] : null;
    flags[m[2]] = { short: m[1] || null, value: !!typeTok };
  }
  return flags;
}
for (const c of GH) {
  const r = spawnSync('gh', [...c.split(' '), '--help'], { encoding: 'utf8' });
  out['gh ' + c] = parseGh(r.stdout + r.stderr);
  out['gh ' + c]['--help'] = { short: null, value: false };
}
// git prints "usage" lines with -h. Each option line looks like "    -m, --message <message>".
for (const c of GIT) {
  const r = spawnSync('git', [c, '-h'], { encoding: 'utf8' });
  const flags = {};
  for (const line of (r.stdout + r.stderr).split('\n')) {
    const m = /^\s+(?:(-\w), )?--(?:\[no-\])?([\w-]+)(?:\[=<[^>]+>\])?( <[^>]+>)?/.exec(line);
    const ms = /^\s+(-\w)(?:\[<[^>]+>\])?( <[^>]+>)?(\s{2,}|$)/.exec(line);
    if (m) flags['--' + m[2]] = { short: m[1] || null, value: !!m[3] };
    else if (ms) flags[ms[1]] = { short: null, value: !!ms[2], onlyShort: true };
  }
  // Some valid options (git commit --allow-empty) appear only in the usage synopsis.
  const usage = (r.stdout + r.stderr).split('\n\n')[0];
  for (const m of usage.matchAll(/--([\w-]+)(=<[^>]+>| <[^>]+>)?/g)) { if (!flags['--' + m[1]]) flags['--' + m[1]] = { short: null, value: !!m[2] }; }
  out['git ' + c] = flags;
}
fs.writeFileSync(path.join(__dirname, 'vendor', 'cmd-flags.json'), JSON.stringify(out, null, 1));
for (const k of Object.keys(out)) console.log(k.padEnd(24), Object.keys(out[k]).length, 'flags');
