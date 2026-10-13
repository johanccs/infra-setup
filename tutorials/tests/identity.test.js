// The Identity and Access Lab: the page matches its sources, every fact has a source in the ledger, the cited RFCs are
// still current, every diagram frame fits, and the page works in a browser. Run from the tutorials folder:
//   node tests/identity.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { check, skip, summary, run, get, sleep, find, yamlDocs } = require('./lib.js');

const T = path.join(__dirname, '..');
const PAGE = path.join(T, 'docs', 'identity-and-access-tutorial.html');
const LAB = path.join(T, 'tools', 'identity-lab');
const read = (p) => fs.readFileSync(p, 'utf8');

// ---- the page is the build of its sources
function parity() {
  const before = fs.existsSync(PAGE) ? read(PAGE) : '';
  const steps = [['tools/identity-lab/build.js'], ['tools/sync-menu.js'], ['tools/sync-backup.js']];
  for (const s of steps) {
    const r = run(process.execPath, [path.join(T, ...s[0].split('/'))], { cwd: T });
    if (r.status !== 0) return check(false, 'the page builds from its sources', r.stderr);
  }
  check(read(PAGE) === before, 'the page in docs/ is the build of tools/identity-lab/ (run build.js, sync-menu.js and sync-backup.js after editing a source)');
  const html = read(PAGE);
  const missing = fs.readdirSync(path.join(LAB, 'body')).filter((f) => /\.html$/.test(f)).filter((f) => !html.includes(read(path.join(LAB, 'body', f)).replace(/\s+$/, '')));
  check(missing.length === 0, 'the page contains every lesson file in tools/identity-lab/body/', missing.join(', '));
  check(read(path.join(T, 'tools', 'pages.json')).includes('identity-and-access-tutorial.html'), 'the page is listed in tools/pages.json (the Tutorials menu)');
  return html;
}

// ---- structure of the lessons
function structure(html) {
  const secs = [...html.matchAll(/<section class="step" id="([^"]+)" data-step data-level="([^"]+)">([\s\S]*?)<\/section>/g)];
  check(secs.length > 0, `the page has lessons (${secs.length})`);
  const ids = secs.map((m) => m[1]);
  check(new Set(ids).size === ids.length, 'lesson ids are unique');
  const nums = secs.map((m) => (/<span class="num">(\d+)<\/span>/.exec(m[3]) || [])[1]);
  check(nums.every((n, i) => n === String(i).padStart(2, '0')), 'lessons are numbered 00, 01, 02 ... in order', nums.join(','));
  check(secs.every((m) => /<p class="goal">/.test(m[3])), 'every lesson has a goal line');
  check(secs.every((m) => /<div class="step-foot"><label class="done-toggle"(?: data-manual-tick)?><input type="checkbox" data-done>/.test(m[3])), 'every lesson ends with the "Mark this step as done" box');
  check(secs.every((m) => ['Start here', 'Easy', 'Intermediate', 'Advanced', 'Expert'].includes(m[2])), 'every lesson shows its level');
  const anchors = [...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
  const idsAll = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const bad = anchors.filter((a) => !idsAll.has(a));
  check(bad.length === 0, 'every in-page link points at an element that exists', bad.join(', '));
  check(!/<\/script/i.test(read(path.join(LAB, 'body', '00-overview.html')).replace(/<script type="application\/json">[\s\S]*?<\/script>/g, '')), 'lesson files contain no stray script tags');
  return secs;
}

// ---- the diagrams' data
function diagrams(html) {
  const figs = [...html.matchAll(/<figure class="anim"[^>]*>([\s\S]*?)<\/figure>/g)].map((m) => m[1]);
  check(figs.length > 0, `the page has animated diagrams (${figs.length})`);
  figs.forEach((f, i) => {
    const label = `diagram ${i + 1}`;
    const j = /<script type="application\/json">([\s\S]*?)<\/script>/.exec(f);
    let frames; try { frames = JSON.parse(j[1]); } catch (e) { return check(false, `${label}: the steps are valid JSON`, e.message); }
    const keys = new Set([...f.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]));
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(f);
    const W = +vb[1], H = +vb[2];
    const unknown = [];
    frames.forEach((fr, n) => ['on', 'off', 'good', 'bad'].forEach((k) => (fr[k] || '').split(/\s+/).filter(Boolean).forEach((x) => { if (!keys.has(x)) unknown.push(`frame ${n + 1} ${k}: ${x}`); })));
    check(unknown.length === 0, `${label}: every part a step names exists in the drawing`, unknown.join('; '));
    const off = frames.flatMap((fr) => fr.path || []).filter(([x, y]) => x < 0 || y < 0 || x > W || y > H);
    check(off.length === 0, `${label}: every packet path stays inside the drawing`);
    check(frames.every((fr) => fr.text && fr.text.length < 330), `${label}: every step has a caption that is short enough to read`);
    check(/role="img" aria-label="[^"]{40,}"/.test(f), `${label}: the drawing has a text description for screen readers`);
  });
  return figs.length;
}

// ---- the cited standards are still what the ledger says
function ledger() {
  const L = JSON.parse(read(path.join(LAB, 'sources.json'))).entries;
  check(L.length > 0 && L.every((e) => e.id && e.claim && e.doc && e.section && e.url && /^\d{4}-\d\d-\d\d$/.test(e.checked)), `the source ledger is complete (${L.length} entries: claim, document, section, link, date checked)`);
  check(new Set(L.map((e) => e.id)).size === L.length, 'ledger ids are unique');
  const html = read(PAGE); const steps = [...html.matchAll(/<span class="num">(\d+)<\/span>/g)].map((m) => +m[1]).filter((n) => n > 0);
  const uncovered = steps.filter((n) => !L.some((e) => e.step === n));
  check(uncovered.length === 0, 'every lesson has entries in the source ledger', 'no entries for step(s) ' + uncovered.join(', '));
  const rfcs = [...new Set(L.filter((e) => e.rfc).map((e) => e.rfc))];
  const probe = run('curl', ['-s', '-m', '15', '-o', os.devNull, '-w', '%{http_code}', 'https://www.rfc-editor.org/rfc/rfc9110.json']);
  if (probe.stdout.trim() !== '200') return skip('the RFC Editor could not be reached: the ledger was not checked against it');
  for (const n of rfcs) {
    const r = run('curl', ['-s', '-m', '30', `https://www.rfc-editor.org/rfc/rfc${n}.json`]);
    let d; try { d = JSON.parse(r.stdout); } catch (e) { check(false, `RFC ${n} can be read from the RFC Editor`); continue; }
    const want = L.filter((e) => e.rfc === n).map((e) => e.status);
    check(want.every((s) => s === d.status), `RFC ${n} still has status ${want[0]}`, `now ${d.status}`);
    check(!(d.obsoleted_by || []).length, `RFC ${n} has not been obsoleted`, `obsoleted by ${(d.obsoleted_by || []).join(', ')}`);
  }
}

