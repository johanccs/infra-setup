// Builds docs/github-actions-tutorial.html: the page template (from the first tutorial), the lesson text in body/,
// the lab engine and labs, and the actionlint checker (WebAssembly, gzipped, as one inline block).
//   node tools/actions-lab/build.js
// Then:  node tools/sync-menu.js && node tools/sync-backup.js
const fs = require('fs');
const path = require('path');
const HERE = __dirname, T = path.join(HERE, '..', '..'), V = path.join(HERE, 'vendor');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const tpl = read(T, 'docs', 'code-to-cluster-tutorial.html');

const meta = {
  file: 'github-actions-tutorial.html', name: 'GitHub Actions Lab', key: 'github-actions-tutorial-done',
  desc: 'An interactive lab for .NET developers: write GitHub Actions pipelines in an editor that checks every line as you type, from your first workflow to an enterprise pipeline with signed images, approvals and keyless cloud access. Then read broken pipelines and fix them.',
  eyebrow: 'Interactive lab · .NET, Angular and Docker · about 8 hours · free',
  lede: 'Learn GitHub Actions by writing it. An editor checks every line as you type, with the actionlint linter running in your browser, and shows what would run for a push, a pull request, a tag or a merge queue. Write pipelines from nothing, then read broken ones and fix them, until you can build an enterprise CI/CD pipeline without looking anything up.',
  stack: ['GitHub Actions', 'actionlint', '.NET 10', 'Angular', 'Docker', 'Buildx', 'cosign', 'CodeQL', 'OIDC', 'AWS'],
};
let h = tpl;
function rep(re, fn) { if (!re.test(h)) throw new Error('template: ' + re); h = h.replace(re, fn); }
rep(/<title>[^<]*<\/title>/, () => `<title>${meta.name}</title>`);
rep(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${meta.desc}">`);
rep(/<p class="eyebrow">[^<]*<\/p>/, () => `<p class="eyebrow">${meta.eyebrow}</p>`);
rep(/<h1>[^<]*<\/h1>/, () => `<h1>${meta.name}</h1>`);
rep(/<p class="lede">[^<]*<\/p>/, () => `<p class="lede">${meta.lede.replace(/&/g, '&amp;')}</p>`);
rep(/<ul class="stack">[\s\S]*?<\/ul>/, () => `<ul class="stack">\n        ${meta.stack.map((s) => `<li>${s}</li>`).join('')}\n      </ul>`);

const body = fs.readdirSync(path.join(HERE, 'body')).filter((f) => /\.html$/.test(f)).sort().map((f) => read(HERE, 'body', f).replace(/\s+$/, '')).join('\n\n');
const a = h.indexOf('    <!-- ============ 0 ============ -->'), z = h.indexOf('  </main>');
if (a < 0 || z < 0) throw new Error('sections not found');
h = h.slice(0, a) + body + '\n  ' + h.slice(z);
rep(/var KEY = 'code-to-cluster-tutorial-done';/, () => `var KEY = '${meta.key}';`);
// On this page a tick means "every exercise passed", so scrolling past a step must not tick it.
rep(/\n\s*\/\/ Moving past a step marks it done\.[\s\S]*?\n        \}\);\n/, () => '\n');

// styles
h = h.replace('</style>', () => '/* the lab */\n' + read(HERE, 'lab.css') + '\n</style>');

// scripts: parser, Go's wasm loader, the checker, then the engine, the data, the labs and the page code
const wasm = fs.readFileSync(path.join(V, 'actionlint.wasm.gz')).toString('base64');
const actions = fs.readFileSync(path.join(V, 'actions-meta.json'), 'utf8');
const flags = fs.readFileSync(path.join(V, 'cmd-flags.json'), 'utf8');
const labs = ['common.js', 'a1.js', 'a2.js', 'a3.js', 'a4.js', 'cmds.js', 'drills.js', 'b.js', 'b2.js', 'c.js', 'c2.js'].map((f) => `// ---- ${f}\n` + read(HERE, 'labs', f)).join('\n');
const scripts = [
  '<script id="al-wasm" type="application/octet-stream">' + wasm + '</script>',
  '<script>/* js-yaml (MIT) */\n' + read(V, 'js-yaml.min.js') + '</script>',
  '<script>/* Go wasm_exec.js (BSD) */\n' + read(V, 'wasm_exec.js') + '</script>',
  '<script>\n' + read(HERE, 'engine.js') + '\nwindow.GA = GA; GA.actions = ' + actions + '; GA.cmdFlags = ' + flags + '; window.ACTIONLINT_VERSION = "1.7.12";\n</script>',
  '<script>\n' + read(HERE, 'assist.js') + '\n</script>',
  '<script>\n' + labs + '\n</script>',
  '<script>\n' + read(HERE, 'ui.js') + '\n</script>',
].join('\n');
if (/<\/script/i.test(labs + read(HERE, 'ui.js') + read(HERE, 'engine.js') + read(HERE, 'assist.js'))) throw new Error('a script contains </script');
h = h.replace('</body>', () => scripts + '\n</body>');
fs.writeFileSync(path.join(T, 'docs', meta.file), h);
console.log('wrote', meta.file, (h.length / 1e6).toFixed(2) + ' MB;', (h.match(/<section class="step"/g) || []).length, 'sections');
