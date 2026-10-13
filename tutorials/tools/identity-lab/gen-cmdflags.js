// Reads the real flags of every curl, openssl, kubectl and dotnet command the command drills use, from the installed tools' own help.
// Output: vendor/cmd-flags.json  { "openssl s_client": { "-connect": { value: true }, ... }, ... }
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const TOOLS = process.env.TOOLS_DIR ? process.env.TOOLS_DIR : '';
const PATH = (TOOLS ? TOOLS + ':' : '') + process.env.PATH;
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PATH } });
const out = {};

// curl --help all:   "-k, --insecure   Allow insecure server connections"  /  "    --cacert <file>  CA certificate to verify peer against"
function curlFlags() {
  const r = run('curl', ['--help', 'all']); const flags = {};
  for (const line of (r.stdout + r.stderr).split('\n')) {
    const m = /^\s*(?:(-[A-Za-z0-9#:]),\s+)?(--[\w.-]+)(?:\s+<([^>]+)>)?\s{2,}/.exec(line) || /^\s*(?:(-[A-Za-z0-9#:]),\s+)?(--[\w.-]+)(?:\s+<([^>]+)>)?\s*$/.exec(line);
    if (!m) continue;
    flags[m[2]] = { short: m[1] || null, value: !!m[3] };
  }
  return flags;
}
// openssl <sub> -help:   " -connect val       TCP/IP where to connect" /  " -noout          Do not output the encoded version"
function opensslFlags(sub) {
  const r = run('openssl', [sub, '-help']); const flags = {};
  for (const line of (r.stdout + r.stderr).split('\n')) {
    const m = /^\s+(-[A-Za-z0-9_.-]+)(?:\s+(\S+))?\s{2,}\S/.exec(line) || /^\s+(-[A-Za-z0-9_.-]+)\s*$/.exec(line);
    if (!m) continue;
    flags[m[1]] = { value: !!m[2] && !/^[A-Z]/.test(m[2]) ? true : !!m[2] && /^[a-z]+$/.test(m[2]) };
  }
  return flags;
}
// kubectl <sub> --help:   "  -n, --namespace='': ..."   "--dry-run='none': ..."   "--force=false: ..."
function kubectlFlags(sub) {
  const r = run('kubectl', [...sub.split(' '), '--help']); const flags = {};
  for (const line of (r.stdout + r.stderr).split('\n')) {
    const m = /^\s+(?:(-[A-Za-z]),\s+)?(--[\w-]+)(?:=([^:]*))?:/.exec(line);
    if (!m) continue;
    flags[m[2]] = { short: m[1] || null, value: m[3] !== undefined && !/^(true|false)$/.test(m[3]) };
  }
  return flags;
}
const kubeGlobal = (() => { const r = run('kubectl', ['options']); const f = {}; for (const line of (r.stdout + r.stderr).split('\n')) { const m = /^\s+(?:(-[A-Za-z]),\s+)?(--[\w-]+)(?:=([^:]*))?:/.exec(line); if (m) f[m[2]] = { short: m[1] || null, value: m[3] !== undefined && !/^(true|false)$/.test(m[3]) }; } return f; })();
out['curl'] = curlFlags();
for (const s of ['req', 'x509', 'genpkey', 'verify', 's_client', 's_server', 'dgst', 'rand', 'ecparam', 'pkcs12', 'pkey']) out['openssl ' + s] = opensslFlags(s);
for (const s of ['get', 'describe', 'apply', 'auth can-i', 'create role', 'create rolebinding', 'logs']) out['kubectl ' + s] = Object.assign({}, kubeGlobal, kubectlFlags(s));
fs.writeFileSync(path.join(__dirname, 'vendor', 'cmd-flags.json'), JSON.stringify(out, null, 1));
for (const k of Object.keys(out)) console.log(k.padEnd(26), Object.keys(out[k]).length, 'flags');
