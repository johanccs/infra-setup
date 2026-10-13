// The hands-on lessons of the Identity and Access Lab (steps 19 to 24) against the real thing: Keycloak (the page's own
// docker command and realm file), PostgreSQL, the Todo API built from the code on the page, a browser, and the Angular
// build. Needs Docker, the .NET SDK and curl; steps that need more say so and are skipped. Run from the tutorials folder:
//   node tests/identity-app.test.js
// Ports used: 8180 (Keycloak), 55432 (PostgreSQL), 5000 (the API) and 4200 (a stand-in for `ng serve`).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { check, skip, summary, run, sleep, find } = require('./lib.js');

const T = path.join(__dirname, '..');
const ROOT = path.join(T, '..');
const html = fs.readFileSync(path.join(T, 'docs', 'identity-and-access-tutorial.html'), 'utf8');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function block(caption) {
  const re = /<figure class="code"><figcaption>([^<]*)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre><\/figure>/g;
  for (const m of html.matchAll(re)) if (unesc(m[1]) === caption) return unesc(m[2]);
  return null;
}
const K = 'http://localhost:8180', REALM = K + '/realms/todo', TOKEN = REALM + '/protocol/openid-connect/token';
const PG = { name: 'ia-test-pg', port: 55432 }, KC = 'ia-test-kc';
const busy = (port) => new Promise((r) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
const J = async (url, opt = {}) => { const r = await fetch(url, opt); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } return { status: r.status, text: t, json: j, headers: r.headers }; };
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

// sign in through Keycloak's real login page with the authorization code flow and PKCE, and return the tokens
async function codeFlowTokens(user, pass, redirect = 'http://localhost:4200/api/auth/callback') {
  const verifier = crypto.randomBytes(48).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ client_id: 'todo-web', redirect_uri: redirect, response_type: 'code', scope: 'openid profile', state: 's', nonce: 'n', code_challenge: challenge, code_challenge_method: 'S256' });
  const page = await fetch(REALM + '/protocol/openid-connect/auth?' + q, { redirect: 'manual' });
  const cookies = page.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const action = /action="([^"]+)"/.exec(await page.text());
  if (!action) throw new Error('no login form (status ' + page.status + ')');
  const post = await fetch(action[1].replace(/&amp;/g, '&'), { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies }, body: new URLSearchParams({ username: user, password: pass }).toString() });
  const loc = post.headers.get('location') || '';
  const code = new URL(loc, redirect).searchParams.get('code');
  if (!code) throw new Error('no code in ' + loc.slice(0, 80));
  const t = await J(TOKEN, form({ grant_type: 'authorization_code', client_id: 'todo-web', client_secret: 'todo-web-practice-secret', code, code_verifier: verifier, redirect_uri: redirect }));
  return t.json;
}
const payload = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

