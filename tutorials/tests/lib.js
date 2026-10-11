// Small helpers shared by the content test scripts: pass/fail counting, tool lookup, running commands, YAML to JSON.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const TOOLS = process.env.TOOLS_DIR || '';
let fails = 0, passes = 0, skips = 0;
const check = (ok, msg, detail) => { if (ok) passes++; else fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && detail ? '\n' + String(detail).trim().split('\n').map((l) => '     ' + l).join('\n') : '')); };
const skip = (msg) => { skips++; console.log('SKIP ' + msg); };
const summary = () => { console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`); return fails ? 1 : 0; };

// Tools are looked up on PATH, or in the folder named by TOOLS_DIR.
function find(tool) {
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  if (TOOLS) {
    const dirs = [TOOLS, ...fs.readdirSync(TOOLS).map((d) => path.join(TOOLS, d)).filter((d) => fs.statSync(d).isDirectory())];
    for (const dir of dirs) for (const name of [tool, tool + '.exe']) if (isFile(path.join(dir, name))) return path.join(dir, name);
  }
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [tool], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const get = (url, opts = {}) => new Promise((resolve) => {
  const r = http.request(url, { method: opts.method || 'GET', headers: { 'content-type': 'application/json' } }, (res) => {
    let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  r.on('error', () => resolve({ status: 0, body: '' }));
  r.end(opts.body);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Every YAML document in `text`, as JS objects (uses Python's yaml module).
const yamlDocs = (text) => {
  const r = run('python3', ['-c', 'import sys,yaml,json; print(json.dumps([d for d in yaml.safe_load_all(sys.stdin) if d]))'], { input: text });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const CRDS = 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json';

module.exports = { check, skip, summary, find, run, get, sleep, yamlDocs, CRDS };
