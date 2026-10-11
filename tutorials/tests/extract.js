// Pulls every file shown in a tutorial's code blocks into a folder, so the tutorial can be built and tested as written.
//   node tests/extract.js docs/code-to-cluster-tutorial.html out-dir
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function extract(htmlFile, outDir) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const files = {};
  const re = /<figcaption>(.*?)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/g;
  let m;
  while ((m = re.exec(html))) {
    const caption = m[1].replace(/<[^>]+>/g, '').trim();
    if (/^(bash|git bash|powershell)/i.test(caption) || /\(round \d\)/.test(caption)) continue;
    const name = caption.replace(/\s*\(.*\)$/, '');
    if (!/^[.\w-]+(\/[.\w-]+)*$/.test(name) || !/[./]/.test(name)) continue;
    // The page puts the apps under src/ and the cluster files under infra/. Tests treat them as top-level folders.
    files[name.replace(/^(src|infra)\//, '')] = unescapeHtml(m[2]).replace(/\n$/, '') + '\n';
  }
  for (const [name, text] of Object.entries(files)) {
    const dest = path.join(outDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  }
  return Object.keys(files);
}

// The text of every code block captioned "bash …", in page order.
function bashBlocks(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const out = [];
  const re = /<figcaption>((?:Git )?[Bb]ash[^<]*)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/g;
  let m;
  while ((m = re.exec(html))) out.push({ caption: m[1], code: unescapeHtml(m[2]) });
  return out;
}

if (require.main === module) {
  const [, , htmlFile, outDir] = process.argv;
  if (!htmlFile || !outDir) { console.error('usage: node tests/extract.js <tutorial.html> <out-dir>'); process.exit(2); }
  console.log(extract(htmlFile, outDir).join('\n'));
}
module.exports = { extract, bashBlocks };