async function main() {
  const docker = find('docker'), dotnet = find('dotnet');
  if (!docker || run(docker, ['ps']).status !== 0) return skip('Docker is not reachable: the Keycloak and API lessons (19 to 24) were not run');
  if (!dotnet) return skip('the .NET SDK is missing: the API lessons were not built');
  for (const p of [8180, PG.port]) if (await busy(p)) return skip(`port ${p} is in use: the hands-on tests need it free`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-app-'));
  const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_ROOT: path.dirname(fs.realpathSync(dotnet)) };
  const procs = [];
  const sh = (cmd, o = {}) => run('sh', ['-c', cmd], { cwd: work, timeout: 600000, input: '', env, ...o });
  try {
    // ---- step 19: the realm file and the docker command from the page
    const realmText = block('infra/keycloak/todo-realm.json'), dockerCmd = block('bash: start Keycloak (needs Docker)');
    check(!!realmText && !!dockerCmd, 'step 19 shows the realm file and the docker command');
    let realm; try { realm = JSON.parse(realmText); check(realm.realm === 'todo' && realm.clients.length === 3 && realm.users.length === 3, 'the realm file is valid JSON with the realm, three clients and the users'); } catch (e) { return check(false, 'the realm file is valid JSON', e.message); }
    fs.mkdirSync(path.join(work, 'infra', 'keycloak'), { recursive: true });
    fs.writeFileSync(path.join(work, 'infra', 'keycloak', 'todo-realm.json'), realmText);
    sh(`${docker} rm -f ${KC} ${PG.name}`);
    const started = sh(dockerCmd.replace(/^docker /, `${docker} `).replace('--name keycloak', '--name ' + KC));
    check(started.status === 0, 'the docker command on the page starts Keycloak', started.stderr);
    const pg = sh(`${docker} run -d --name ${PG.name} -e POSTGRES_PASSWORD=practice -e POSTGRES_DB=todos -p 127.0.0.1:${PG.port}:5432 postgres:18-alpine`);
    check(pg.status === 0, 'PostgreSQL starts for the API', pg.stderr);
    let up = false; for (let i = 0; i < 120 && !up; i++) { up = (await J(REALM + '/.well-known/openid-configuration').catch(() => ({ status: 0 }))).status === 200; if (!up) await sleep(2000); }
    check(up, 'Keycloak imports the realm file and serves the discovery document'); if (!up) return;
    const disc = (await J(REALM + '/.well-known/openid-configuration')).json;
    check(disc.issuer === REALM && /\/certs$/.test(disc.jwks_uri) && disc.code_challenge_methods_supported.includes('S256'), 'the issuer is the realm address the lesson names, and S256 is advertised');

    // the page's own curl commands, run for real
    const cmds = (() => { const src = fs.readFileSync(path.join(T, 'tools', 'identity-lab', 'exercises', '06-build.js'), 'utf8'); const w = { IA: { exercises: {}, cmds: {}, cmdFlags: {} } }; new Function('window', src)({ IA: w.IA, IACmdSpec: { spec: () => ({}) } }); return w.IA.cmds; })();
    for (const [id, expect] of [['a19-discovery', (j) => j.issuer === REALM], ['a19-jwks', (j) => Array.isArray(j.keys) && j.keys.length > 0], ['a19-gettoken', (j) => !!j.access_token && j.expires_in >= 295 && j.expires_in <= 300], ['a24-token', (j) => !!j.access_token]]) {
      const r = run('bash', ['-c', cmds[id].answer], { env: { ...process.env, REPORTER_SECRET: 'todo-reporter-practice-secret' } });
      let j = null; try { j = JSON.parse(r.stdout); } catch (e) { /* */ }
      check(r.status === 0 && j && expect(j), `drill ${id}: the answer runs against Keycloak and returns what the lesson says`, r.stdout.slice(0, 200) + r.stderr);
    }
    const rep = (await J(TOKEN, form({ grant_type: 'client_credentials', client_id: 'todo-reporter', client_secret: 'todo-reporter-practice-secret' }))).json;
    const rc = payload(rep.access_token);
    check(rc.iss === REALM && [].concat(rc.aud).includes('todo-api') && JSON.stringify(rc.roles) === '["todo-reporter"]' && rc.azp === 'todo-reporter' && rc.exp - rc.iat === 300, 'the machine client\'s token: issuer, audience todo-api, only the role todo-reporter, five minutes');
    check(!rep.refresh_token, 'client credentials issues no refresh token');
    const alice = await codeFlowTokens('alice', 'alice-practice-only'), bob = await codeFlowTokens('bob', 'bob-practice-only');
    const ac = payload(alice.access_token), bc = payload(bob.access_token);
    check(JSON.stringify(ac.roles) === '["todo-user"]' && ac.aud === 'todo-api' && ac.preferred_username === 'alice', 'Alice\'s token has roles ["todo-user"] and the audience todo-api');
    check([].concat(bc.roles).sort().join() === 'todo-admin,todo-user', 'Bob\'s token has both roles');
    check(!!alice.id_token && payload(alice.id_token).nonce === 'n' && payload(alice.id_token).aud === 'todo-web', 'the ID token is for todo-web and carries the nonce');

    // extra clients for the failure cases (not part of the lesson's realm file)
    const admin = (await J(K + '/realms/master/protocol/openid-connect/token', form({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin-practice-only' }))).json.access_token;
    const mk = (c) => J(K + '/admin/realms/todo/clients', { method: 'POST', headers: { authorization: 'Bearer ' + admin, 'content-type': 'application/json' }, body: JSON.stringify(c) });
    const roleMapper = { name: 'roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper', config: { 'claim.name': 'roles', multivalued: 'true', 'jsonType.label': 'String', 'access.token.claim': 'true' } };
    await mk({ clientId: 'other-app', secret: 'other-secret', directAccessGrantsEnabled: true, standardFlowEnabled: false, publicClient: false });
    await mk({ clientId: 'short-lived', secret: 'short-secret', directAccessGrantsEnabled: true, standardFlowEnabled: false, publicClient: false, attributes: { 'access.token.lifespan': '5' }, protocolMappers: [roleMapper, { name: 'aud', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: { 'included.client.audience': 'todo-api', 'access.token.claim': 'true' } }] });
    const pw = async (c, s) => (await J(TOKEN, form({ grant_type: 'password', client_id: c, client_secret: s, username: 'alice', password: 'alice-practice-only' }))).json.access_token;
    const otherAud = await pw('other-app', 'other-secret'), shortLived = await pw('short-lived', 'short-secret');

    // ---- the API, built from the page, at each step
    const apiSrc = path.join(ROOT, 'src', 'api');
    const gather = (tag) => {
      const dir = path.join(work, 'api-' + tag);
      fs.cpSync(apiSrc, dir, { recursive: true, filter: (s) => !/[\\/](bin|obj)([\\/]|$)/.test(s) && !/\.user$/.test(s) });
      return dir;
    };
    const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const steps = {};
    const s20 = gather('20'); write(s20, 'Program.cs', block('src/api/Program.cs (step 20)'));
    write(s20, 'Todo.Api.csproj', fs.readFileSync(path.join(apiSrc, 'Todo.Api.csproj'), 'utf8').replace('<PackageReference Include="Npgsql"', '<PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="10.0.13" />\n    <PackageReference Include="Npgsql"'));
    const s21 = gather('21'); write(s21, 'Program.cs', block('src/api/Program.cs (step 21)')); write(s21, 'Services/TodoStore.cs', block('src/api/Services/TodoStore.cs'));
    write(s21, 'Classes/AdminTodo.cs', block('src/api/Classes/AdminTodo.cs')); write(s21, 'Classes/Stats.cs', block('src/api/Classes/Stats.cs'));
    write(s21, 'Todo.Api.csproj', fs.readFileSync(path.join(s20, 'Todo.Api.csproj'), 'utf8'));
    const s22 = gather('22'); for (const f of ['Services/TodoStore.cs', 'Classes/AdminTodo.cs', 'Classes/Stats.cs']) write(s22, f, fs.readFileSync(path.join(s21, f), 'utf8'));
    write(s22, 'Program.cs', block('src/api/Program.cs (step 22)')); write(s22, 'Todo.Api.csproj', block('src/api/Todo.Api.csproj (step 22)'));
    const dirs = { 20: s20, 21: s21, 22: s22 };
    for (const [n, dir] of Object.entries(dirs)) {
      const b = sh(`${dotnet} build ${dir} -c Release -nologo`, { timeout: 900000 });
      const warnings = (/(\d+) Warning\(s\)/.exec(b.stdout) || [])[1];
      check(b.status === 0 && warnings === '0', `step ${n}: the code on the page builds with no warnings`, (b.stdout + b.stderr).split('\n').filter((l) => /error|warning/i.test(l)).slice(0, 6).join('\n'));
      steps[n] = path.join(dir, 'bin', 'Release', 'net10.0', 'Todo.Api.dll');
    }
    if (await busy(5000)) return skip('port 5000 is in use: the API steps were not run');
    const startApi = async (n, extra = {}) => {
      const log = fs.openSync(path.join(work, `api-${n}.log`), 'w');
      const p = spawn('sh', ['-c', `exec ${dotnet} ${steps[n]}`], { cwd: path.dirname(steps[n]), stdio: ['ignore', log, log], env: { ...env, ASPNETCORE_URLS: 'http://127.0.0.1:5000', ASPNETCORE_ENVIRONMENT: 'Development', ConnectionStrings__Todos: `Host=127.0.0.1;Port=${PG.port};Database=todos;Username=postgres;Password=practice`, Auth__Authority: REALM, Auth__ClientSecret: 'todo-web-practice-secret', ...extra } });
      procs.push(p);
      for (let i = 0; i < 60; i++) { const r = await J('http://127.0.0.1:5000/readyz').catch(() => ({ status: 0 })); if (r.status === 200) return p; await sleep(500); }
      throw new Error('the API did not become ready: ' + fs.readFileSync(path.join(work, `api-${n}.log`), 'utf8').slice(0, 400));
    };
    const stop = async (p) => { p.kill(); await sleep(800); };
    const api = (p, tok, o = {}) => J('http://127.0.0.1:5000' + p, { method: o.method || 'GET', headers: { ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(o.body ? { 'content-type': 'application/json' } : {}) }, body: o.body });
    const reset = () => sh(`${docker} exec ${PG.name} psql -U postgres -d todos -qc "drop table if exists todos"`);

    // step 20: authentication only
    reset(); let p = await startApi(20);
    const r401 = await api('/api/todos');
    check(r401.status === 401 && r401.headers.get('www-authenticate') === 'Bearer', 'step 20: no token gives 401 with a bare Bearer challenge');
    check((await api('/api/todos', alice.access_token)).status === 200, 'step 20: Alice\'s token is accepted');
    const wa = await api('/api/todos', otherAud);
    check(wa.status === 401 && /error="invalid_token", error_description="The audience 'empty' is invalid"/.test(wa.headers.get('www-authenticate')), 'step 20: a token for another audience is refused with the message the lesson quotes', wa.headers.get('www-authenticate'));
    const tam = await api('/api/todos', alice.access_token.slice(0, -3) + (alice.access_token.endsWith('AAA') ? 'BBB' : 'AAA'));
    check(tam.status === 401 && /The signature is invalid/.test(tam.headers.get('www-authenticate')), 'step 20: a changed token is refused: "The signature is invalid"', tam.headers.get('www-authenticate'));
    for (const e of ['/healthz', '/readyz', '/api/info']) check((await api(e)).status === 200, `step 20: ${e} stays open`);
    await sleep(36000);
    const ex = await api('/api/todos', shortLived);
    check(ex.status === 401 && /The token expired at '/.test(ex.headers.get('www-authenticate')), 'step 20: an expired token is refused once the 30 second skew has passed: "The token expired at"', ex.status + ' ' + ex.headers.get('www-authenticate'));
    await stop(p);

    // step 21: roles and owners, the whole table
    reset(); p = await startApi(21);
    const A = alice.access_token, B = bob.access_token, R = rep.access_token;
    const t = [];
    const row = async (label, got, want) => { if (got !== want) t.push(`${label}: ${got}, expected ${want}`); };
    for (const e of ['/healthz', '/readyz', '/api/info']) for (const tok of [null, A, B, R]) await row(`${e} as ${tok ? payload(tok).preferred_username : 'nobody'}`, (await api(e, tok)).status, 200);
    await row('anon GET todos', (await api('/api/todos')).status, 401);
    await row('anon POST todos', (await api('/api/todos', null, { method: 'POST', body: '{"title":"x"}' })).status, 401);
    const a1 = await api('/api/todos', A, { method: 'POST', body: '{"title":"alice 1"}' }), b1 = await api('/api/todos', B, { method: 'POST', body: '{"title":"bob 1"}' });
    await row('alice POST', a1.status, 201); await row('bob POST', b1.status, 201);
    await row('reporter POST', (await api('/api/todos', R, { method: 'POST', body: '{"title":"x"}' })).status, 403);
    await row('empty title', (await api('/api/todos', A, { method: 'POST', body: '{"title":" "}' })).status, 400);
    const aList = (await api('/api/todos', A)).json, bList = (await api('/api/todos', B)).json;
    await row('alice sees only hers', aList.map((x) => x.title).join(), 'alice 1'); await row('bob sees only his', bList.map((x) => x.title).join(), 'bob 1');
    await row('reporter GET todos', (await api('/api/todos', R)).status, 403);
    await row('alice toggles bob\'s', (await api(`/api/todos/${b1.json.id}/toggle`, A, { method: 'PUT' })).status, 404);
    await row('bob (admin) toggles alice\'s', (await api(`/api/todos/${a1.json.id}/toggle`, B, { method: 'PUT' })).status, 404);
    await row('alice toggles her own', (await api(`/api/todos/${a1.json.id}/toggle`, A, { method: 'PUT' })).status, 200);
    await row('alice deletes bob\'s', (await api(`/api/todos/${b1.json.id}`, A, { method: 'DELETE' })).status, 404);
    await row('bob (admin) deletes alice\'s', (await api(`/api/todos/${a1.json.id}`, B, { method: 'DELETE' })).status, 404);
    await row('alice admin/todos', (await api('/api/admin/todos', A)).status, 403);
    await row('reporter admin/todos', (await api('/api/admin/todos', R)).status, 403);
    const adm = await api('/api/admin/todos', B);
    await row('bob admin/todos', adm.status, 200); await row('admin sees everyone', (adm.json || []).map((x) => x.title).sort().join(), 'alice 1,bob 1');
    await row('alice stats', (await api('/api/admin/stats', A)).status, 403);
    const st = await api('/api/admin/stats', R);
    await row('reporter stats', st.status, 200); await row('stats body', JSON.stringify(st.json), '{"todos":2,"done":1,"owners":2}');
    await row('bob stats', (await api('/api/admin/stats', B)).status, 200);
    await row('bob deletes his own', (await api(`/api/todos/${b1.json.id}`, B, { method: 'DELETE' })).status, 204);
    await row('wrong audience', (await api('/api/todos', otherAud)).status, 401);
    check(t.length === 0, `step 21: every cell of the access table holds against Keycloak and PostgreSQL (${33} checks)`, t.join('\n'));
    await stop(p);

    // step 22: the BFF in a real browser
    reset(); if (await busy(4200)) skip('port 4200 is in use: the browser sign-in was not run');
    else {
      p = await startApi(22);
      const proxy = http.createServer((req, res) => {
        if (!req.url.startsWith('/api')) { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><title>todo</title><body>ui</body>'); }
        const u = http.request({ host: '127.0.0.1', port: 5000, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        req.pipe(u);
      }).listen(4200, 'localhost');
      const forged = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<form id=f method=post action="http://localhost:4200/api/todos" enctype="text/plain"><input name=\'{"title":"forged","x":"\' value=\'"}\'></form><script>f.submit()</script>'); }).listen(9999, '127.0.0.1');
      let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { /* skipped below */ }
      if (!chromium) skip('playwright-core is missing: the browser sign-in was not run');
      else {
        let br; try { br = await chromium.launch(); } catch (e) { skip('no browser could be started: ' + e.message.split('\n')[0]); }
        if (br) {
          const ctx = await br.newContext(), pg = await ctx.newPage();
          const call = (m, url, hdr, body) => pg.evaluate(async ([m, url, hdr, body]) => { const r = await fetch(url, { method: m, headers: hdr, body }); return { s: r.status, t: await r.text() }; }, [m, url, hdr || {}, body]);
          await pg.goto('http://localhost:4200/');
          check((await call('GET', '/api/auth/me')).s === 401, 'step 22: before signing in, /api/auth/me answers 401');
          await pg.goto('http://localhost:4200/api/auth/login?returnUrl=/');
          await pg.waitForSelector('#username'); await pg.fill('#username', 'alice'); await pg.fill('#password', 'alice-practice-only'); await pg.click('#kc-login');
          await pg.waitForURL('http://localhost:4200/**');
          const me = await call('GET', '/api/auth/me'); const mj = me.s === 200 ? JSON.parse(me.t) : {};
          check(me.s === 200 && mj.name === 'alice' && JSON.stringify(mj.roles) === '["todo-user"]', 'step 22: after signing in through Keycloak\'s page, /api/auth/me returns Alice and her roles', me.t);
          const ck = (await ctx.cookies()).find((c) => c.name === '__Host-todo');
          check(!!ck && ck.httpOnly && ck.secure && ck.sameSite === 'Strict' && ck.path === '/', 'step 22: the session cookie is __Host-todo, HttpOnly, Secure, SameSite=Strict, Path=/', JSON.stringify(ck));
          check(!(await pg.evaluate(() => document.cookie)).includes('__Host-todo') && !JSON.stringify(await pg.evaluate(() => ({ ...localStorage }))).includes('eyJ'), 'step 22: script can read neither the cookie nor any token');
          check((await call('GET', '/api/todos')).s === 200, 'step 22: the cookie authenticates API calls');
          check((await call('POST', '/api/todos', { 'content-type': 'application/json' }, '{"title":"x"}')).s === 403, 'step 22: a change without the X-Todo-Csrf header is refused');
          check((await call('POST', '/api/todos', { 'content-type': 'application/json', 'X-Todo-Csrf': '1' }, '{"title":"via cookie"}')).s === 201, 'step 22: the same call with the header is accepted');
          const other = await ctx.newPage(); await other.goto('http://127.0.0.1:9999/'); await sleep(1500);
          const after = JSON.parse((await call('GET', '/api/todos')).t);
          check(after.length === 1 && after[0].title === 'via cookie', 'step 22: a forged form post from another site adds nothing');
          const bearer = await api('/api/todos', B);
          check(bearer.status === 200, 'step 22: a bearer token still works on the same endpoints');
          await pg.evaluate(() => { const f = document.createElement('form'); f.method = 'post'; f.action = '/api/auth/logout'; document.body.append(f); f.submit(); });
          await sleep(3000); await pg.goto('http://localhost:4200/');
          check((await call('GET', '/api/auth/me')).s === 401, 'step 22: after the sign-out form post the session is gone');
          await br.close();
        }
      }
      proxy.close(); forged.close(); await stop(p);
    }

    // the Angular code
    const ui = path.join(ROOT, 'src', 'ui');
    if (!fs.existsSync(path.join(ui, 'node_modules', '.bin', 'ng'))) skip('src/ui/node_modules is missing: the Angular changes were not built');
    else {
      const dst = path.join(work, 'ui');
      for (const f of ['angular.json', 'package.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.spec.json']) if (fs.existsSync(path.join(ui, f))) fs.cpSync(path.join(ui, f), path.join(dst, f));
      fs.cpSync(path.join(ui, 'src'), path.join(dst, 'src'), { recursive: true }); if (fs.existsSync(path.join(ui, 'public'))) fs.cpSync(path.join(ui, 'public'), path.join(dst, 'public'), { recursive: true });
      fs.symlinkSync(path.join(ui, 'node_modules'), path.join(dst, 'node_modules'));
      for (const f of ['csrf.interceptor.ts', 'app.config.ts', 'app.ts', 'app.html']) write(dst, 'src/app/' + f, block('src/ui/src/app/' + f));
      const b = sh(`node_modules/.bin/ng build`, { cwd: dst, timeout: 600000 });
      check(b.status === 0, 'step 22: the Angular changes on the page build', (b.stdout + b.stderr).slice(-600));
    }

    // step 23: Google as an identity provider in the realm
    const idp = block('infra/keycloak/google-idp.json (add to "identityProviders" in todo-realm.json)');
    // the master realm's access tokens live one minute, so ask again
    const admin2 = (await J(K + '/realms/master/protocol/openid-connect/token', form({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin-practice-only' }))).json.access_token;
    const created = await J(K + '/admin/realms/todo/identity-provider/instances', { method: 'POST', headers: { authorization: 'Bearer ' + admin2, 'content-type': 'application/json' }, body: idp });
    check(created.status === 201, 'step 23: the Google provider JSON on the page is accepted by Keycloak', created.text);
    const challenge = crypto.createHash('sha256').update('v').digest('base64url');
    const login = await fetch(REALM + '/protocol/openid-connect/auth?' + new URLSearchParams({ client_id: 'todo-web', redirect_uri: 'http://localhost:4200/api/auth/callback', response_type: 'code', scope: 'openid', code_challenge: challenge, code_challenge_method: 'S256' }), { redirect: 'manual' });
    const lh = await login.text();
    const gl = /id="social-google"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*id="social-google"/.exec(lh);
    check(!!gl, 'step 23: the login page offers a Google button');
    if (gl) {
      const jar = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const go = await fetch(K + unesc((gl[1] || gl[2]).replace(/&amp;/g, '&')), { redirect: 'manual', headers: { cookie: jar } });
      const loc = new URL(go.headers.get('location'));
      check(loc.origin + loc.pathname === 'https://accounts.google.com/o/oauth2/v2/auth' && loc.searchParams.get('redirect_uri') === REALM + '/broker/google/endpoint' && loc.searchParams.get('scope') === 'openid profile email', 'step 23: choosing Google sends the browser to Google\'s authorize endpoint with Keycloak\'s redirect address, as the lesson says', go.headers.get('location'));
    }
    check(/http:\/\/localhost:8180\/realms\/todo\/broker\/google\/endpoint/.test(html), 'step 23 names that redirect address');

    // step 24: the reporter client, built and run
    const rdir = path.join(work, 'reporter'); write(rdir, 'Reporter.csproj', block('reporter/Reporter.csproj')); write(rdir, 'Program.cs', block('reporter/Program.cs'));
    const rb = sh(`${dotnet} build ${rdir} -c Release -nologo`, { timeout: 600000 });
    check(rb.status === 0 && /0 Warning\(s\)/.test(rb.stdout), 'step 24: the reporter client builds with no warnings', rb.stdout.slice(-400) + rb.stderr);
    reset(); p = await startApi(21);
    await api('/api/todos', A, { method: 'POST', body: '{"title":"r1"}' });
    const rr = sh(`${dotnet} ${path.join(rdir, 'bin', 'Release', 'net10.0', 'Reporter.dll')}`, { env: { ...env, REPORTER_SECRET: 'todo-reporter-practice-secret', AUTH_AUTHORITY: REALM, API_BASE: 'http://127.0.0.1:5000' } });
    const shown = (block('output') || '').trim().split('\n');
    const got = rr.stdout.trim().split('\n');
    check(rr.status === 0 && got.length === 4 && got.slice(0, 3).every((l) => /^200 \{"todos":\d+,"done":\d+,"owners":\d+\}$/.test(l)) && got[3] === 'token requests made: 1', 'step 24: the client reads the statistics three times with one token request', rr.stdout + rr.stderr);
    check(shown.length === 4 && shown[3] === got[3] && /^200 \{"todos":/.test(shown[0]), 'step 24: the output shown on the page has the shape of the real run');
    const noEnv = sh(`${dotnet} ${path.join(rdir, 'bin', 'Release', 'net10.0', 'Reporter.dll')}`, { env: { ...env, REPORTER_SECRET: '' } });
    check(noEnv.status !== 0, 'step 24: without the secret the client stops instead of calling');
    const wrongRole = await api('/api/todos', R);
    check(wrongRole.status === 403, 'step 24: the reporter\'s token is refused on /api/todos');
    await stop(p);
  } catch (e) {
    check(false, 'the hands-on tests ran to the end', e.stack || e.message);
  } finally {
    for (const p of procs) { try { p.kill(); } catch (e) { /* gone */ } }
    sh(`${docker} rm -f ${KC} ${PG.name}`);
    fs.rmSync(work, { recursive: true, force: true });
  }
}
main().then(() => process.exit(summary())).catch((e) => { console.log('ERROR ' + (e.stack || e)); process.exit(1); });
