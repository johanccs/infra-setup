// Rewrites the "Tutorials" menu in every page listed in tools/pages.json, so a new tutorial only has to be added in one place.
//   node tools/sync-menu.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const p of pages) {
  const file = path.join(__dirname, '..', 'docs', p.file);
  const html = fs.readFileSync(file, 'utf8');
  const items = pages.map((q) => `      <a role="menuitem" href="${q.file}"${q.file === p.file ? ' aria-current="page"' : ''}><b>${esc(q.name)}</b><span>${esc(q.blurb)}</span></a>`).join('\n');
  const re = /(<div class="tmenu-list"[^>]*>\n)[\s\S]*?(\n    <\/div>)/;
  if (!re.test(html)) throw new Error(p.file + ': tutorials menu not found');
  fs.writeFileSync(file, html.replace(re, (m, a, z) => a + items + z));
  console.log('menu updated:', p.file);
}
