// Builds docs/identity-and-access-tutorial.html: the page template (from the first tutorial), the lesson text in body/,
// the styles, and the lab scripts.
//   node tools/identity-lab/build.js
// Then:  node tools/sync-menu.js && node tools/sync-backup.js
const fs = require('fs');
const path = require('path');
const HERE = __dirname, T = path.join(HERE, '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const { buildPage } = require('../shared/page.js');

const meta = {
  file: 'identity-and-access-tutorial.html', name: 'Identity and Access Lab', key: 'identity-and-access-tutorial-done',
  desc: 'An interactive lab for .NET developers: how sign-in and access control work, from cookies, HTTPS and certificates to JWT, OAuth 2.0, OpenID Connect, Log in with Google and RBAC, with animated diagrams, tools in the page, and a real Keycloak sign-in for the Todo app.',
  eyebrow: 'Interactive lab · TLS, certificates, OAuth, OIDC, JWT, RBAC · easy to expert · free',
  lede: 'Learn how people and programs prove who they are and what they may do. Start with what authentication and authorization mean, then HTTPS and certificates, tokens, OAuth 2.0 and OpenID Connect, signing in with Google, and access control, and finish by securing the Todo app yourself.',
  stack: ['TLS', 'X.509 certificates', 'JWT', 'OAuth 2.0', 'OpenID Connect', 'RBAC', 'Keycloak', 'ASP.NET Core', 'Angular', 'Kubernetes'],
};

const body = fs.readdirSync(path.join(HERE, 'body')).filter((f) => /\.html$/.test(f)).sort().map((f) => read(HERE, 'body', f).replace(/\s+$/, '')).join('\n\n');
const exerciseFiles = fs.existsSync(path.join(HERE, 'exercises')) ? fs.readdirSync(path.join(HERE, 'exercises')).filter((f) => /\.js$/.test(f)).sort().map((f) => `// ---- exercises/${f}\n` + read(HERE, 'exercises', f)).join('\n') : '';
const scripts = [
  '<script>\n' + read(HERE, 'crypto.js') + '\n</script>',
  '<script>\n' + read(HERE, 'x509.js') + '\n</script>',
  '<script>/* js-yaml (MIT) */\n' + read(HERE, 'vendor', 'js-yaml.min.js') + '\n</script>',
  '<script>\n' + read(HERE, 'authz.js') + '\n</script>',
  '<script>\n' + read(HERE, 'cookie.js') + '\n</script>',
  '<script>\n' + read(HERE, 'flow.js') + '\n</script>',
  '<script>\n' + read(HERE, 'attacklab.js').replace("require('./crypto.js')", 'null') + '\n</script>',
  '<script>\n' + read(HERE, '..', 'shared', 'cmdline.js') + '\n</script>',
  '<script>\n' + read(HERE, 'cmdspec.js') + '\nwindow.IA = window.IA || { exercises: {} };\nIA.cmdFlags = ' + fs.readFileSync(path.join(HERE, 'vendor', 'cmd-flags.json'), 'utf8') + ';\n</script>',
  '<script>\n' + read(HERE, 'engine.js') + '\n</script>',
  '<script>\nwindow.IA = window.IA || { exercises: {} };\nIA.cmds = IA.cmds || {};\n' + exerciseFiles + '\n</script>',
  '<script>\n' + read(HERE, 'ui.js') + '\n</script>',
].join('\n');
if (/<\/script/i.test(read(HERE, 'crypto.js') + read(HERE, 'x509.js') + read(HERE, 'cookie.js') + read(HERE, 'authz.js') + read(HERE, 'flow.js') + read(HERE, 'attacklab.js') + read(HERE, 'engine.js') + exerciseFiles + read(HERE, 'ui.js'))) throw new Error('a script contains </script');
const r = buildPage({ tutorialsDir: T, template: 'code-to-cluster-tutorial.html', meta, body, css: read(HERE, 'lab.css'), scripts, stripScrollTick: true, railLevel: true });
console.log('wrote', r.file, (r.bytes / 1e6).toFixed(2) + ' MB;', r.sections, 'sections');
