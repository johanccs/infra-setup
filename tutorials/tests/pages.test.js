// Browser and server tests for both tutorial pages, run against the real server.js with a fake OpenAI behind it.
//   node tests/pages.test.js
// Needs playwright-core and a Chromium it can launch (see tests/README.md).
'use strict';
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (e) { console.log('SKIP pages: playwright-core is not installed (see tests/README.md)'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const PORT = 8791, FAKE = 8792;
const BASE = `http://localhost:${PORT}`;
const PAGES = [
  { file: 'code-to-cluster-tutorial.html', name: 'Code to Cluster', steps: 17 },
  { file: 'todo-on-eks-tutorial.html', name: 'Todo on EKS', steps: 16 },
];

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

// ---- fake OpenAI: streams a canned answer; the last user message picks a failure mode ----
const seen = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    seen.push({ url: req.url, auth: req.headers.authorization, body: j });
    const last = (j.messages || []).slice(-1)[0] || {};
    const text = String(last.content || '');
    if (text.includes('FAIL429')) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"quota"}}'); }
    if (text.includes('FAIL401')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (text.includes('EMPTY')) return res.end('data: [DONE]\n\n');
    const parts = ['A **pod** is ', 'the smallest unit.\n\n', '- one\n- two\n\n', '```\nkubectl get pods\n```'];
    let i = 0;
    const t = setInterval(() => {
      if (i < parts.length) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] }) + '\n\n');
      else { clearInterval(t); res.end('data: [DONE]\n\n'); }
    }, 25);
  });
});

function startServer(env) {
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ...env }, stdio: 'pipe' });
  return new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { if (String(d).includes('Tutorials on')) resolve(p); });
    p.on('error', reject);
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });
}
function raw(opts, body) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, ...opts }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', (e) => resolve({ status: 0, body: String(e) }));
    r.end(body);
  });
}

async function serverTests() {
  console.log('\n== server.js');
  let r = await raw({ path: '/api/status', headers: { host: `localhost:${PORT}` } });
  check(r.status === 200 && JSON.parse(r.body).ai === true, 'status reports AI on');
  r = await raw({ path: '/', headers: { host: `localhost:${PORT}` } });
  check(r.status === 200 && r.body.includes('<title>Code to Cluster</title>') && r.headers['x-content-type-options'] === 'nosniff', 'home page is Code to Cluster, with nosniff');
  r = await raw({ path: '/todo-on-eks-tutorial.html', headers: { host: `localhost:${PORT}` } });
  check(r.status === 200 && r.body.startsWith('<!doctype html>'), 'EKS page is a complete document (not quirks mode)');
  r = await raw({ path: '/..%2Fserver.js', headers: { host: `localhost:${PORT}` } });
  check(r.status === 404, 'path traversal is refused');
  r = await raw({ path: '/server.js', headers: { host: `localhost:${PORT}` } });
  check(r.status === 404, 'only .html files in docs/ are served');
  r = await raw({ path: '/favicon.ico', headers: { host: `localhost:${PORT}` } });
  check(r.status === 200 && r.headers['content-type'] === 'image/x-icon', 'favicon.ico is served');
  r = await raw({ path: '/api/status', headers: { host: 'evil.example:8791' } });
  check(r.status === 403, 'foreign Host header is refused');
  r = await raw({ path: '/api/ask', method: 'POST', headers: { host: `localhost:${PORT}`, 'content-type': 'application/json' } }, '{}');
  check(r.status === 403, 'ask without the x-tutorial header is refused');
  r = await raw({ path: '/api/ask', method: 'POST', headers: { host: `localhost:${PORT}`, 'x-tutorial': '1', origin: 'http://evil.example' } }, '{}');
  check(r.status === 403, 'ask from a foreign origin is refused');
  r = await raw({ path: '/api/ask', method: 'POST', headers: { host: `localhost:${PORT}`, 'x-tutorial': '1' } }, '{"messages":[]}');
  check(r.status === 400, 'ask with no messages is a 400');
  r = await raw({ path: '/api/ask', method: 'POST', headers: { host: `localhost:${PORT}`, 'x-tutorial': '1' } }, '{"messages":[{"role":"system","content":"x"}]}');
  check(r.status === 400, 'a client cannot inject a system message');
  seen.length = 0;
  r = await raw({ path: '/api/ask', method: 'POST', headers: { host: `localhost:${PORT}`, 'x-tutorial': '1', 'content-type': 'application/json' } }, JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }));
  check(r.status === 200 && r.body.includes('smallest unit'), 'ask streams the answer back as plain text');
  check(seen.length === 1 && seen[0].auth === 'Bearer test-key' && seen[0].body.stream === true && seen[0].body.messages[0].role === 'system' && seen[0].body.max_completion_tokens > 0, 'upstream gets the key, stream:true, our system prompt and max_completion_tokens');
}

