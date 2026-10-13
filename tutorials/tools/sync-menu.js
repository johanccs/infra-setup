// Rewrites the "Tutorials" menu (and its styles) in every page listed in tools/pages.json, so a new tutorial only has to be
// added in one place. Pages are grouped by "group", each row shows the name and a short "tag"; the longer "blurb" is the tooltip.
//   node tools/sync-menu.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const CSS = `/* tmenu:start */
.tmenu-list { position: absolute; right: 0; top: calc(100% + 8px); width: 290px; max-height: calc(100vh - 90px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--muted) transparent; padding: 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .18); z-index: 16; }
.tmenu-list::-webkit-scrollbar { width: 10px; }
.tmenu-list::-webkit-scrollbar-thumb { background: var(--muted); border-radius: 6px; border: 2px solid var(--surface); }
.tmenu-group { margin: 8px 10px 2px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.tmenu-group:first-child { margin-top: 4px; }
.tmenu-list a { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 7px 10px; border-radius: 6px; color: var(--ink); text-decoration: none; font-size: 14.5px; }
.tmenu-list a b { font-weight: 600; }
.tmenu-list a span { flex-shrink: 0; font-size: 12px; color: var(--muted); }
.tmenu-list a:hover, .tmenu-list a:focus-visible { background: var(--accent-soft); }
.tmenu-list a[aria-current="page"] { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
@media (max-width: 600px) { .tmenu { position: static; } .tmenu-list { position: fixed; left: 12px; right: 12px; top: calc(env(safe-area-inset-top, 0px) + 58px); width: auto; max-height: calc(100vh - 80px); } }
/* tmenu:end */`;

for (const p of pages) {
  const file = path.join(__dirname, '..', 'docs', p.file);
  let html = fs.readFileSync(file, 'utf8');
  let out = '', last = null;
  for (const q of pages) {
    if (q.group !== last) { out += `      <p class="tmenu-group" role="presentation">${esc(q.group)}</p>\n`; last = q.group; }
    out += `      <a role="menuitem" href="${q.file}" title="${esc(q.blurb)}"${q.file === p.file ? ' aria-current="page"' : ''}><b>${esc(q.name)}</b><span>${esc(q.tag)}</span></a>\n`;
  }
  const re = /(<div class="tmenu-list"[^>]*>\n)[\s\S]*?(\n    <\/div>)/;
  if (!re.test(html)) throw new Error(p.file + ': tutorials menu not found');
  html = html.replace(re, (m, a, z) => a + out.replace(/\n$/, '') + z);
  // styles: replace the marked block, or the original five rules the first time
  const marked = /\/\* tmenu:start \*\/[\s\S]*?\/\* tmenu:end \*\//;
  const orig = /\.tmenu-list \{[^\n]*\n\.tmenu-list a \{[^\n]*\n\.tmenu-list a b \{[^\n]*\n\.tmenu-list a span \{[^\n]*\n\.tmenu-list a:hover[^\n]*\n\.tmenu-list a\[aria-current="page"\] \{[^\n]*/;
  if (marked.test(html)) html = html.replace(marked, () => CSS);
  else if (orig.test(html)) html = html.replace(orig, () => CSS);
  else throw new Error(p.file + ': menu styles not found');
  fs.writeFileSync(file, html);
  console.log('menu updated:', p.file);
}
