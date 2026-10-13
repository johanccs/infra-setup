// The Identity and Access Lab: the page matches its sources, every fact has a source in the ledger, the cited RFCs are
// still current, every diagram frame fits, and the page works in a browser. Run from the tutorials folder:
//   node tests/identity.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { check, skip, summary, run, get, sleep } = require('./lib.js');

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
  check(secs.every((m) => /<div class="step-foot"><label class="done-toggle"><input type="checkbox" data-done>/.test(m[3])), 'every lesson ends with the "Mark this step as done" box');
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

async function main() {
  const html = parity();
  if (typeof html === 'string') { structure(html); diagrams(html); }
  ledger();
  await cryptoTests();
  await browserTests();
  process.exit(summary());
}
main().catch((e) => { console.error(e); process.exit(1); });
