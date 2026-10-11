// Prints one JSON line about the backup database: whether it is healthy and what it holds. Read-only.
//   node tools/db-summary.js [path-to-db]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2] || process.env.TUTORIAL_DB || path.join(__dirname, '..', 'data', 'tutorial.db');
const out = { ok: false, file, integrity: '', pages: 0, notes: 0, bookmarks: 0, ticked: 0 };
try {
  if (!fs.existsSync(file)) throw new Error('no such file');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  out.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const rows = db.prepare('SELECT page, key, value FROM state').all();
  const pages = new Set();
  for (const r of rows) {
    if (!r.value) continue;
    const v = JSON.parse(r.value);
    if (r.key === 'notes' && v.length) { out.notes += v.length; pages.add(r.page); }
    if (r.key === 'bookmarks' && v.length) { out.bookmarks += v.length; pages.add(r.page); }
    if (r.key === 'done') { const n = Object.values(v).filter(Boolean).length; out.ticked += n; if (n) pages.add(r.page); }
  }
  out.pages = pages.size;
  out.ok = out.integrity === 'ok';
} catch (e) { out.integrity = out.integrity || String(e.message || e); }
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
