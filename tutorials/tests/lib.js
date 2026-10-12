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

// Checks an object against a CRD's schema: unknown fields, wrong types, missing required fields. Returns a list of problems.
function schemaProblems(crd, obj) {
  const ver = crd.spec.versions.find((x) => x.name === obj.apiVersion.split('/')[1]);
  if (!ver) return [`no ${obj.apiVersion} version in the CRD`];
  const errs = [];
  const walk = (s, v, p) => {
    if (!s || s['x-kubernetes-preserve-unknown-fields'] || s['x-kubernetes-int-or-string']) return;
    if (s.enum && !s.enum.includes(v)) errs.push(`${p}: ${JSON.stringify(v)} is not one of ${s.enum.join('|')}`);
    if (s.type === 'object' || s.properties) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) { errs.push(`${p}: expected an object`); return; }
      const props = s.properties || {};
      for (const k of Object.keys(v)) {
        if (props[k]) walk(props[k], v[k], `${p}.${k}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, v[k], `${p}.${k}`);
        else if (s.additionalProperties !== true && !s['x-kubernetes-preserve-unknown-fields']) errs.push(`${p}.${k}: unknown field`);
      }
      for (const r of s.required || []) if (!(r in v)) errs.push(`${p}.${r}: required`);
    } else if (s.type === 'array') {
      if (!Array.isArray(v)) { errs.push(`${p}: expected a list`); return; }
      v.forEach((x, i) => walk(s.items, x, `${p}[${i}]`));
    } else if (s.type === 'string' && typeof v !== 'string') errs.push(`${p}: expected a string`);
    else if (s.type === 'boolean' && typeof v !== 'boolean') errs.push(`${p}: expected true or false`);
    else if ((s.type === 'integer' || s.type === 'number') && typeof v !== 'number') errs.push(`${p}: expected a number`);
  };
  const top = ver.schema.openAPIV3Schema;
  const { apiVersion, kind, metadata, ...rest } = obj;
  walk({ ...top, required: [] }, rest, kind);
  return errs;
}

module.exports = { check, skip, summary, find, run, get, sleep, yamlDocs, CRDS, schemaProblems };