// ---- in a browser
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function browserTests() {
  let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { return skip('playwright-core is not installed: the page was not opened in a browser'); }
  const port = await freePort();
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ia-')), 'test.db');
  const srv = spawn(process.execPath, [path.join(T, 'server.js')], { cwd: T, env: { ...process.env, PORT: String(port), TUTORIAL_DB: db }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 40; i++) { if ((await get(`http://localhost:${port}/api/status`)).status === 200) break; await sleep(150); }
    try { browser = await chromium.launch(); } catch (e) { return skip('no Chromium could be started: ' + String(e.message).split('\n')[0]); }
    const base = `http://localhost:${port}/identity-and-access-tutorial.html`;
    for (const [w, h] of [[390, 844], [768, 900], [1280, 900]]) {
      const pg = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
      const errs = [], external = [];
      pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      pg.on('pageerror', (e) => errs.push(String(e)));
      pg.on('request', (r) => { const u = new URL(r.url()); if (!/^(localhost|127\.0\.0\.1|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname) && !/^(data|blob|about):$/.test(u.protocol)) external.push(r.url()); });   // the shared page template loads its fonts from Google Fonts
      await pg.goto(base); await pg.waitForTimeout(500);
      check(await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `no sideways page scroll at ${w}px`);
      check(errs.length === 0, `no console errors at ${w}px`, errs.join(' | '));
      check(external.length === 0, `the page sends nothing to another site (only the template's fonts load) at ${w}px`, external.join(' '));
      if (w === 1280) await figures(pg);
      await pg.context().close();
    }
    await toolsInBrowser(browser, base);
    await attacksInBrowser(browser, base);
    // dark mode: text must stay readable (contrast of body text against the page background)
    const dark = await (await browser.newContext({ colorScheme: 'dark' })).newPage();
    await dark.goto(base); await dark.waitForTimeout(300);
    const ratio = await dark.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const fg = lum(getComputedStyle(document.querySelector('.step p')).color), bg = lum(getComputedStyle(document.body).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    check(ratio >= 4.5, 'body text has enough contrast in dark mode', `ratio ${ratio.toFixed(1)}`);
    // the Tutorials menu: grouped, and scrollable when the window is too short to show it all
    const short = await (await browser.newContext({ viewport: { width: 1280, height: 320 } })).newPage();
    await short.goto(base); await short.waitForSelector('#tmenu-btn'); await short.click('#tmenu-btn');
    const menu = await short.evaluate(() => { const l = document.getElementById('tmenu-list'); const cs = getComputedStyle(l); return { groups: l.querySelectorAll('.tmenu-group').length, rows: l.querySelectorAll('a').length, scrolls: l.scrollHeight > l.clientHeight && /auto|scroll/.test(cs.overflowY), fits: l.getBoundingClientRect().bottom <= innerHeight }; });
    check(menu.groups >= 2 && menu.rows >= 9, `the Tutorials menu is grouped (${menu.groups} groups, ${menu.rows} rows)`);
    check(menu.scrolls && menu.fits, 'in a short window the Tutorials menu stays on screen and scrolls');
  } finally { if (browser) await browser.close(); srv.kill(); }
}

// the attack labs in a real browser: do one by hand, and let Show answer do another
async function attacksInBrowser(browser, base) {
  const pg = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/fonts\./.test(m.text())) errs.push(m.text()); });
  await pg.goto(base); await pg.waitForSelector('#rail-list li');
  await pg.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ia-')) localStorage.removeItem(k); });
  await pg.reload(); await pg.waitForSelector('#rail-list li');
  const lab = pg.locator('[data-ex="j10-none"]');
  await lab.scrollIntoViewIfNeeded();
  await pg.waitForFunction(() => (document.querySelector('[data-ex="j10-none"] .atk-held') || {}).value, null, { timeout: 15000 });
  // by hand: alg none, role admin, no signature
  const payload = JSON.parse(await lab.locator('.atk-p').inputValue()); payload.role = 'admin';
  await lab.locator('.atk-h').fill('{"alg":"none","typ":"JWT"}');
  await lab.locator('.atk-p').fill(JSON.stringify(payload));
  await lab.locator('.atk-mode').selectOption('none');
  await lab.getByRole('button', { name: 'Build the token' }).click();
  await lab.getByRole('button', { name: 'Send to the API' }).click();
  await pg.waitForFunction(() => /The attack worked/.test(document.querySelector('[data-ex="j10-none"] .atk-out').textContent), null, { timeout: 8000 });
  check(true, 'attack lab: a token with alg none and role admin is accepted by the flawed API');
  check(await lab.getByRole('button', { name: /Apply the fix/ }).isEnabled(), 'attack lab: the fix button opens once the attack has worked');
  await lab.getByRole('button', { name: /Apply the fix/ }).click();
  await pg.waitForFunction(() => /The same token no longer works/.test(document.querySelector('[data-ex="j10-none"] .atk-out').textContent), null, { timeout: 8000 });
  await pg.waitForFunction(() => document.querySelector('[data-ex="j10-none"]').classList.contains('ok'), null, { timeout: 8000 });
  check(true, 'attack lab: after the fix the same token is refused, and the exercise passes');
  // Show answer for the others
  for (const id of ['j10-confusion', 'j10-weak', 'j10-noverify', 'j10-noaud', 'j10-noexp']) {
    const l = pg.locator(`[data-ex="${id}"]`); await l.scrollIntoViewIfNeeded();
    await pg.waitForFunction((i) => (document.querySelector(`[data-ex="${i}"] .atk-held`) || {}).value, id, { timeout: 15000 });
    await l.locator(':scope > .lab-bar').getByRole('button', { name: 'Show answer' }).click();
    const ok = await pg.waitForFunction((i) => document.querySelector(`[data-ex="${i}"]`).classList.contains('ok'), id, { timeout: 15000 }).then(() => true, () => false);
    check(ok, `attack lab ${id}: Show answer performs the attack and the fix, and the exercise passes`);
  }
  check(errs.length === 0, 'no console errors while using the attack labs', errs.join(' | '));
  await pg.context().close();
}

// Step through every frame of every diagram: each text must sit inside its own box and not overlap another text.
async function figures(pg) {
  const n = await pg.locator('figure.anim').count();
  for (let i = 0; i < n; i++) {
    const fig = pg.locator('figure.anim').nth(i);
    await fig.scrollIntoViewIfNeeded();
    const count = await fig.evaluate((f) => JSON.parse(f.querySelector('script[type="application/json"]').textContent).length);
    const bad = [];
    for (let k = 0; k < count; k++) {
      await pg.waitForTimeout(550);
      const res = await fig.evaluate((f) => {
        const out = [];
        const texts = [...f.querySelectorAll('svg text')].filter((t) => parseFloat(getComputedStyle(t.closest('[data-k]') || t).opacity) > 0.05 && (!t.closest('.off')));
        const boxes = texts.map((t) => { const b = t.getBBox(); return { t, x: b.x, y: b.y, w: b.width, h: b.height, s: t.textContent.trim().slice(0, 40) }; });
        boxes.forEach((b) => {
          const g = b.t.closest('.a-node');
          const r = g && g.querySelector('rect');
          if (r) { const rx = +r.getAttribute('x'), ry = +r.getAttribute('y'), rw = +r.getAttribute('width'), rh = +r.getAttribute('height');
            if (b.x < rx + 2 || b.x + b.w > rx + rw - 2 || b.y < ry || b.y + b.h > ry + rh) out.push(`"${b.s}" does not fit its box`); }
        });
        for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) {
          const p = boxes[a], q = boxes[c];
          if (p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1) out.push(`"${p.s}" overlaps "${q.s}"`);
        }
        return out;
      });
      bad.push(...res.map((m) => `frame ${k + 1}: ${m}`));
      await fig.locator('[data-act=next]').click();
    }
    check(bad.length === 0, `diagram ${i + 1}: in all ${count} frames every text fits its box and overlaps no other text`, [...new Set(bad)].join('\n'));
  }
}


