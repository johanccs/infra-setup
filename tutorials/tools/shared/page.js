// Shared page builder for the generated tutorial pages (the GitHub Actions Lab, the Identity and Access Lab).
// Each lab keeps its own sources (body/*.html, lab.css, scripts); this file does the part they have in common:
// take the newest tutorial page as the template, swap in the title and intro, splice in the lesson sections,
// add the styles and scripts, and write the page.
//
//   const { buildPage } = require('../shared/page.js');
//   buildPage({ tutorialsDir, template, meta, body, css, scripts, stripScrollTick, railLevel });
const fs = require('fs');
const path = require('path');

// meta: { file, name, key, desc, eyebrow, lede, stack: [] }
function buildPage(o) {
  const { tutorialsDir, meta } = o;
  let h = fs.readFileSync(path.join(tutorialsDir, 'docs', o.template), 'utf8');
  function rep(re, fn) { if (!re.test(h)) throw new Error('template: ' + re); h = h.replace(re, fn); }
  rep(/<title>[^<]*<\/title>/, () => `<title>${meta.name}</title>`);
  rep(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${meta.desc}">`);
  rep(/<p class="eyebrow">[^<]*<\/p>/, () => `<p class="eyebrow">${meta.eyebrow}</p>`);
  rep(/<h1>[^<]*<\/h1>/, () => `<h1>${meta.name}</h1>`);
  rep(/<p class="lede">[^<]*<\/p>/, () => `<p class="lede">${meta.lede.replace(/&/g, '&amp;')}</p>`);
  rep(/<ul class="stack">[\s\S]*?<\/ul>/, () => `<ul class="stack">\n        ${meta.stack.map((s) => `<li>${s}</li>`).join('')}\n      </ul>`);

  const a = h.indexOf('    <!-- ============ 0 ============ -->'), z = h.indexOf('  </main>');
  if (a < 0 || z < 0) throw new Error('sections not found');
  h = h.slice(0, a) + o.body + '\n  ' + h.slice(z);
  rep(/var KEY = 'code-to-cluster-tutorial-done';/, () => `var KEY = '${meta.key}';`);
  // On a lab page a tick means "every exercise passed", so scrolling past a step must not tick it.
  if (o.stripScrollTick) rep(/\n\s*\/\/ Moving past a step marks it done\.[\s\S]*?\n        \}\);\n/, () => '\n');

  // Show each lesson's level (Easy, Advanced, ...) next to its title in the steps rail.
  if (o.railLevel) rep(/a\.querySelector\('\.t'\)\.textContent = title;/, () => "a.querySelector('.t').textContent = title; var lv = s.getAttribute('data-level'); if (lv) { var c = document.createElement('i'); c.className = 'lvl'; c.textContent = lv; a.querySelector('.t').appendChild(c); }");

  h = h.replace('</style>', () => '/* the lab */\n' + o.css + '\n</style>');
  h = h.replace('</body>', () => o.scripts + '\n</body>');
  fs.writeFileSync(path.join(tutorialsDir, 'docs', meta.file), h);
  return { file: meta.file, bytes: h.length, sections: (h.match(/<section class="step"/g) || []).length };
}

module.exports = { buildPage };
