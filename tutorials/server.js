// Local server for the tutorials in docs/.
// Serves the HTML pages and answers the right-click "Ask" box by forwarding questions to the OpenAI API.
// The API key stays on this machine: the browser only ever talks to this server.
//
//   node server.js          then open http://localhost:8788
//
// Settings (environment variables): OPENAI_API_KEY (required for answers), OPENAI_MODEL (default gpt-4o-mini), PORT (default 8788),
// OPENAI_BASE_URL (default https://api.openai.com/v1; for testing or an OpenAI-compatible service).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 8788;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const KEY = (process.env.OPENAI_API_KEY || '').trim();
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const DOCS = path.join(__dirname, 'docs');
const HOME = 'code-to-cluster-tutorial.html';
const ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
const MAX_BODY = 64 * 1024;
const ICON = path.join(__dirname, 'code-to-cluster.ico');
const HOSTS = new RegExp(`^(localhost|127\\.0\\.0\\.1):${PORT}$`);   // refuse other Host names (DNS rebinding)

const SYSTEM = [
  'You are a patient tutor inside a hands-on platform engineering tutorial.',
  'The learner is a .NET developer who is new to Docker, Kubernetes, Helm, GitHub Actions and Argo CD (and, in one tutorial, Amazon ECR and EKS).',
  'They right-clicked a word or phrase in the tutorial and asked a question about it.',
  'Answer in the context of the passage they were reading.',
  'Explain why, not only what, and define any jargon the first time you use it.',
  'Relate to things a .NET developer already knows (IIS, NuGet, appsettings.json, Visual Studio) when it helps.',
  'Be accurate. If something depends on versions or you are unsure, say so plainly.',
  'Keep it short: usually under 150 words. Use Markdown: short paragraphs, bullet lists, `inline code`, fenced code blocks for commands.',
].join(' ');

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Only user/assistant turns with text are passed on; the system prompt is always ours.
function cleanMessages(input) {
  if (!Array.isArray(input) || !input.length || input.length > 20) return null;
  const out = [];
  for (const m of input) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) return null;
    out.push({ role: m.role, content: m.content.slice(0, 12000) });
  }
  return out[out.length - 1].role === 'user' ? out : null;
}

async function ask(req, res) {
  // Requests must come from a page this server served, not from another site open in the browser.
  const origin = req.headers.origin;
  if ((origin && !ORIGINS.includes(origin)) || req.headers['x-tutorial'] !== '1') {
    return json(res, 403, { code: 'forbidden', message: 'Not allowed.' });
  }
  if (!KEY) return json(res, 503, { code: 'no_key', message: 'OPENAI_API_KEY is not set.' });

  let messages;
  try { messages = cleanMessages(JSON.parse(await readBody(req)).messages); } catch (e) { messages = null; }
  if (!messages) return json(res, 400, { code: 'bad_request', message: 'Expected { messages: [{ role, content }] }.' });

  const ctl = new AbortController();
  res.on('close', () => ctl.abort());

  let upstream;
  try {
    upstream = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, stream: true, max_completion_tokens: 700, messages: [{ role: 'system', content: SYSTEM }, ...messages] }),
      signal: ctl.signal,
    });
  } catch (e) {
    if (ctl.signal.aborted) return;
    return json(res, 502, { code: 'upstream_error', message: 'Could not reach the OpenAI API.' });
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => {});
    if (upstream.status === 401) return json(res, 502, { code: 'bad_key', message: 'OpenAI rejected the API key.' });
    if (upstream.status === 429) return json(res, 429, { code: 'rate_limited', message: 'OpenAI rate limit or quota reached.' });
    return json(res, 502, { code: 'upstream_error', message: `OpenAI returned HTTP ${upstream.status}.` });
  }

  // OpenAI streams server-sent events; pass the text on as plain chunks.
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const dec = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of upstream.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch (e) { /* ignore a malformed event */ }
      }
    }
  } catch (e) { /* client closed the box, or the connection dropped */ }
  res.end();
}

function page(res, name) {
  // Only plain file names from docs/, so a request can't reach outside that folder.
  if (!/^[\w-]+\.html$/.test(name)) return json(res, 404, { code: 'not_found', message: 'Not found.' });
  fs.readFile(path.join(DOCS, name), (err, data) => {
    if (err) return json(res, 404, { code: 'not_found', message: 'Not found.' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    res.end(data);
  });
}

function icon(res) {
  fs.readFile(ICON, (err, data) => {
    if (err) { res.writeHead(204); return res.end(); }
    res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'public, max-age=3600' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (!HOSTS.test(req.headers.host || '')) return json(res, 403, { code: 'forbidden', message: 'Not allowed.' });
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/favicon.ico') return icon(res);
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { ai: !!KEY, model: MODEL });
  if (req.method === 'POST' && url.pathname === '/api/ask') return ask(req, res).catch(() => { if (!res.headersSent) json(res, 500, { code: 'server_error', message: 'Something went wrong.' }); else res.end(); });
  if (req.method === 'GET') return page(res, url.pathname === '/' ? HOME : url.pathname.slice(1));
  json(res, 404, { code: 'not_found', message: 'Not found.' });
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. The tutorial server is probably already running: open http://localhost:${PORT}` : e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tutorials on http://localhost:${PORT}  (AI ${KEY ? 'on' : 'off: set OPENAI_API_KEY'}, model ${MODEL})`);
});