// ---- the crypto code gives the answers the standards publish, and agrees with Node's own crypto
async function cryptoTests() {
  const C = require(path.join(LAB, 'crypto.js'));
  const nodeCrypto = require('node:crypto');
  // RFC 7515 appendix A.1 (HS256) with the key from the same appendix
  const jwsKey = { kty: 'oct', k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow' };
  const jws = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  let r = await C.verify(jws, { algorithms: ['HS256'], key: jwsKey, now: 1300819000 });
  check(r.ok && r.parsed.payload.iss === 'joe', 'RFC 7515 A.1: the example HS256 JWS verifies, and decodes to iss=joe');
  r = await C.verify(jws, { algorithms: ['HS256'], key: jwsKey, now: 1300819381 });
  check(!r.ok && r.checks.find((c) => c.name === 'Not expired').ok === false, 'RFC 7515 A.1: the same token is rejected after its exp');
  r = await C.verify(jws.slice(0, -2) + 'AA', { algorithms: ['HS256'], key: jwsKey, now: 1300819000 });
  check(!r.ok && !r.checks.find((c) => c.name === 'Signature is valid').ok, 'a token with a changed signature is rejected');
  r = await C.verify(jws, { algorithms: ['RS256'], key: jwsKey, now: 1300819000 });
  check(!r.ok && !r.checks.find((c) => c.name.startsWith('Algorithm')).ok, 'a verifier whose allow-list does not name the token\'s algorithm rejects it');
  const none = await C.sign({ alg: 'none', typ: 'JWT' }, { sub: 'x' });
  r = await C.verify(none, { algorithms: ['HS256'], key: jwsKey });
  check(!r.ok, 'alg=none is rejected when it is not on the allow-list');
  // RFC 7636 appendix B
  const vbytes = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
  const ver = C.b64uEnc(Uint8Array.from(vbytes));
  check(ver === 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'RFC 7636 B: the 32 octets encode to the published code_verifier');
  const chBytes = [19, 211, 30, 150, 26, 26, 216, 236, 47, 22, 177, 12, 76, 152, 46, 8, 118, 168, 120, 173, 109, 241, 68, 86, 110, 225, 137, 74, 203, 112, 249, 195];
  check(await C.pkceChallenge(ver) === C.b64uEnc(Uint8Array.from(chBytes)) && await C.pkceChallenge(ver) === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'RFC 7636 B: the S256 challenge is the published value');
  check(C.pkceVerifier().length === 43, 'a generated PKCE verifier is 43 characters (32 random octets)');
  // RFC 7638
  const rsa = { kty: 'RSA', n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw', e: 'AQAB', alg: 'RS256', kid: '2011-04-29' };
  check(await C.thumbprint(rsa) === 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs', 'RFC 7638: the example key\'s thumbprint is the published value');
  // RFC 6238 appendix B
  const s1 = C.utf8('12345678901234567890'), s256 = C.utf8('12345678901234567890123456789012'), s512 = C.utf8('1234567890123456789012345678901234567890123456789012345678901234');
  const rows = [[59, s1, 'SHA-1', '94287082'], [1111111109, s1, 'SHA-1', '07081804'], [20000000000, s1, 'SHA-1', '65353130'], [59, s256, 'SHA-256', '46119246'], [1111111109, s256, 'SHA-256', '68084774'], [59, s512, 'SHA-512', '90693936'], [1111111109, s512, 'SHA-512', '25091201']];
  let ok = true; for (const [t, sec, alg, want] of rows) if (await C.totp(sec, t, { digits: 8, alg }) !== want) ok = false;
  check(ok, `RFC 6238 appendix B: ${rows.length} published TOTP values are reproduced (SHA-1, SHA-256, SHA-512)`);
  check(C.hexEnc(C.b32Dec('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')) === C.hexEnc(s1), 'base32 decodes the usual authenticator secret form');
  // strict base64url
  let bad = 0; for (const x of ['a+b', 'a/b', 'abc=', 'a', 'a b']) { try { C.b64uDec(x); } catch (e) { bad++; } }
  check(bad === 5, 'base64url decoding rejects +, /, padding, impossible lengths and spaces');
  // agreement with Node: sign here, verify there, and the other way round
  for (const alg of ['RS256', 'PS256', 'ES256', 'ES384', 'Ed25519']) {
    const kp = await C.generateKeyPair(alg);
    const tok = await C.sign({ alg, typ: 'JWT', kid: 'k1' }, { sub: 'alice', n: 1 }, kp.privateJwk);
    const [h, p, sig] = tok.split('.');
    const pub = nodeCrypto.createPublicKey({ key: kp.publicJwk, format: 'jwk' });
    const input = Buffer.from(h + '.' + p);
    const a = C.ALGS[alg];
    const opt = a.kty === 'RSA' && alg.startsWith('PS') ? { key: pub, padding: nodeCrypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: a.sign.saltLength } : a.kty === 'EC' ? { key: pub, dsaEncoding: 'ieee-p1363' } : { key: pub };
    const nodeOk = nodeCrypto.verify(a.hash ? a.hash.replace('-', '').toLowerCase() : null, input, opt, Buffer.from(sig, 'base64url'));
    const mine = await C.verify(tok, { algorithms: [alg], key: kp.publicJwk, issuer: undefined });
    check(nodeOk && mine.ok, `${alg}: a token signed here verifies in Node's crypto and in this code`);
    // and one signed by Node verifies here
    const priv = nodeCrypto.createPrivateKey({ key: kp.privateJwk, format: 'jwk' });
    const hdr = C.b64uEnc(C.utf8(JSON.stringify({ alg }))), pl = C.b64uEnc(C.utf8(JSON.stringify({ sub: 'bob' })));
    const sopt = a.kty === 'RSA' && alg.startsWith('PS') ? { key: priv, padding: nodeCrypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: a.sign.saltLength } : a.kty === 'EC' ? { key: priv, dsaEncoding: 'ieee-p1363' } : { key: priv };
    const nsig = nodeCrypto.sign(a.hash ? a.hash.replace('-', '').toLowerCase() : null, Buffer.from(hdr + '.' + pl), sopt);
    const theirs = await C.verify(hdr + '.' + pl + '.' + nsig.toString('base64url'), { algorithms: [alg], key: kp.publicJwk });
    check(theirs.ok, `${alg}: a token signed by Node's crypto verifies here`);
  }
}

// ---- the cookie model, the exercises, and the lessons' use of them
function cookieTests() {
  const K = require(path.join(LAB, 'cookie.js'));
  const base = { name: 'sid', sameSite: 'Lax', secure: true, httpOnly: true, domain: null, path: '/' };
  const S = (c, id) => K.sent(Object.assign({}, base, c), K.SCENARIOS.find((s) => s.id === id)).sent;
  // expected results written from the rules (RFC 6265bis 5.6.7, MDN Set-Cookie), one row per attribute setting
  const table = [
    [{ sameSite: 'Strict' }, { 'same-post': 1, 'same-sub': 0, link: 0, form: 0, img: 0, xfetch: 0, http: 0, 'other-path': 1 }],
    [{ sameSite: 'Lax' }, { 'same-post': 1, 'same-sub': 0, link: 1, form: 0, img: 0, xfetch: 0, http: 0, 'other-path': 1 }],
    [{ sameSite: 'None' }, { 'same-post': 1, 'same-sub': 0, link: 1, form: 1, img: 1, xfetch: 1, http: 0, 'other-path': 1 }],
    [{ sameSite: 'None', domain: 'example.com' }, { 'same-post': 1, 'same-sub': 1, link: 1, form: 1, img: 1, xfetch: 1, http: 0, 'other-path': 1 }],
    [{ sameSite: 'Lax', secure: false }, { 'same-post': 1, 'same-sub': 0, link: 1, form: 0, img: 0, xfetch: 0, http: 1, 'other-path': 1 }],
    [{ sameSite: 'Strict', path: '/api' }, { 'same-post': 1, 'same-sub': 0, link: 0, form: 0, img: 0, xfetch: 0, http: 0, 'other-path': 0 }],
  ];
  let bad = [];
  for (const [attrs, want] of table) for (const [id, w] of Object.entries(want)) if (S(attrs, id) !== !!w) bad.push(`${JSON.stringify(attrs)} ${id}`);
  check(bad.length === 0, `cookie model: ${table.length * 8} situations come out as the rules say`, bad.join('\n'));
  check(!K.accepted({ name: '__Host-sid', secure: true, domain: 'example.com', path: '/' }).ok && !K.accepted({ name: '__Host-sid', secure: false, domain: null, path: '/' }).ok && !K.accepted({ name: '__Host-sid', secure: true, domain: null, path: '/app' }).ok && K.accepted({ name: '__Host-sid', secure: true, domain: null, path: '/' }).ok, 'cookie model: a __Host- cookie needs Secure, no Domain and Path=/');
  check(S({ sameSite: '' }, 'form') === false && /not set/.test(K.sent(Object.assign({}, base, { sameSite: '' }), K.SCENARIOS.find((s) => s.id === 'form')).why), 'cookie model: with no SameSite the model treats it as Lax, and says browsers differ');
}

// Load the exercises exactly as the page has them and prove every one can be passed and can be failed.
function exerciseTests(html) {
  const E = require(path.join(LAB, 'engine.js'));
  const reg = loadExercises().exercises;
  const ids = Object.keys(reg);
  check(ids.length > 0, `the exercises load (${ids.length})`);
  const used = [...html.matchAll(/data-ex="([^"]+)"/g)].map((m) => m[1]);
  const usedCmd = [...html.matchAll(/data-cmd="([^"]+)"/g)].map((m) => m[1]), usedUrl = [...html.matchAll(/data-url="([^"]+)"/g)].map((m) => m[1]);
  { const IA = loadExercises(); const miss = [...usedCmd.filter((c) => !IA.cmds[c]), ...usedUrl.filter((u) => !IA.urls[u])]; check(miss.length === 0, 'every command and URL drill a lesson shows exists', miss.join(', ')); const unused = [...Object.keys(IA.cmds).filter((c) => !usedCmd.includes(c)), ...Object.keys(IA.urls).filter((u) => !usedUrl.includes(u))]; check(unused.length === 0, 'every command and URL drill is used by a lesson', unused.join(', ')); }
  check(used.every((u) => reg[u]), 'every exercise a lesson shows exists', used.filter((u) => !reg[u]).join(', '));
  check(ids.every((i) => used.includes(i)), 'every exercise is used by a lesson', ids.filter((i) => !used.includes(i)).join(', '));
  check(new Set(used).size === used.length, 'no exercise is shown twice');
  const broken = [];
  for (const id of ids) {
    const ex = reg[id];
    try {
      if (!E.judge(ex, E.solution(ex)).ok) broken.push(id + ': solution rejected');
      if (E.judge(ex, E.wrongAnswer(ex)).ok) broken.push(id + ': a wrong answer is accepted');
      const walk = (e) => (e.kind === 'quiz' ? [e] : e.kind === 'inspect' ? e.parts : []);
      for (const q of walk(ex)) { if (!q.options.some((o) => o.ok)) broken.push(id + ': no correct option'); if (q.options.some((o) => !o.ok && !o.why)) broken.push(id + ': a wrong option has no reason'); }
      if (ex.kind === 'sort' && ex.items.some((it) => !it.why)) broken.push(id + ': an item has no reason');
    } catch (e) { broken.push(id + ': ' + e.message); }
  }
  check(broken.length === 0, 'every exercise: the solution passes, a wrong answer fails, and wrong options say why', broken.join('\n'));
  // a quiz must not give itself away: its right answers should not all be the longest option
  const quizzes = ids.filter((i) => reg[i].kind === 'quiz' && reg[i].options.length >= 3);
  const longest = quizzes.filter((i) => { const o = reg[i].options; const lens = o.map((x) => x.t.length); const max = Math.max(...lens); return o.filter((x) => x.ok).every((x) => x.t.length === max); });
  check(longest.length <= Math.ceil(quizzes.length * 0.6), 'the right answer is not always the longest option', `${longest.length} of ${quizzes.length} quizzes`);
}

// ---- the command drills: the answer is accepted, broken versions are not, and the answer really runs
function loadExercises() {
  const IA = { exercises: {}, cmds: {}, urls: {}, cmdFlags: JSON.parse(read(path.join(LAB, 'vendor', 'cmd-flags.json'))) };
  const win = { IA, IACmdSpec: require(path.join(LAB, 'cmdspec.js')) };
  // run each exercise file in this realm (a separate vm context would make its regular expressions foreign objects)
  for (const f of fs.readdirSync(path.join(LAB, 'exercises')).filter((n) => /\.js$/.test(n)).sort()) new Function('window', read(path.join(LAB, 'exercises', f)))(win);
  return IA;
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function codeBlock(html, caption) {
  const m = new RegExp('<figcaption>' + caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</figcaption><pre><code>([\\s\\S]*?)</code></pre>').exec(html);
  return m ? unesc(m[1]) : null;
}
function drillJudgeTests() {
  const J = require(path.join(T, 'tools', 'shared', 'cmdline.js'));
  const IA = loadExercises();
  const ids = Object.keys(IA.cmds);
  check(ids.length >= 20, `command drills load (${ids.length})`);
  const bad = [];
  for (const id of ids) {
    const d = IA.cmds[id], specs = Array.isArray(d.specs) ? d.specs : [d.specs];
    const r = J.judgeLine(d.answer, d.specs);
    if (!r.ok) { bad.push(`${id}: its own answer is rejected: ${r.problems.join(' ')}`); continue; }
    const words = J.shellSplit(d.answer).words;
    const join = (w) => w.map((x) => (/^[\w@%+=:,./-]+$/.test(x) ? x : `'${x.replace(/'/g, "'\\''")}'`)).join(' ');
    // wrong tool
    if (J.judgeLine(join(['wget', ...words.slice(1)]), d.specs).ok) bad.push(`${id}: accepted with the wrong tool`);
    // each required flag removed
    const spec = specs[0];
    for (const [name, def] of Object.entries(spec.flags)) {
      if (!def.required) continue;
      const i = words.findIndex((w) => w === name || (def.alias || []).includes(w));
      if (i < 0) continue;
      const cut = def.value === false ? 1 : 2;
      const w2 = words.slice(0, i).concat(words.slice(i + cut));
      if (J.judgeLine(join(w2), d.specs).ok) bad.push(`${id}: accepted without ${name}`);
    }
    // a plain wrong value for each flag that checks its value
    for (const [name, def] of Object.entries(spec.flags)) {
      if (!def.required || def.value === false || def.value === true || def.value === undefined) continue;
      const i = words.indexOf(name); if (i < 0) continue;
      const w2 = words.slice(); w2[i + 1] = 'wrong-value.xyz';
      if (J.judgeLine(join(w2), d.specs).ok) bad.push(`${id}: accepted a wrong value for ${name}`);
    }
    if (!d.prompt || !d.hints) bad.push(`${id}: missing prompt or hints`);
  }
  check(bad.length === 0, 'every drill: its answer is accepted, and the wrong tool, a missing required flag and a wrong value are rejected', bad.join('\n'));
}

function drillRunTests(html) {
  const IA = loadExercises();
  const have = (b) => run('sh', ['-c', 'command -v ' + b]).status === 0;
  if (!have('openssl') || !have('curl')) return skip('openssl or curl is not installed: the drill answers were not run');
  if (net.connect && require('node:child_process').spawnSync('sh', ['-c', 'ss -ltn 2>/dev/null | grep -q ":5443 "']).status === 0) return skip('port 5443 is already in use: the drill answers were not run');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-drill-'));
  const sh = (cmd, o = {}) => run('sh', ['-c', cmd], { cwd: dir, input: '', timeout: 30000, ...o });
  const fails = [];
  const exec = (id) => {
    const d = IA.cmds[id], r = sh(d.answer), out = (r.stdout || '') + (r.stderr || '');
    const rn = d.run || {};
    if (rn.noRun) return;
    if (rn.expectFail) { if (r.status === 0 || !rn.expectFail.test(out)) fails.push(`${id}: expected a failure matching ${rn.expectFail}, got exit ${r.status}: ${out.slice(0, 200)}`); return; }
    if (r.status !== 0) { fails.push(`${id}: exit ${r.status}: ${out.slice(0, 300)}`); return; }
    if (rn.expect && !rn.expect.test(out)) fails.push(`${id}: output does not match ${rn.expect}: ${out.slice(0, 300)}`);
  };
  const apiExt = codeBlock(html, 'api.ext'), clientExt = codeBlock(html, 'client.ext');
  if (!apiExt || !clientExt) { fails.push('the page does not contain api.ext and client.ext'); }
  const startServer = (cmd) => new Promise((resolve) => {
    const p = spawn('sh', ['-c', 'exec ' + cmd], { cwd: dir, stdio: 'ignore' });   // exec: killing p kills the server itself, not just the shell
    const t0 = Date.now();
    (function wait() { const s = net.connect(5443, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(p); }); s.on('error', () => { if (Date.now() - t0 > 8000) resolve(p); else setTimeout(wait, 150); }); })();
  });
  return (async () => {
    for (const id of ['t6-rootkey', 't6-rootcert', 't6-apikey', 't6-csr']) exec(id);
    fs.writeFileSync(path.join(dir, 'api.ext'), apiExt || '');
    for (const id of ['t6-sign', 't6-inspect', 't7-checkend']) exec(id);
    let srv = await startServer(IA.cmds['t6-serve'].answer);
    try {
      for (const id of ['t6-curl-fail', 't6-curl-ok', 't4-curlv', 't4-tls13', 't4-tls12', 't4-sclient', 't4-sni', 't5-text', 't5-dates', 't5-san', 't5-verify', 't5-showcerts']) exec(id);
    } finally { srv.kill(); }
    fs.writeFileSync(path.join(dir, 'client.ext'), clientExt || '');
    for (const id of ['t8-key', 't8-csr', 't8-sign']) exec(id);
    srv = await startServer('openssl s_server -accept 5443 -cert api.pem -key api.key -CAfile root.pem -Verify 1 -verify_return_error -www');
    try {
      for (const id of ['t8-curl', 't8-nocert']) exec(id);
      // a client certificate from some other CA is refused too
      sh('openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout other.key -out other.pem -subj /CN=other -days 5 -addext extendedKeyUsage=clientAuth');
      const wrong = sh('curl -sS --cacert root.pem --cert other.pem --key other.key https://localhost:5443/');
      if (wrong.status === 0) fails.push('a client certificate from another CA was accepted');
    } finally { srv.kill(); }
    check(fails.length === 0, 'the drills\' answers run for real with openssl and curl and give the output the page describes', fails.join('\n'));
    const ran = Object.keys(IA.cmds).filter((i) => !(IA.cmds[i].run || {}).noRun).length;
    check(ran >= 18, `${ran} drill answers were run`);
    // the message the lesson quotes
    const m = sh('curl --cacert root.pem https://127.0.0.2:5443/');
    fs.rmSync(dir, { recursive: true, force: true });
  })();
}

// ---- the Kubernetes manifests and the C# the lessons show
function manifestTests(html) {
  const kc = find('kubeconform');
  const files = { 'cluster-issuer.yaml': codeBlock(html, 'infra/cert-manager/cluster-issuer.yaml'), 'gateway.yaml': codeBlock(html, 'charts/todo/templates/gateway.yaml (the Gateway part)'), 'certificate.yaml': codeBlock(html, 'certificate.yaml (what cert-manager creates for you)') };
  check(Object.values(files).every(Boolean), 'the page shows the ClusterIssuer, Gateway and Certificate manifests');
  if (!kc) return skip('kubeconform is not installed: the manifests were not checked against their schemas');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-k8s-'));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c || '');
  const crds = 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json';
  const v = run(kc, ['-strict', '-summary', '-schema-location', 'default', '-schema-location', crds, ...Object.keys(files).map((n) => path.join(dir, n))]);
  const probe = /could not find schema|failed downloading|Retrieving|connection/i.test(v.stdout + v.stderr);
  if (v.status !== 0 && probe) skip('the CRD schemas could not be fetched: ' + (v.stdout + v.stderr).split('\n')[0]);
  else check(v.status === 0 && /Valid: 3/.test(v.stdout), 'ClusterIssuer, Gateway and Certificate are valid against the cert-manager and Gateway API schemas', v.stdout + v.stderr);
  // the Gateway has what cert-manager needs (docs: hostname, tls.mode Terminate, certificateRefs, issuer annotation)
  let docs; try { docs = yamlDocs(files['gateway.yaml']); } catch (e) { docs = null; }
  if (docs) {
    const g = docs[0], l = (g.spec.listeners || []).find((x) => x.protocol === 'HTTPS') || {};
    check(!!(g.metadata.annotations || {})['cert-manager.io/cluster-issuer'] && l.hostname && l.tls && l.tls.mode === 'Terminate' && l.tls.certificateRefs && l.tls.certificateRefs[0].name, 'the Gateway has the issuer annotation and an HTTPS listener with hostname, tls.mode Terminate and a certificateRefs Secret');
  } else skip('python yaml is not available: the Gateway fields were not inspected');
  fs.rmSync(dir, { recursive: true, force: true });
}

async function kestrelTests(html) {
  const dotnet = find('dotnet'), have = (b) => run('sh', ['-c', 'command -v ' + b]).status === 0;
  if (!dotnet || !have('openssl') || !have('curl')) return skip('dotnet, openssl or curl is missing: the Kestrel snippets were not built and run');
  const s6 = codeBlock(html, 'src/api/Program.cs (add)'), s8 = codeBlock(html, 'src/api/Program.cs (replace the Kestrel lines from step 06)');
  if (!s6 || !s8) return check(false, 'the page shows both Kestrel snippets');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-kestrel-'));
  const sh = (cmd, o = {}) => run('sh', ['-c', cmd], { cwd: dir, timeout: 240000, input: '', env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_ROOT: path.dirname(dotnet) }, ...o });
  const r0 = sh(`${dotnet} new web -n kapp -o app --no-restore`);
  if (r0.status !== 0) return skip('dotnet new web failed: ' + (r0.stderr || r0.stdout).slice(0, 120));
  const pkg = (codeBlock(html, 'bash: in src/api/') || '').match(/dotnet add package (\S+) --version (\S+)/);
  if (!pkg) return check(false, 'the page tells the reader to add the certificate authentication package, with a version');
  const ap = sh(`${dotnet} add app package ${pkg[1]} --version ${pkg[2]}`);
  if (ap.status !== 0) return check(false, 'the package named on the page can be added: ' + pkg[1] + ' ' + pkg[2], ap.stdout + ap.stderr);
  // PKI for the test
  const ssl = (a) => { const r = run('openssl', a, { cwd: dir }); if (r.status !== 0) throw new Error(r.stderr); };
  ssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '30', '-subj', '/CN=Lab Root', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  fs.writeFileSync(path.join(dir, 'api.ext'), codeBlock(html, 'api.ext')); fs.writeFileSync(path.join(dir, 'client.ext'), codeBlock(html, 'client.ext'));
  for (const [n, subj, ext] of [['api', '/CN=localhost', 'api.ext'], ['client', '/CN=todo-reporter', 'client.ext']]) {
    ssl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', n + '.key', '-out', n + '.csr', '-subj', subj]);
    ssl(['x509', '-req', '-in', n + '.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '30', '-extfile', ext, '-out', n + '.pem']);
  }
  const program = (kestrel, mtls) => `using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Authentication.Certificate;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.Server.Kestrel.Https;
var builder = WebApplication.CreateBuilder(args);
${kestrel}
${mtls ? '' : 'builder.Services.AddAuthentication().AddCookie(); builder.Services.AddAuthorization();'}
var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/", (HttpContext c) => "hello " + (c.User.Identity?.Name ?? "anonymous")).RequireAuthorization(${mtls ? '' : ''});
app.Run();
`;
  const results = [];
  for (const [label, snippet, mtls] of [['server certificate (step 06)', s6, false], ['client certificate (step 08)', s8, true]]) {
    fs.writeFileSync(path.join(dir, 'app', 'Program.cs'), program(snippet, mtls));
    const b = sh(`${dotnet} build app -c Release -warnaserror -nologo -v q`);
    if (b.status !== 0) { results.push(`${label}: build failed: ${(b.stdout + b.stderr).split('\n').filter((l) => /error/.test(l)).slice(0, 3).join(' | ')}`); continue; }
    const app = spawn('sh', ['-c', `exec ${dotnet} app/bin/Release/net10.0/kapp.dll`], { cwd: dir, stdio: 'ignore', env: { ...process.env, ASPNETCORE_URLS: '', DOTNET_ROOT: path.dirname(dotnet) } });
    try {
      let up = false; for (let i = 0; i < 60 && !up; i++) { up = run('curl', ['-s', '-o', os.devNull, '--cacert', path.join(dir, 'root.pem'), '--cert', path.join(dir, 'client.pem'), '--key', path.join(dir, 'client.key'), 'https://localhost:5443/'], { timeout: 5000 }).status !== 7; if (!up) await sleep(500); }
      const base = ['-sS', '--cacert', path.join(dir, 'root.pem')];
      const plain = run('curl', [...base, '-o', os.devNull, '-w', '%{http_code}', 'https://localhost:5443/']);
      const withCert = run('curl', [...base, '--cert', path.join(dir, 'client.pem'), '--key', path.join(dir, 'client.key'), '-w', ' [%{http_code}]', 'https://localhost:5443/']);
      if (!mtls) { if (!/^(401|302)$/.test(plain.stdout.trim())) results.push(`${label}: expected the server to answer over HTTPS (401 or 302), got "${plain.stdout}" ${plain.stderr.slice(0, 120)}`); }
      else {
        if (plain.status === 0) results.push(`${label}: a call with no client certificate was answered (${plain.stdout})`);
        if (!/todo-reporter/.test(withCert.stdout) || !/\[200\]/.test(withCert.stdout)) results.push(`${label}: with the certificate expected "hello …todo-reporter" [200], got ${withCert.stdout} ${withCert.stderr.slice(0, 160)}`);
      }
    } finally { app.kill(); await sleep(300); }
  }
  check(results.length === 0, 'the Kestrel snippets build with no warnings and behave as the lessons say (HTTPS served; a client certificate required and used as the identity)', results.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- the attack labs are solvable, and the fix really stops each attack
async function attackTests() {
  const A = require(path.join(LAB, 'attacklab.js')), C = require(path.join(LAB, 'crypto.js'));
  const env = await A.setup();
  const bad = [];
  for (const id of A.ORDER) {
    const held = env.tokens[id];
    // the token you hold is a normal user's: accepted, but not as admin (except the two labs that start from an admin token)
    const asHeld = await A.validate(id, env, held, false);
    const startsAdmin = ['no-audience', 'no-expiry'].includes(id);
    if (!startsAdmin && (!asHeld.accepted || asHeld.admin)) bad.push(`${id}: the held token should be accepted as a plain user, got accepted=${asHeld.accepted} admin=${asHeld.admin}`);
    // the forged token works on the flawed API, and not on the fixed one
    const forged = await A.forge(id, env);
    const flawed = await A.validate(id, env, forged, false), fixed = await A.validate(id, env, forged, true);
    if (!flawed.admin) bad.push(`${id}: the forgery does not work on the flawed API: ${flawed.steps.join(' | ')}`);
    if (fixed.accepted) bad.push(`${id}: the fixed API still accepts the forgery`);
    // the fixed API still accepts an honest token (for the labs where the honest token is for this API and not expired)
    if (!startsAdmin && id !== 'weak-secret') { const ok = await A.validate(id, env, held, true); if (!ok.accepted) bad.push(`${id}: the fixed API rejects an honest token: ${ok.steps.join(' | ')}`); }
    // a token with no changes made, signature garbage, is refused by the fixed API
    const garbled = held.slice(0, -4) + (held.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    if (id !== 'no-verify' && (await A.validate(id, env, garbled, true)).accepted) bad.push(`${id}: a token with a damaged signature was accepted by the fixed API`);
  }
  check(bad.length === 0, `all ${A.ORDER.length} attack labs: the forgery works on the flawed API and fails on the fixed one, and honest tokens still pass the fix`, bad.join('\n'));
  // the engine kind
  const E = require(path.join(LAB, 'engine.js'));
  const ex = { kind: 'attack', lab: 'alg-none' };
  check(E.judge(ex, E.solution(ex)).ok && !E.judge(ex, E.wrongAnswer(ex)).ok && !E.judge(ex, { worked: true }).ok, 'attack exercises need both the attack and the fix');
  // the header the lesson shows is the base64url of the JSON it claims
  check(C.b64uEnc(C.utf8('{"alg":"HS256","typ":"JWT"}')) === 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'the base64url header the lesson prints is right');
}

// facts an exercise states about a token are true of the token
function factTests() {
  const C = require(path.join(LAB, 'crypto.js'));
  const reg = loadExercises().exercises, bad = [];
  let n = 0;
  for (const [id, ex] of Object.entries(reg)) for (const f of ex.facts || []) {
    n++;
    const p = C.parse(f.token);
    const val = f.path === 'lifetime' ? p.payload.exp - p.payload.iat : f.path.split('.').reduce((o, k) => (o ? o[k] : undefined), p);
    if (val !== f.equals) bad.push(`${id}: ${f.path} is ${JSON.stringify(val)}, the exercise says ${JSON.stringify(f.equals)}`);
  }
  check(n > 0 && bad.length === 0, `the ${n} facts exercises state about tokens are true of the tokens`, bad.join('\n'));
}

// the URL drills: the answer is accepted and the typical mistakes are not
function urlDrillTests() {
  const F = require(path.join(LAB, 'flow.js'));
  const IA = loadExercises(), bad = [];
  for (const [id, d] of Object.entries(IA.urls)) {
    const ok = F.judgeUrl(d.answer, d.spec);
    if (!ok.ok) { bad.push(`${id}: its own answer is rejected: ${ok.problems.join(' ')}`); continue; }
    const u = new URL(d.answer);
    for (const k of Object.keys(d.spec.params)) { const v = new URL(d.answer); v.searchParams.delete(k); if (F.judgeUrl(v.toString(), d.spec).ok) bad.push(`${id}: accepted without ${k}`); }
    const w = new URL(d.answer); w.searchParams.set('code_challenge_method', 'plain'); if (d.spec.params.code_challenge_method && F.judgeUrl(w.toString(), d.spec).ok) bad.push(`${id}: accepted plain`);
    const e = new URL(d.answer); e.searchParams.set('code_verifier', 'x'); if (F.judgeUrl(e.toString(), d.spec).ok) bad.push(`${id}: accepted a code_verifier in the front channel`);
    if (F.judgeUrl(d.answer.replace('https://login.example.com', 'https://login.example.org'), d.spec).ok) bad.push(`${id}: accepted the wrong host`);
  }
  check(Object.keys(IA.urls).length > 0 && bad.length === 0, `${Object.keys(IA.urls).length} URL drill(s): the answer is accepted, and a missing parameter, plain, a verifier in the address and the wrong host are rejected`, bad.join('\n'));
}

// the flow data matches the RFCs, and every attack switch changes the outcome
async function flowTests() {
  const F = require(path.join(LAB, 'flow.js')), C = require(path.join(LAB, 'crypto.js'));
  const f = await F.build({});
  const a = f.auth, bad = [];
  for (const k of ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method']) if (!a[k]) bad.push('authorization request lacks ' + k);
  if (a.response_type !== 'code') bad.push('response_type is not code');
  if (a.code_challenge_method !== 'S256') bad.push('method is not S256');
  if (a.code_challenge !== await C.pkceChallenge(f.values.verifier)) bad.push('the challenge is not the SHA-256 of the verifier');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(f.values.verifier)) bad.push('the verifier is not 43 to 128 unreserved characters (RFC 7636 4.1)');
  const tokenStep = f.steps.find((s) => s.n === 6).http;
  for (const need of ['grant_type=authorization_code', 'code=', 'redirect_uri=', 'client_id=', 'code_verifier=' + f.values.verifier]) if (!tokenStep.includes(need)) bad.push('the token request lacks ' + need);
  if (tokenStep.includes('client_secret')) bad.push('the page example sends a client secret in the body');
  const authStep = f.steps.find((s) => s.n === 2).http;
  if (authStep.includes(f.values.verifier)) bad.push('the verifier appears in the front channel request');
  const off = await F.build({ pkce: false, state: false, iss: false });
  if (off.auth.code_challenge || off.auth.state) bad.push('switching protections off still sends them');
  if (!off.attacks.every((x) => x.on === false)) bad.push('attack switches do not follow the options');
  if (!f.attacks.every((x) => x.on === true)) bad.push('attack protections should be on by default');
  if (f.steps.some((s) => /access_token/.test(s.http) && s.channel === 'front')) bad.push('a token appears in a front channel message');
  check(bad.length === 0, 'the code flow data: required parameters present, S256 challenge is the hash of the verifier, tokens only on the back channel, and the attack switches follow the options', bad.join('\n'));
  // grant chooser
  const g = (o) => F.chooseGrant(o).grant;
  check(g({ hasUser: false }) === 'client_credentials' && g({ hasUser: true, device: 'full' }) === 'authorization_code' && g({ hasUser: true, device: 'limited' }) === 'device_code' && g({ hasUser: true, legacyPassword: true }) === 'authorization_code', 'the grant chooser: no user is client credentials, a person with a browser is code, a limited device is the device flow, and the password grant is never an answer');
}

// what the page says about Google matches Google's own live discovery document and keys endpoint
async function googleTests(html) {
  const have = run('curl', ['-s', '-m', '20', '-o', os.devNull, '-w', '%{http_code}', 'https://accounts.google.com/.well-known/openid-configuration']).stdout.trim() === '200';
  if (!have) return skip('Google could not be reached: the page was not compared with its discovery document');
  const d = JSON.parse(run('curl', ['-s', '-m', '20', 'https://accounts.google.com/.well-known/openid-configuration']).stdout);
  const bad = [];
  const claim = { issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs' };
  for (const [k, v] of Object.entries(claim)) { if (d[k] !== v) bad.push(`${k}: Google says ${d[k]}, the page says ${v}`); if (!html.includes(v)) bad.push(`the page does not contain ${v}`); }
  if (!(d.id_token_signing_alg_values_supported || []).includes('RS256')) bad.push('Google no longer lists RS256');
  if (!(d.code_challenge_methods_supported || []).includes('S256') || !(d.code_challenge_methods_supported || []).includes('plain')) bad.push('PKCE methods differ from the page: ' + JSON.stringify(d.code_challenge_methods_supported));
  const keys = JSON.parse(run('curl', ['-s', '-m', '20', claim.jwks_uri]).stdout);
  if (!Array.isArray(keys.keys) || !keys.keys.length || !keys.keys.every((k) => k.kty === 'RSA' && k.kid)) bad.push('the keys endpoint did not return a JWK set of RSA keys with kids');
  check(bad.length === 0, 'the Google endpoints, signing algorithm and PKCE methods the page states match Google\'s live discovery document, and its key endpoint returns a JWK set', bad.join('\n'));
  // the workbench's JWKS support picks a Google key by kid: verify a token we sign with a key set of the same shape
  const C = require(path.join(LAB, 'crypto.js'));
  const kp = await C.generateKeyPair('RS256');
  const tok = await C.sign({ alg: 'RS256', typ: 'JWT', kid: 'k2' }, { iss: claim.issuer, aud: 'x', exp: 4102444800 }, kp.privateJwk);
  const set = { keys: [Object.assign({}, kp.publicJwk, { kid: 'k1' }), Object.assign({}, kp.publicJwk, { kid: 'k2' })] };
  const pick = set.keys.find((k) => k.kid === C.parse(tok).header.kid);
  check(pick && (await C.verify(tok, { algorithms: ['RS256'], key: pick, issuer: claim.issuer, audience: 'x', now: 1700000000 })).ok, 'a token is verified with the key chosen by kid from a key set');
}

// ---- the certificate reader agrees with OpenSSL on certificates OpenSSL made
async function certTests() {
  const X = require(path.join(LAB, 'x509.js'));
  const ossl = run('openssl', ['version']);
  if (ossl.status !== 0) return skip('openssl is not installed: the certificate reader was not compared with it');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-cert-'));
  const sh = (args, opts = {}) => { const r = run('openssl', args, { cwd: dir, ...opts }); if (r.status !== 0) throw new Error('openssl ' + args.join(' ') + '\n' + r.stderr); return r.stdout; };
  const w = (n, c) => fs.writeFileSync(path.join(dir, n), c);
  // root (RSA 2048) -> intermediate (EC P-256) -> leaf (EC P-384, with names), plus others
  sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '3650', '-subj', '/C=ZA/O=Lab Trust/CN=Lab Root CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  sh(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'int.key']);
  sh(['req', '-new', '-key', 'int.key', '-out', 'int.csr', '-subj', '/C=ZA/O=Lab Trust/CN=Lab Issuing CA']);
  w('int.ext', 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n');
  sh(['x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'int.pem', '-days', '1825', '-extfile', 'int.ext']);
  sh(['ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', 'leaf.key']);
  sh(['req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=todo.lab.test']);
  w('leaf.ext', 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:todo.lab.test,DNS:*.apps.lab.test,IP:127.0.0.1\n');
  sh(['x509', '-req', '-in', 'leaf.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '90', '-extfile', 'leaf.ext']);
  sh(['req', '-x509', '-newkey', 'ed25519', '-nodes', '-keyout', 'ed.key', '-out', 'ed.pem', '-days', '30', '-subj', '/CN=ed.lab.test', '-addext', 'subjectAltName=DNS:ed.lab.test']);
  sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'pss.key', '-out', 'pss.pem', '-days', '30', '-subj', '/CN=pss.lab.test', '-sigopt', 'rsa_padding_mode:pss', '-sha256']);
  sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'old.key', '-out', 'old.pem', '-subj', '/CN=old.lab.test', '-not_before', '20200101000000Z', '-not_after', '20200201000000Z', '-addext', 'subjectAltName=DNS:old.lab.test']);
  const rd = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
  const stamp = (s) => new Date(s.trim().split('=')[1].replace(/ GMT$/, ' UTC'));
  // fields
  let ok = true, detail = [];
  for (const n of ['root', 'int', 'leaf', 'ed', 'pss', 'old']) {
    const c = X.parseAll(rd(n + '.pem')).certs[0];
    const serial = sh(['x509', '-in', n + '.pem', '-noout', '-serial']).trim().split('=')[1].toLowerCase().replace(/^0+(?=.)/, '');
    const subj = sh(['x509', '-in', n + '.pem', '-noout', '-subject', '-nameopt', 'oneline,-esc_msb']).trim().replace(/^subject=\s*/, '').replace(/ = /g, '=').replace(/ \/ /g, ', ');
    const nb = stamp(sh(['x509', '-in', n + '.pem', '-noout', '-startdate'])), na = stamp(sh(['x509', '-in', n + '.pem', '-noout', '-enddate']));
    if (c.serial.replace(/^0+(?=.)/, '') !== serial) { ok = false; detail.push(`${n}: serial ${c.serial} vs ${serial}`); }
    if (c.subject.text.replace(/ = /g, '=') !== subj.replace(/^subject= */, '')) { ok = false; detail.push(`${n}: subject "${c.subject.text}" vs "${subj}"`); }
    if (+c.notBefore !== +nb || +c.notAfter !== +na) { ok = false; detail.push(`${n}: dates ${c.notBefore.toISOString()}..${c.notAfter.toISOString()} vs ${nb.toISOString()}..${na.toISOString()}`); }
  }
  check(ok, 'serial, subject and validity dates of 6 generated certificates equal what openssl x509 prints', detail.join('\n'));
  const leaf = X.parseAll(rd('leaf.pem')).certs[0];
  check(leaf.san.dns.join(',') === 'todo.lab.test,*.apps.lab.test' && leaf.san.ip.join(',') === '127.0.0.1', 'subject alternative names (DNS and IP) are read');
  check(leaf.basicConstraints && leaf.basicConstraints.ca === false && leaf.keyUsage.join() === 'digitalSignature' && leaf.extKeyUsage.join() === 'serverAuth', 'basic constraints, key usage and extended key usage are read');
  const root = X.parseAll(rd('root.pem')).certs[0], inter = X.parseAll(rd('int.pem')).certs[0];
  check(root.basicConstraints.ca && root.keyUsage.includes('keyCertSign') && root.publicKey.type === 'RSA' && root.publicKey.bits === 2048 && root.selfIssued, 'a root: CA:TRUE, keyCertSign, RSA 2048, self-issued');
  check(inter.publicKey.curve === 'P-256' && inter.basicConstraints.pathLen === 0 && leaf.publicKey.curve === 'P-384', 'EC curves and a path length constraint are read');
  const ed = X.parseAll(rd('ed.pem')).certs[0];
  check(ed.publicKey.type === 'Ed25519' && ed.signatureAlgorithm.name === 'Ed25519', 'an Ed25519 certificate is read');
  check(root.subjectKeyId && inter.authorityKeyId === root.subjectKeyId && leaf.authorityKeyId === inter.subjectKeyId, 'authority and subject key identifiers link each certificate to its issuer');
  // signatures: every self-signed certificate verifies against itself, and the chain verifies link by link
  const self = [];
  for (const n of ['root', 'ed', 'pss', 'old']) { const c = X.parseAll(rd(n + '.pem')).certs[0]; const r = await X.verifySignature(c, c); self.push(n + (r.ok ? '' : ' FAILED: ' + r.reason)); }
  check(self.every((s) => !/FAILED/.test(s)), 'self-signatures verify: RSA PKCS#1, RSA-PSS and Ed25519', self.join('; '));
  const all = X.parseAll(rd('leaf.pem') + rd('int.pem') + rd('root.pem')).certs;
  const good = await X.checkChain(all, { host: 'todo.lab.test', now: new Date() });
  check(good.ok && good.chain.length === 3 && good.steps.map((s) => s.role).join() === 'leaf,intermediate,root', 'a complete chain (RSA root, EC intermediate, EC leaf) is ordered and verifies', JSON.stringify(good.problems));
  const shuffled = await X.checkChain([all[2], all[0], all[1]], { host: 'todo.lab.test' });
  check(shuffled.ok && shuffled.chain[0].subject.text === 'CN=todo.lab.test', 'the same certificates in any order give the same chain');
  // what openssl verify says must be what we say
  const osslGood = run('openssl', ['verify', '-CAfile', 'root.pem', '-untrusted', 'int.pem', 'leaf.pem'], { cwd: dir });
  const osslMissing = run('openssl', ['verify', '-CAfile', 'root.pem', 'leaf.pem'], { cwd: dir });
  const missing = await X.checkChain(X.parseAll(rd('leaf.pem')).certs, { host: 'todo.lab.test', trusted: [root] });
  check(osslGood.status === 0 && good.ok && osslMissing.status !== 0 && !missing.ok, 'chain verdicts agree with openssl verify: complete passes, a missing intermediate fails', osslMissing.stdout + osslMissing.stderr);
  check(missing.problems.some((p) => /not in what was supplied/.test(p.text)), 'a missing intermediate is explained in words');
  const wrongName = await X.checkChain(all, { host: 'other.lab.test' });
  check(!wrongName.ok && wrongName.problems.some((p) => /does not match other\.lab\.test/.test(p.text)), 'a wrong host name is reported');
  const expired = await X.checkChain(X.parseAll(rd('old.pem')).certs, { host: 'old.lab.test', now: new Date() });
  check(expired.problems.some((p) => /has expired/.test(p.text)), 'an expired certificate is reported');
  const tampered = X.parseAll(rd('leaf.pem') + rd('int.pem') + rd('root.pem')).certs;
  const t = tampered[0]; const tb = new Uint8Array(t.tbsDer); tb[tb.length - 5] ^= 1; t.tbsDer = tb;
  const tr = await X.verifySignature(t, tampered[1]);
  check(!tr.ok, 'a certificate whose content was changed fails its signature check');
  // host names: RFC 9525 rules
  const m = (h) => X.matchHost(leaf, h).ok;
  check(m('todo.lab.test') && m('TODO.LAB.TEST') && m('shop.apps.lab.test') && m('127.0.0.1') && !m('a.b.apps.lab.test') && !m('apps.lab.test') && !m('lab.test') && !m('127.0.0.2') && !m('evil.todo.lab.test'), 'host name matching: exact, case-insensitive, a wildcard covers exactly one label, IP addresses use IP names');
  const noSan = X.parseAll(rd('pss.pem')).certs[0];
  check(!X.matchHost(noSan, 'pss.lab.test').ok, 'a certificate with only a common name matches no host (RFC 9525 does not use the common name)');
  // PEM handling
  const two = X.pemBlocks(rd('int.pem') + '\n# text between\n' + rd('root.pem'));
  check(two.length === 2 && X.toPem(two[0].der) === rd('int.pem'), 'PEM in and out is exact, and text between blocks is ignored');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- the exercise engine: every kind accepts its solution, rejects a wrong answer, and says why
function engineTests() {
  const E = require(path.join(LAB, 'engine.js'));
  const sample = {
    quiz: { kind: 'quiz', prompt: 'q', options: [{ t: 'a', ok: false, why: 'no' }, { t: 'b', ok: true, why: 'yes' }, { t: 'c', ok: false }] },
    multi: { kind: 'quiz', multi: true, prompt: 'q', options: [{ t: 'a', ok: true }, { t: 'b', ok: true }, { t: 'c', ok: false }] },
    order: { kind: 'order', prompt: 'q', items: ['one', 'two', 'three'] },
    sort: { kind: 'sort', prompt: 'q', groups: ['x', 'y'], items: [{ t: 'a', g: 0 }, { t: 'b', g: 1 }, { t: 'c', g: 1 }] },
    inspect: { kind: 'inspect', prompt: 'q', artifact: 'text', parts: [{ kind: 'quiz', prompt: 'p', options: [{ t: 'a', ok: true }, { t: 'b', ok: false }] }, { kind: 'quiz', prompt: 'p', options: [{ t: 'a', ok: false }, { t: 'b', ok: true }] }] },
  };
  for (const [name, ex] of Object.entries(sample)) {
    check(E.judge(ex, E.solution(ex)).ok === true, `engine: the solution of a ${name} exercise is accepted`);
    check(E.judge(ex, E.wrongAnswer(ex)).ok === false, `engine: a wrong answer to a ${name} exercise is rejected`);
  }
  check(E.judge(sample.quiz, []).empty === true, 'engine: no answer is asked for, not marked wrong');
  check(E.judge(sample.quiz, [0]).items[0].why === 'no', 'engine: each option carries its reason');
  check(E.judge(sample.multi, [0]).ok === false && E.judge(sample.multi, [0, 1, 2]).ok === false, 'engine: a multiple-answer quiz needs exactly the right set');
  check(E.judge(sample.order, [0, 0, 1]).ok === false, 'engine: an order answer that repeats an item is rejected');
}

// exercises and tools, in a real browser
async function toolsInBrowser(browser, base) {
  const pg = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/fonts\./.test(m.text())) errs.push(m.text()); });
  await pg.goto(base); await pg.waitForSelector('#rail-list li');
  // one exercise of each kind, added to step 00
  await pg.evaluate(() => {
    IA.exercises['t-quiz'] = { kind: 'quiz', prompt: '<p>Which status code means "I do not know who you are"?</p>', options: [{ t: '<code>403</code>', ok: false, why: 'That is "I know you, and no".' }, { t: '<code>401</code>', ok: true, why: 'Yes: no valid credentials.' }, { t: '<code>404</code>', ok: false, why: 'That is "not found".' }], hints: ['Think about who is missing.'] };
    IA.exercises['t-order'] = { kind: 'order', prompt: '<p>Order the steps.</p>', items: ['Browser asks for the page', 'Server redirects to the login', 'User signs in', 'Server sets the cookie'] };
    IA.exercises['t-sort'] = { kind: 'sort', prompt: '<p>Sort.</p>', groups: ['Authentication', 'Authorization'], items: [{ t: 'Check the password', g: 0 }, { t: 'Check the role', g: 1 }] };
    const sec = document.getElementById('overview');
    for (const id of ['t-quiz', 't-order', 't-sort']) { const d = document.createElement('div'); d.setAttribute('data-ex', id); sec.insertBefore(d, sec.querySelector('.step-foot')); IAUI.mountExercise(d); }
    IAUI.syncTicks();
  });
  const ex = (id) => pg.locator(`[data-ex="${id}"]`);
  await ex('t-quiz').locator('.ex-opt').nth(0).locator('input').check();
  await ex('t-quiz').getByRole('button', { name: 'Check' }).click();
  check(/Not that one/.test(await ex('t-quiz').locator('.ex-out').textContent()) && /I know you, and no/.test(await ex('t-quiz').locator('.ex-why').first().textContent()), 'exercise: a wrong choice is rejected and its reason is shown');
  await ex('t-quiz').getByRole('button', { name: 'Hint' }).click();
  check(/Think about/.test(await ex('t-quiz').locator('.lab-hint').textContent()), 'exercise: Hint shows a hint');
  await ex('t-quiz').locator('.ex-opt').nth(1).locator('input').check();
  await ex('t-quiz').getByRole('button', { name: 'Check' }).click();
  check(/Correct/.test(await ex('t-quiz').locator('.ex-out').textContent()) && await ex('t-quiz').evaluate((n) => n.classList.contains('ok')), 'exercise: the right choice passes');
  check(await pg.locator('#overview input[data-done]').isDisabled() && !(await pg.locator('#overview input[data-done]').isChecked()), 'the step is not ticked while an exercise in it is still open');
  await ex('t-order').getByRole('button', { name: 'Show answer' }).click();
  check(/Correct order/.test(await ex('t-order').locator('.ex-out').textContent()), 'exercise: Show answer fills in an order exercise correctly');
  await ex('t-sort').locator('select').nth(0).selectOption({ index: 1 }); await ex('t-sort').locator('select').nth(1).selectOption({ index: 1 });
  await ex('t-sort').getByRole('button', { name: 'Check' }).click();
  check(/1 of 2 are right/.test(await ex('t-sort').locator('.ex-out').textContent()), 'exercise: a half-right sort says how many are right');
  await ex('t-sort').getByRole('button', { name: 'Show answer' }).click();
  check(await pg.locator('#overview input[data-done]').isChecked(), 'the step ticks itself when every exercise in it is passed');
  const txt = await pg.textContent('#ia-progress');
  check(/Start here\s*3 \/ 3/.test(txt), 'the progress panel counts passed exercises per level', txt);
  await pg.reload(); await pg.waitForSelector('#rail-list li');
  check(await pg.evaluate(() => JSON.parse(localStorage.getItem('ia-ex:t-quiz')).ok === true), 'a passed exercise is remembered in the browser');
  await pg.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ia-ex:')) localStorage.removeItem(k); });

  // tools are mounted by data-tool; make one of each
  await pg.evaluate(() => {
    const sec = document.getElementById('overview');
    for (const t of ['jwt', 'cert', 'pkce', 'totp']) { const d = document.createElement('div'); d.setAttribute('data-tool', t); d.id = 'tool-' + t; sec.insertBefore(d, sec.querySelector('.step-foot')); IAUI.mountTool(d); }
  });
  // JWT workbench
  const jwt = pg.locator('#tool-jwt');
  await jwt.getByRole('button', { name: 'Make an example token' }).click();
  await pg.waitForTimeout(300);
  const dec = await jwt.locator('.tool-out').textContent();
  check(/alice/.test(dec) && /Issuer: who created and signed the token/.test(dec) && /Anyone who holds this token can read it/.test(dec), 'JWT workbench: decodes the claims, explains them and says the token is readable by anyone');
  await pg.waitForFunction(() => /An API would accept this token/.test(document.querySelector('#tool-jwt .v-out')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check(/An API would accept this token/.test(await jwt.locator('.v-out').textContent()), 'JWT workbench: the example token verifies with its secret');
  await jwt.locator('.v-aud').fill('some-other-api');
  await pg.waitForTimeout(300);
  check(/would reject/.test(await jwt.locator('.v-out').textContent()) && /Audience includes this API/.test(await jwt.locator('.v-out').textContent()), 'JWT workbench: a wrong audience is rejected');
  await jwt.locator('.v-aud').fill('todo-api');
  await jwt.locator('.v-alg').fill('RS256'); await pg.waitForTimeout(300);
  check(/would reject/.test(await jwt.locator('.v-out').textContent()), 'JWT workbench: an algorithm not on the allow-list is rejected');
  await jwt.locator('.v-alg').fill('HS256');
  await jwt.locator('.v-edit').fill('{"iss":"https://login.lab.test","sub":"mallory","aud":"todo-api"}');
  await jwt.getByRole('button', { name: 'Sign with the key above' }).click(); await pg.waitForTimeout(400);
  check(/mallory/.test(await jwt.locator('.tool-out').textContent()), 'JWT workbench: changing the payload and signing again gives a new token');
  const tokVal = await jwt.locator('textarea').first().inputValue();
  await jwt.locator('textarea').first().fill(tokVal.slice(0, -3) + (tokVal.endsWith('AAA') ? 'BBB' : 'AAA')); await pg.waitForTimeout(300);
  await jwt.locator('.v-key').fill('lab-secret-lab-secret-lab-secret-32'); await pg.waitForTimeout(300);
  check(/Signature is valid/.test(await jwt.locator('.v-out').textContent()) && /would reject/.test(await jwt.locator('.v-out').textContent()), 'JWT workbench: a tampered signature is caught');
  // certificate inspector, with certificates OpenSSL made
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-ui-'));
  const sh = (a) => { const r = run('openssl', a, { cwd: dir }); if (r.status !== 0) throw new Error(r.stderr); };
  sh(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '30', '-subj', '/CN=ui.lab.test', '-addext', 'subjectAltName=DNS:ui.lab.test']);
  const pem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8'), key = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8');
  const cert = pg.locator('#tool-cert');
  await cert.locator('textarea').fill(pem); await pg.waitForTimeout(400);
  const ct = await cert.locator('.tool-out').textContent();
  check(/ui\.lab\.test/.test(ct) && /Signed by itself/.test(ct) && /days left/.test(ct) && /chain is complete/.test(ct), 'certificate inspector: shows the fields, the signature check and the verdict');
  await cert.locator('input').fill('other.lab.test'); await pg.waitForTimeout(400);
  check(/does not match other\.lab\.test/.test(await cert.locator('.tool-out').textContent()), 'certificate inspector: a host name that is not covered is reported');
  await cert.locator('textarea').fill(key); await pg.waitForTimeout(300);
  check(/Never paste a private key/.test(await cert.locator('.tool-out').textContent()), 'certificate inspector: a pasted private key is refused with a warning');
  fs.rmSync(dir, { recursive: true, force: true });
  // PKCE helper
  const pk = pg.locator('#tool-pkce');
  await pk.locator('.p-ver').fill('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'); await pg.waitForTimeout(300);
  check(await pk.locator('.p-ch').inputValue() === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'PKCE helper: gives the RFC 7636 appendix B challenge');
  await pk.getByRole('button', { name: 'Make a random one' }).click(); await pg.waitForTimeout(300);
  check((await pk.locator('.p-ver').inputValue()).length === 43 && /valid code_verifier/.test(await pk.locator('.p-msg').textContent()), 'PKCE helper: a random verifier is 43 characters and valid');
  await pk.locator('.p-txt').fill('hello?>'); check(await pk.locator('.p-enc').inputValue() === 'aGVsbG8_Pg', 'PKCE helper: base64url uses - and _ and no padding');
  // TOTP
  check(/^\d{3} \d{3}$/.test((await pg.locator('#tool-totp .t-code').textContent()).trim()), 'TOTP demo: shows a six digit code');
  check(errs.length === 0, 'no console errors while using the exercises and tools', errs.join(' | '));
  await pg.context().close();
}

async function main() {
  const html = parity();
  if (typeof html === 'string') { structure(html); diagrams(html); exerciseTests(html); }
  cookieTests();
  ledger();
  engineTests();
  drillJudgeTests();
  await cryptoTests();
  await attackTests();
  urlDrillTests();
  await flowTests();
  await googleTests(typeof html === 'string' ? html : read(PAGE));
  factTests();
  await drillRunTests(typeof html === 'string' ? html : read(PAGE));
  manifestTests(typeof html === 'string' ? html : read(PAGE));
  await kestrelTests(typeof html === 'string' ? html : read(PAGE));
  await certTests();
  await browserTests();
  process.exit(summary());
}
main().catch((e) => { console.error(e); process.exit(1); });
