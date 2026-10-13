// Prints your notes, bookmarks and progress from the backup database as Markdown, so you can read or keep them anywhere.
//   node tools/export-notes.js > my-notes.md
// Reads data/tutorial.db (or the file named by TUTORIAL_DB) and never changes it.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const file = process.env.TUTORIAL_DB || path.join(__dirname, '..', 'data', 'tutorial.db');
if (!fs.existsSync(file)) { console.error(`No backup database at ${file} yet. Start the server and use the tutorial first.`); process.exit(1); }
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(file, { readOnly: true });
const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pages = db.prepare('SELECT DISTINCT page FROM state ORDER BY page').all().map((r) => r.page);
const out = ['# My tutorial notes', ''];
for (const page of pages) {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM state WHERE page = ?').all(page).map((r) => [r.key, r.value && JSON.parse(r.value)]));
  const notes = (rows.notes || []).slice().sort((a, b) => a.ts - b.ts), marks = (rows.bookmarks || []).slice().sort((a, b) => a.ts - b.ts);
  const done = Object.values(rows.done || {}).filter(Boolean).length;
  if (!notes.length && !marks.length && !done) continue;
  out.push(`## ${page}`, '');
  if (done) out.push(`Steps ticked off: ${done}`, '');
  if (notes.length) { out.push('### Notes', ''); for (const n of notes) out.push(`- ${n.no ? '#' + n.no + ' ' : ''}**${n.quote}** (${when(n.upd || n.ts)}${n.upd ? ', edited' : ''})`, `  ${String(n.text).replace(/\n/g, '\n  ')}`); out.push(''); }
  if (marks.length) { out.push('### Bookmarks', ''); for (const m of marks) out.push(`- ${m.no ? '#' + m.no + ' ' : ''}${m.quote} (${when(m.ts)})`); out.push(''); }
}
if (out.length === 2) out.push('Nothing saved yet.');
console.log(out.join('\n'));