async function pageTests(browser, spec) {
  console.log(`\n== ${spec.name}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION)|status of (401|429|502)/.test(m.text())) errs.push(m.text()); });
  await pg.goto(`${BASE}/${spec.file}`);
  await pg.waitForSelector('#rail-list li');

  check(await pg.evaluate(() => document.compatMode === 'CSS1Compat'), 'standards mode');
  check(await pg.evaluate(() => document.documentElement.lang === 'en' && !!document.querySelector('meta[name=viewport]') && !!document.querySelector('meta[name=description]')), 'lang, viewport and description are set');

  // structure
  const steps = await pg.$$eval('section[data-step]', (s) => s.map((x) => ({ id: x.id, num: x.querySelector('.num').textContent, title: x.querySelector('h2').textContent })));
  check(steps.length === spec.steps, `${spec.steps} steps (found ${steps.length})`);
  check(new Set(steps.map((s) => s.id)).size === steps.length, 'step ids are unique');
  const nums = steps.map((s) => s.num).filter((n) => /^\d+$/.test(n));
  check(nums.every((n, i) => +n === i), 'step numbers run 00, 01, 02 … with no gaps');
  check(!steps.some((s) => /\?\?/.test(s.num)), 'no placeholder step numbers');
  check((await pg.$$eval('#rail-list a', (a) => a.length)) === steps.length, 'rail lists every step');
  const badAnchors = await pg.$$eval('a[href^="#"]', (as) => as.filter((a) => a.getAttribute('href').length > 1 && !document.getElementById(a.getAttribute('href').slice(1))).map((a) => a.getAttribute('href')));
  check(badAnchors.length === 0, 'every in-page link has a target ' + badAnchors.join(','));
  const ids = await pg.$$eval('[id]', (e) => e.map((x) => x.id));
  check(new Set(ids).size === ids.length, 'no duplicate ids in the page');
  const badLinks = await pg.$$eval('main a[href]', (as) => as.filter((a) => !/^(https:\/\/|http:\/\/localhost:\d+(\/\S*)?$|#|todo-on-eks-tutorial\.html$|code-to-cluster-tutorial\.html$)/.test(a.getAttribute('href'))).map((a) => a.getAttribute('href')));
  check(badLinks.length === 0, 'links are https or in-page ' + badLinks.join(','));
  const unsafe = await pg.$$eval('main a[href^="http"]', (as) => as.filter((a) => a.target === '_blank' && !/noopener/.test(a.rel)).length);
  check(unsafe === 0, 'target=_blank links use rel=noopener');
  const emptyCode = await pg.$$eval('figure.code pre code', (c) => c.filter((x) => !x.textContent.trim()).length);
  check(emptyCode === 0, 'no empty code blocks');
  const noAlt = await pg.$$eval('svg[role=img]', (s) => s.filter((x) => !x.querySelector('title') && !x.getAttribute('aria-label')).length);
  check(noAlt === 0, 'diagrams have a title for screen readers');

  // progress
  check((await pg.textContent('#progress-text')).startsWith('0 of '), 'progress starts at 0');
  const first = pg.locator('section[data-step] input[data-done]').first();
  await first.check();
  check((await pg.textContent('#progress-text')).startsWith('1 of '), 'ticking a step updates the progress text');
  await pg.reload(); await pg.waitForSelector('#rail-list li');
  check(await pg.locator('section[data-step] input[data-done]').first().isChecked(), 'ticked step survives a reload');
  await pg.locator('section[data-step] input[data-done]').first().uncheck();

  // rail highlight
  await pg.evaluate(() => document.getElementById('docker').scrollIntoView());
  await pg.waitForFunction(() => document.querySelector('#rail-list a[aria-current=step][href="#docker"]'), null, { timeout: 6000 }).catch(() => {});   // smooth scrolling takes a moment
  check(await pg.evaluate(() => { const a = document.querySelector('#rail-list a[aria-current=step]'); return !!a && a.getAttribute('href') === '#docker'; }), 'rail highlights the step being read');
  const auto = await pg.evaluate(() => { const secs = [...document.querySelectorAll('section[data-step]')]; const at = secs.findIndex((s) => s.id === 'docker'); const ticked = secs.map((s) => { const b = s.querySelector('input[data-done]'); return b ? b.checked : null; }); return { before: at > 0 && ticked.slice(0, at).every((v) => v !== false), after: ticked.slice(at).some(Boolean) }; });
  check(auto.before && !auto.after, 'steps you scroll past get a tick automatically; later ones do not');
  await pg.evaluate(() => document.querySelectorAll('input[data-done]').forEach((b) => { if (b.checked) { b.checked = false; b.dispatchEvent(new Event('change')); } }));

  // tutorial menu
  const other = spec.file.startsWith('code') ? 'todo-on-eks-tutorial.html' : 'code-to-cluster-tutorial.html';
  check(await pg.locator('#tmenu-list').isHidden() && (await pg.getAttribute('#tmenu-btn', 'aria-expanded')) === 'false', 'the Tutorials menu starts closed');
  await pg.click('#tmenu-btn');
  check(await pg.locator('#tmenu-list a').count() === 2 && await pg.locator('#tmenu-list').isVisible() && (await pg.getAttribute('#tmenu-btn', 'aria-expanded')) === 'true', 'the Tutorials menu opens with both tutorials');
  check((await pg.getAttribute('#tmenu-list a[aria-current=page]', 'href')) === spec.file, 'the current tutorial is marked');
  await pg.keyboard.press('Escape');
  check(await pg.locator('#tmenu-list').isHidden(), 'Escape closes the Tutorials menu');
  await pg.click('#tmenu-btn'); await pg.mouse.click(5, 400);
  check(await pg.locator('#tmenu-list').isHidden(), 'clicking elsewhere closes the Tutorials menu');
  await pg.click('#tmenu-btn');
  await Promise.all([pg.waitForURL('**/' + other), pg.click(`#tmenu-list a[href="${other}"]`)]);
  check(/<title>/.test(await pg.content()) && (await pg.getAttribute('#tmenu-list a[aria-current=page]', 'href', { timeout: 3000 }).catch(() => null)) === other, 'the menu switches to the other tutorial');
  await pg.goto(`${BASE}/${spec.file}`); await pg.waitForSelector('#rail-list li');

  // page settings: theme, text size, progress
  const bg = () => pg.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2]; });
  await pg.emulateMedia({ colorScheme: 'light' });
  check((await bg()) > 600, 'auto follows a light system');
  await pg.click('#theme-btn');   // auto -> light
  check(await pg.evaluate(() => document.documentElement.dataset.theme === 'light'), 'theme button: Auto -> Light');
  await pg.emulateMedia({ colorScheme: 'dark' });
  check((await bg()) > 600, 'Light stays light on a dark system');
  await pg.click('#theme-btn');   // light -> dark
  check(await pg.evaluate(() => document.documentElement.dataset.theme === 'dark') && (await bg()) < 150, 'theme button: Light -> Dark');
  await pg.emulateMedia({ colorScheme: 'light' });
  check((await bg()) < 150, 'Dark stays dark on a light system');
  await pg.reload(); await pg.waitForSelector('#rail-list li');
  check(await pg.evaluate(() => document.documentElement.dataset.theme === 'dark'), 'the theme is remembered after a reload');
  await pg.click('#theme-btn');   // dark -> auto
  check(await pg.evaluate(() => !document.documentElement.hasAttribute('data-theme')), 'theme button: Dark -> Auto');
  await pg.emulateMedia({ colorScheme: 'light' });
  const w0 = await pg.evaluate(() => document.querySelector('#overview p').getBoundingClientRect().height);
  const textH = () => pg.evaluate(() => document.querySelector('#overview h2').getBoundingClientRect().height);
  const h0 = await textH();
  await pg.click('#font-up'); await pg.click('#font-up');
  check((await pg.textContent('#font-pct')) === '130%' && (await textH()) > h0 * 1.25, 'A+ twice gives 130% and larger text');
  await pg.reload(); await pg.waitForSelector('#rail-list li');
  check((await pg.textContent('#font-pct')) === '130%', 'the text size is remembered after a reload');
  await pg.click('#font-up');
  check((await pg.textContent('#font-pct')) === '150%' && await pg.locator('#font-up').isDisabled(), 'A+ stops at 150%');
  await pg.click('#font-pct');
  check((await pg.textContent('#font-pct')) === '100%' && Math.abs((await textH()) - h0) < 1, 'clicking the percentage resets to 100%');
  await pg.click('#font-down');
  check((await pg.textContent('#font-pct')) === '85%' && await pg.locator('#font-down').isDisabled(), 'A− stops at 85%');
  await pg.setViewportSize({ width: 390, height: 900 });
  check(await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scroll at 85% on a phone');
  await pg.setViewportSize({ width: 1280, height: 900 });
  await pg.click('#font-pct');
  const bar = () => pg.evaluate(() => parseFloat(document.querySelector('#readbar span').style.width) || 0);
  const jump = (frac) => pg.evaluate((f) => window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * f, behavior: 'instant' }), frac);
  await jump(0); await pg.waitForTimeout(250);
  const top = await bar();
  check(top < 1, `reading bar starts empty at the top (${top.toFixed(1)}%)`);
  await jump(0.5); await pg.waitForTimeout(250);
  const mid = await bar();
  check(mid > 45 && mid < 55, `reading bar is half full half way down (${mid.toFixed(0)}%)`);
  await jump(1); await pg.waitForTimeout(250);
  check((await bar()) > 99, 'reading bar is full at the bottom');
  await jump(0);
  await pg.evaluate(() => document.querySelectorAll('input[data-done]').forEach((b) => { if (b.checked) { b.checked = false; b.dispatchEvent(new Event('change')); } }));
  await pg.locator('section[data-step] input[data-done]').nth(1).check();
  check(/^[1-9]\d*\/\d+ done$/.test(await pg.textContent('#tb-done')), 'the toolbar counts ticked steps');
  await pg.locator('section[data-step] input[data-done]').nth(1).uncheck();

  // resizable steps panel
  const railW = () => pg.evaluate(() => Math.round(document.querySelector('.rail').getBoundingClientRect().width));
  check(Math.abs((await railW()) - 250) <= 1, 'steps panel starts at 250px');
  const gb = await pg.locator('#rail-grip').boundingBox();
  await pg.mouse.move(gb.x + gb.width / 2, 300); await pg.mouse.down(); await pg.mouse.move(gb.x + 140, 300, { steps: 6 }); await pg.mouse.up();
  const dragged = await railW();
  check(dragged > 340 && dragged < 420, `dragging the border widens the panel (${dragged}px)`);
  check(await pg.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect(); return m.left >= document.querySelector('.rail').getBoundingClientRect().right; }), 'the text column moves over, nothing overlaps');
  await pg.reload(); await pg.waitForSelector('#rail-list li');
  check(Math.abs((await railW()) - dragged) <= 1, 'the width is remembered after a reload');
  await pg.locator('#rail-grip').focus(); await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('ArrowLeft');
  check(Math.abs((await railW()) - (dragged - 32)) <= 1, 'arrow keys resize the panel');
  await pg.keyboard.press('Home');
  check(Math.abs((await railW()) - 250) <= 1, 'Home resets the width');
  await pg.mouse.move(gb.x + gb.width / 2, 300); await pg.mouse.down(); await pg.mouse.move(5, 300, { steps: 4 }); await pg.mouse.up();
  check((await railW()) === 180, 'the panel stops at a 180px minimum');
  await pg.locator('#rail-grip').dblclick();
  check(Math.abs((await railW()) - 250) <= 1, 'double-click resets the width');
  await pg.click('#rail-hide');
  check(await pg.evaluate(() => document.querySelector('.rail').offsetParent === null && !document.getElementById('rail-open').hidden), '« hides the panel and shows »');
  check(await pg.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect(); return m.width > 1000; }), 'the content fills the window when the panel is hidden');
  await pg.reload(); await pg.waitForSelector('#rail-list li', { state: 'attached' });
  check(await pg.evaluate(() => document.querySelector('.rail').offsetParent === null), 'hidden state is remembered after a reload');
  await pg.click('#rail-open');
  check(Math.abs((await railW()) - 250) <= 1 && await pg.evaluate(() => document.getElementById('rail-open').hidden), '» brings the panel back');
  await pg.setViewportSize({ width: 390, height: 900 });
  check(await pg.evaluate(() => getComputedStyle(document.getElementById('rail-grip')).display === 'none' && getComputedStyle(document.getElementById('rail-hide')).display === 'none'), 'on a phone the grip and « are not shown');
  await pg.setViewportSize({ width: 1280, height: 900 });

  // wide content
  const wide = await pg.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect().width; const f = document.querySelector('figure.code').getBoundingClientRect().width; const p = document.querySelector('main p').getBoundingClientRect().width; return { m, f, p }; });
  check(wide.f >= wide.m - 2 && wide.m > 800, `code blocks use the whole column (${Math.round(wide.f)} of ${Math.round(wide.m)}px)`);
  check(wide.p < 900, `paragraphs keep a readable line length (${Math.round(wide.p)}px)`);

  // copy buttons
  const figs = await pg.locator('figure.code').count();
  check(figs > 10 && (await pg.locator('figure.code .copy').count()) === figs, `every code block has a Copy button (${figs})`);
  await pg.locator('figure.code .copy').nth(2).click();
  const want = await pg.locator('figure.code pre code').nth(2).textContent();
  check((await pg.evaluate(() => navigator.clipboard.readText())) === want, 'Copy puts the exact code on the clipboard');

  // layout
  for (const w of [1280, 768, 390]) {
    await pg.setViewportSize({ width: w, height: 900 });
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over <= 0, `no sideways page scroll at ${w}px (${over})`);
  }
  await pg.setViewportSize({ width: 1280, height: 900 });
  await pg.emulateMedia({ colorScheme: 'dark' });
  const dark = await pg.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] < 150; });
  check(dark, 'dark colour scheme gives a dark page');
  await pg.emulateMedia({ colorScheme: 'light' });

  // Ask
  await pg.evaluate(() => window.scrollTo(0, 0));
  const target = pg.locator('#overview .glossary dd code').first();
  await pg.evaluate(() => { const el = document.querySelector('#overview .glossary dd code'); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await target.scrollIntoViewIfNeeded();
  seen.length = 0;
  await target.click({ button: 'right' });
  await pg.waitForSelector('#note-menu:not([hidden])', { timeout: 3000 });
  check(/Add a note/.test(await pg.textContent('#note-menu-note')) && await pg.locator('#note-menu-ask').isVisible(), 'right-click offers Add a note and Ask the tutor');
  await pg.click('#note-menu-ask');
  const isC2C = spec.file.startsWith('code');
  if (isC2C) {
    await pg.waitForSelector('dialog#ask[open]', { timeout: 3000 });
    check(true, 'right-click opens the ask box');
    await pg.click('#ask-chips .ask-chip >> nth=0');
    await pg.waitForSelector('.ask-a:not(.thinking)', { timeout: 5000 });
    await pg.waitForFunction(() => /kubectl get pods/.test(document.querySelector('#ask-thread').textContent), null, { timeout: 5000 });
    check(await pg.locator('.ask-a pre code').count() === 1 && await pg.locator('.ask-a ul li').count() === 2 && await pg.locator('.ask-a b').count() >= 1, 'answer is rendered as Markdown (bold, list, code block)');
    check(seen.length === 1 && /I right-clicked/.test(seen[0].body.messages.slice(-1)[0].content) && /Step \d+|Tutorial overview/.test(seen[0].body.messages.slice(-1)[0].content), 'question carries the passage and the step');
    await pg.fill('#ask-input', 'FAIL429'); await pg.press('#ask-input', 'Enter');
    await pg.waitForSelector('.ask-err', { timeout: 4000 });
    check(/rate limit|quota/i.test(await pg.textContent('.ask-err')), 'rate-limit error is explained');
    await pg.fill('#ask-input', 'FAIL401'); await pg.press('#ask-input', 'Enter');
    await pg.waitForFunction(() => document.querySelectorAll('.ask-err').length >= 2, null, { timeout: 4000 });
    check(/rejected the API key/i.test(await pg.locator('.ask-err').last().textContent()), 'bad-key error is explained');
    await pg.fill('#ask-input', 'EMPTY'); await pg.press('#ask-input', 'Enter');
    await pg.waitForFunction(() => document.querySelectorAll('.ask-err').length >= 3, null, { timeout: 4000 });
    check(/returned nothing/i.test(await pg.locator('.ask-err').last().textContent()), 'empty answer is explained');
    await pg.keyboard.press('Escape');
    check(!(await pg.locator('dialog#ask').evaluate((d) => d.open)), 'Escape closes the box');
  } else {
    await pg.waitForSelector('#ctx:not([hidden])', { timeout: 3000 });
    check(true, 'right-click opens the ask menu');
    await pg.click('#ctx button[data-ask]:first-child');
    await pg.waitForFunction(() => /kubectl get pods/.test(document.querySelector('#thread').textContent), null, { timeout: 5000 });
    check(await pg.locator('.msg-a pre code').count() === 1 && await pg.locator('.msg-a ul li').count() === 2, 'answer is rendered as Markdown (list, code block)');
    check(seen.length === 1 && /Question: Explain this/.test(seen[0].body.messages.slice(-1)[0].content), 'question carries the step text');
    await pg.fill('#ask-input', 'FAIL429'); await pg.press('#ask-input', 'Enter');
    await pg.waitForSelector('.msg-err', { timeout: 4000 });
    check(/Too many questions/i.test(await pg.textContent('.msg-err')), 'rate-limit error is explained');
    await pg.fill('#ask-input', 'FAIL401'); await pg.press('#ask-input', 'Enter');
    await pg.waitForFunction(() => document.querySelectorAll('.msg-err').length >= 2, null, { timeout: 4000 });
    check(/rejected the API key/i.test(await pg.locator('.msg-err').last().textContent()), 'bad-key error is explained');
    await pg.keyboard.press('Escape');
    check(await pg.locator('#panel').evaluate((p) => p.hidden), 'Escape closes the panel');
  }
  check(errs.length === 0, 'no console or page errors ' + errs.join(' | '));
  await ctx.close();
}

async function noKeyTest(browser) {
  console.log('\n== without OPENAI_API_KEY');
  const ctx = await browser.newContext();
  for (const spec of PAGES) {
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/${spec.file}`);
    await pg.waitForSelector('#rail-list li');
    await pg.waitForTimeout(400);
    const hint = await pg.evaluate(() => { const h = document.getElementById('ask-hint'); return h && !h.hidden ? h.textContent : ''; });
    check(spec.file.startsWith('code') ? /switched off/.test(hint) : hint === '', `${spec.name}: asking is off and says so (or stays hidden)`);
    await pg.locator('#overview .glossary dd').first().click({ button: 'right' });
    check(await pg.evaluate(() => !document.querySelector('dialog#ask[open]') && (!document.getElementById('ctx') || document.getElementById('ctx').hidden)), `${spec.name}: with asking off, right-click opens no Ask box`);
    // notes
    await pg.waitForSelector('#note-menu:not([hidden])', { timeout: 3000 });
    check(await pg.locator('#note-menu-ask').isHidden() && await pg.locator('#note-menu-bm').isVisible(), `${spec.name}: with asking off the menu offers a note and a bookmark only`);
    await pg.click('#note-menu-note');
    await pg.waitForSelector('#note-dlg[open]', { timeout: 3000 });
    check(await pg.textContent('#note-title') === 'Add a note' && /\S/.test(await pg.textContent('#note-quote')), `${spec.name}: right-click opens the Add a note box showing the word`);
    check(await pg.locator('#note-save').isDisabled(), `${spec.name}: an empty note cannot be saved`);
    await pg.fill('#note-text', 'My first note');
    await pg.click('#note-save');
    check(await pg.locator('mark.note-hl').count() >= 1 && await pg.locator('.note-card', { hasText: 'My first note' }).count() === 1, `${spec.name}: saving highlights the word and adds a card`);
    check(await pg.evaluate(() => { const m = document.querySelectorAll('mark.note-hl.note-end'); return m.length === 1 && getComputedStyle(m[0], '::after').content.includes('✎'); }), `${spec.name}: a small note icon sits after the word`);
    check(await pg.locator('#notes-pane').isVisible() && await pg.textContent('#notes-count') === '1', `${spec.name}: the notes panel opens and the Notes button counts 1`);
    await pg.waitForTimeout(300);
    const line = await pg.evaluate(() => { const p = document.querySelector('#notes-lines path'), c = document.querySelector('.note-card'); const m = document.querySelector('mark.note-hl').getBoundingClientRect(); if (!p || !c || c.hidden) return null; const n = p.getAttribute('d').match(/-?[\d.]+/g).map(Number); return { sx: n[0], sy: n[1], ex: n[n.length - 2], ey: n[n.length - 1], mr: m.right, mb: m.bottom, cl: c.getBoundingClientRect().left, ct: c.getBoundingClientRect().top, ch: c.getBoundingClientRect().height }; });
    check(!!line && Math.abs(line.sy - line.mb) < 6 && line.sx <= line.mr && line.ex <= line.cl + 2 && line.ey >= line.ct && line.ey <= line.ct + line.ch, `${spec.name}: a line joins the word to its note`);
    check(/\d{4}.*\d{1,2}:\d{2}/.test(await pg.textContent('.note-card .note-date')), `${spec.name}: each note shows the date and time it was saved`);
    await pg.reload(); await pg.waitForSelector('#rail-list li');
    check(await pg.locator('mark.note-hl').count() >= 1 && await pg.locator('.note-card', { hasText: 'My first note' }).count() === 1, `${spec.name}: the note and its highlight survive a reload`);
    await pg.locator('mark.note-hl').first().scrollIntoViewIfNeeded();
    await pg.locator('mark.note-hl').first().click();
    await pg.waitForSelector('#note-dlg[open]');
    check(await pg.inputValue('#note-text') === 'My first note' && !(await pg.locator('#note-del').isHidden()), `${spec.name}: clicking a highlight opens the note for editing`);
    await pg.fill('#note-text', 'Edited note'); await pg.click('#note-save');
    check(await pg.locator('.note-card', { hasText: 'Edited note' }).count() === 1 && /^Edited /.test(await pg.textContent('.note-card .note-date')), `${spec.name}: editing updates the card and marks it edited`);
    const copyTxt = await pg.evaluate(() => document.querySelector('main').textContent.length);
    await pg.locator('mark.note-hl').first().click(); await pg.waitForSelector('#note-dlg[open]');
    await pg.click('#note-del'); await pg.click('#note-del');
    check(await pg.locator('mark.note-hl').count() === 0 && await pg.locator('.note-card').count() === 0 && await pg.evaluate(() => document.querySelector('main').textContent.length) === copyTxt, `${spec.name}: deleting removes the highlight and leaves the text as it was`);
    // bookmarks
    await pg.locator('#overview .glossary dd').first().scrollIntoViewIfNeeded();
    await pg.locator('#overview .glossary dd').first().click({ button: 'right' });
    await pg.waitForSelector('#note-menu:not([hidden])');
    const len0 = await pg.evaluate(() => document.querySelector('main').textContent.length);
    await pg.click('#note-menu-bm');
    check(await pg.locator('mark.bm-hl.bm-start').count() === 1 && await pg.evaluate(() => document.querySelector('main').textContent.length) === len0, `${spec.name}: bookmarking marks the spot with a flag and leaves the text unchanged`);
    await pg.click('#bm-btn');
    check(await pg.locator('#bm-list .bm-item').count() >= 1 && /Your bookmarks/.test(await pg.textContent('#bm-list')), `${spec.name}: the Bookmarks list shows it`);
    await pg.reload(); await pg.waitForSelector('#rail-list li');
    check(await pg.locator('mark.bm-hl.bm-start').count() === 1, `${spec.name}: the bookmark survives a reload`);
    await pg.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await pg.waitForTimeout(300);
    await pg.click('#bm-btn'); await pg.locator('#bm-list .bm-item', { hasText: 'Step' }).first().click();
    await pg.waitForFunction(() => { const r = document.querySelector('mark.bm-hl').getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; }, null, { timeout: 4000 });
    check(true, `${spec.name}: choosing a bookmark scrolls to it`);
    await pg.click('#bm-btn'); await pg.locator('#bm-list .bm-x').first().click();
    check(await pg.locator('mark.bm-hl').count() === 0 && await pg.evaluate(() => document.querySelector('main').textContent.length) === len0, `${spec.name}: removing a bookmark leaves the text as it was`);
    // resume where you stopped
    await pg.evaluate(() => { const s = document.getElementById('docker'); window.scrollTo({ top: scrollY + s.getBoundingClientRect().top + 300, behavior: 'instant' }); });
    await pg.waitForTimeout(700);
    await pg.reload(); await pg.waitForSelector('#rail-list li'); await pg.waitForTimeout(1500);
    const top = await pg.evaluate(() => document.getElementById('docker').getBoundingClientRect().top);
    check(Math.abs(top + 300) < 60 && await pg.locator('.bm-toast').isVisible(), `${spec.name}: reopening the page returns to where you stopped (${Math.round(top)})`);
    const base = pg.url().split('#')[0];
    await pg.goto('about:blank'); await pg.goto(base + '#cluster'); await pg.waitForTimeout(1500);
    check(await pg.evaluate(() => { const t = document.querySelector('.bm-toast'); return !t || t.hidden; }), `${spec.name}: a link with #step wins over the remembered place`);
    await pg.close();
  }
  await ctx.close();
}

(async () => {
  await new Promise((r) => fake.listen(FAKE, '127.0.0.1', r));
  let srv = await startServer({ OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${FAKE}/v1` });
  const browser = await chromium.launch();
  try {
    await serverTests();
    for (const spec of PAGES) await pageTests(browser, spec);
    srv.kill(); await new Promise((r) => srv.on('exit', r));
    srv = await startServer({ OPENAI_API_KEY: '' });
    await noKeyTest(browser);
  } catch (e) {
    fails++; console.log('FAIL unexpected error: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.kill(); fake.close();
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
