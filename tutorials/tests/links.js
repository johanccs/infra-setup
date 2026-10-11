// Checks that every https link in the tutorials and docs still opens.
//   node tests/links.js
// Some sites refuse automated requests (403/429/999); those are reported as "blocked", not as broken.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCS = path.join(__dirname, '..', 'docs');
const SKIP = /0\.0\.0\.0|&lt;|config\/crd\/|localhost|127\.0\.0\.1|YOUR|your-user|\$|<|kubernetes\.default\.svc|\.svc\.cluster\.local|token\.actions\.githubusercontent\.com|raw\.githubusercontent\.com|fonts\.(googleapis|gstatic)\.com\/?$|^http:\/\/todo-/;
const urls = new Map();
for (const f of fs.readdirSync(DOCS).filter((n) => /\.(html|md)$/.test(n))) {
  for (const m of fs.readFileSync(path.join(DOCS, f), 'utf8').matchAll(/https?:\/\/[^\s)"'<>`|]+/g)) {
    const u = m[0].replace(/[.,;:]+$/, '');
    if (!SKIP.test(u)) urls.set(u, [...(urls.get(u) || []), f]);
  }
}

// curl is used instead of fetch(): it falls back between IPv4 and IPv6, which some hosts need.
function probe(u) {
  const r = spawnSync('curl', ['-s', '-o', os.devNull, '-L', '-m', '25', '--retry', '2', '-A', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/124 Safari/537.36', '-w', '%{http_code}', u], { encoding: 'utf8' });
  if (r.error) return 'curl is not available';
  const code = +r.stdout;
  if (code >= 200 && code < 400) return 'ok';
  if ([403, 429, 999].includes(code)) return 'blocked';
  if (code === 0 && r.status === 60) return 'blocked';   // incomplete certificate chain on the site: browsers usually still open it
  if (code === 0) return 'no answer (curl exit ' + r.status + ')';
  return 'HTTP ' + code;
}

(async () => {
  const list = [...urls.keys()];
  const results = new Map();
  for (const u of list) results.set(u, probe(u));
  let bad = 0, blocked = 0;
  for (const u of list) {
    const r = results.get(u);
    if (r === 'ok') continue;
    if (r === 'blocked') { blocked++; console.log('blocked  ' + u); continue; }
    bad++; console.log('BROKEN   ' + u + '  (' + r + ')  in ' + [...new Set(urls.get(u))].join(', '));
  }
  console.log(`${list.length} links checked, ${bad} broken, ${blocked} blocked`);
  process.exit(bad ? 1 : 0);
})();
