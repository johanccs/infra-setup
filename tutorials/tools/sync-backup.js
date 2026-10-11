// Puts the backup script (tools/backup-snippet.html) and its status badge into every page listed in tools/pages.json.
// Safe to run again: it replaces what is between the markers.
//   node tools/sync-backup.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const snippet = fs.readFileSync(path.join(__dirname, 'backup-snippet.html'), 'utf8').replace(/\s+$/, '');
const BADGE = '<span class="bk-state" id="backup-state" hidden></span>';
function put(html, name, text, anchor, where) {
  const re = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->\\n?`);
  const block = `<!-- ${name}:start -->${text}<!-- ${name}:end -->\n`;
  if (re.test(html)) return html.replace(re, () => block);
  const i = html.indexOf(anchor);
  if (i < 0) throw new Error(`anchor not found for ${name}: ${anchor}`);
  return where === 'before' ? html.slice(0, i) + block + html.slice(i) : html.slice(0, i + anchor.length) + block + html.slice(i + anchor.length);
}
for (const p of pages) {
  const file = path.join(__dirname, '..', 'docs', p.file);
  let html = fs.readFileSync(file, 'utf8');
  html = put(html, 'backup', '\n' + snippet + '\n', '</head>', 'before');
  html = put(html, 'backup-badge', BADGE, '<span class="tb-done"', 'before');
  fs.writeFileSync(file, html);
  console.log('backup added:', p.file);
}
