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
    if (/\(([^)]*changes only|[^)]*pod spec|add to env|inside syncPolicy|inside api:|the api container|the Deployment spec|the connection string|add to paths:|add under jobs:|example for [^)]*|the (AWS|EKS) version[^)]*|two (more )?additions)\)/.test(caption)) continue;   // an excerpt of a file shown in full elsewhere
    const name = caption.replace(/\s*\(.*\)$/, '');
    const append = /\(add at the end\)/.test(caption);   // a block that adds to the end of a file shown earlier
    if (!/^[.\w-]+(\/[.\w-]+)*$/.test(name) || !/[./]/.test(name)) continue;
    // The page puts the apps under src/ and the cluster files under infra/. Tests treat them as top-level folders.
    const key = name.replace(/^(src|infra)\//, '');
    const text = unescapeHtml(m[2]).replace(/\n$/, '') + '\n';
    files[key] = append && files[key] ? files[key] + text : text;
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

// The text of every code block whose caption matches `captionRe` (for example /^PromQL$/), in page order.
function blocksCaptioned(htmlFile, captionRe) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const out = [];
  const re = /<figcaption>(.*?)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/g;
  let m;
  while ((m = re.exec(html))) if (captionRe.test(m[1].replace(/<[^>]+>/g, '').trim())) out.push(unescapeHtml(m[2]));
  return out;
}

if (require.main === module) {
  const [, , htmlFile, outDir] = process.argv;
  if (!htmlFile || !outDir) { console.error('usage: node tests/extract.js <tutorial.html> <out-dir>'); process.exit(2); }
  console.log(extract(htmlFile, outDir).join('\n'));
}
module.exports = { extract, bashBlocks, blocksCaptioned };
