// The page code of the Identity and Access Lab: mounts exercises ([data-ex]) and tools ([data-tool]), keeps the step ticks
// and the progress panel. Exercises are data in window.IA.exercises; judging lives in engine.js; crypto.js and x509.js
// do the work of the tools. Nothing here sends anything anywhere.
(function () {
  'use strict';
  var IA = window.IA = window.IA || {};
  IA.exercises = IA.exercises || {};
  var E = window.IAEngine, C = window.IACrypto, X = window.IAX509;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function button(label) { var b = el('button', 'copy', label); b.type = 'button'; return b; }

  // ------------------------------------------------------------------ exercises
  // Each builder fills `box` and returns { get(), set(answer), show(result) }.
  var builders = {
    quiz: function (ex, box, id) {
      var name = 'q-' + id + '-' + Math.random().toString(36).slice(2, 7), inputs = [];
      ex.options.forEach(function (o, i) {
        var l = el('label', 'ex-opt'), inp = el('input'); inp.type = ex.multi ? 'checkbox' : 'radio'; inp.name = name; inp.value = i;
        var t = el('span', 'ex-t', o.t); l.appendChild(inp); l.appendChild(t); box.appendChild(l);
        var why = el('div', 'ex-why'); why.hidden = true; l.appendChild(why); inputs.push({ inp: inp, l: l, why: why });
      });
      return {
        get: function () { return inputs.filter(function (x) { return x.inp.checked; }).map(function (x) { return +x.inp.value; }); },
        set: function (a) { inputs.forEach(function (x, i) { x.inp.checked = a.indexOf(i) >= 0; }); },
        show: function (res) {
          inputs.forEach(function (x, i) {
            var it = res.items[i]; x.l.classList.remove('good', 'bad');
            if (!it || res.empty) { x.why.hidden = true; return; }
            x.l.classList.add(it.ok ? 'good' : 'bad');
            x.why.hidden = !it.why; x.why.innerHTML = it.why || '';
          });
        },
      };
    },
    order: function (ex, box, id) {
      var idx = ex.items.map(function (_, i) { return i; });
      var seed = hash(id), n = idx.length;
      for (var i = n - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; var j = seed % (i + 1); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      if (idx.every(function (v, k) { return v === k; })) idx.push(idx.shift());
      var ol = el('ol', 'ex-order'); box.appendChild(ol);
      function render(res) {
        ol.innerHTML = '';
        idx.forEach(function (v, pos) {
          var li = el('li'); li.appendChild(el('span', 'ex-t', ex.items[v]));
          var up = button('▲'), dn = button('▼'); up.setAttribute('aria-label', 'Move up'); dn.setAttribute('aria-label', 'Move down');
          up.disabled = pos === 0; dn.disabled = pos === n - 1;
          up.addEventListener('click', function () { var a = idx[pos]; idx[pos] = idx[pos - 1]; idx[pos - 1] = a; render(); });
          dn.addEventListener('click', function () { var a = idx[pos]; idx[pos] = idx[pos + 1]; idx[pos + 1] = a; render(); });
          li.appendChild(up); li.appendChild(dn);
          if (res && res.items[pos]) li.classList.add(res.items[pos].ok ? 'good' : 'bad');
          ol.appendChild(li);
        });
      }
      render();
      return { get: function () { return idx.slice(); }, set: function (a) { idx = a.slice(); render(); }, show: function (res) { render(res); } };
    },
    sort: function (ex, box) {
      var rows = [];
      ex.items.forEach(function (it, i) {
        var r = el('div', 'ex-sort'); r.appendChild(el('span', 'ex-t', it.t));
        var sel = el('select'); sel.setAttribute('aria-label', 'Group for: ' + it.t.replace(/<[^>]+>/g, ''));
        var o0 = el('option', '', 'Choose…'); o0.value = ''; sel.appendChild(o0);
        ex.groups.forEach(function (g, k) { var o = el('option', '', g); o.value = k; sel.appendChild(o); });
        r.appendChild(sel); var why = el('div', 'ex-why'); why.hidden = true; r.appendChild(why); box.appendChild(r); rows.push({ sel: sel, r: r, why: why });
      });
      return {
        get: function () { return rows.map(function (x) { return x.sel.value === '' ? null : +x.sel.value; }); },
        set: function (a) { rows.forEach(function (x, i) { x.sel.value = a[i] === null || a[i] === undefined ? '' : a[i]; }); },
        show: function (res) { rows.forEach(function (x, i) { var it = res.items[i]; x.r.classList.remove('good', 'bad'); if (!it || x.sel.value === '') { x.why.hidden = true; return; } x.r.classList.add(it.ok ? 'good' : 'bad'); x.why.hidden = !it.why; x.why.innerHTML = it.why || ''; }); },
      };
    },

    attack: function (ex, box, id) {
      var A = window.IAAttack, state = { worked: false, fixedRejected: false }, env = null, lab = A.LABS[ex.lab];
      var wrap = el('div', 'atk'); box.appendChild(wrap);
      wrap.innerHTML = '<p>' + lab.story + '</p><p class="tool-note">Loading the lab…</p>';
      var parts = {};
      function ready(e) {
        env = e; var held = env.tokens[ex.lab], p = C.parse(held);
        var extra = '';
        if (ex.lab === 'alg-confusion') extra = '<label class="pg-l">The API\'s public key (anyone can have it)</label><pre class="ex-art">' + esc(env.rsa.pem) + '</pre>';
        if (ex.lab === 'weak-secret') extra = '<label class="pg-l">Words worth trying</label><p><code>' + env.wordlist.map(esc).join('</code> <code>') + '</code></p>';
        wrap.innerHTML = '<p>' + lab.story + '</p><label class="pg-l">The token you hold</label><textarea class="cmd-in mono atk-held" rows="4" readonly aria-label="The token you hold"></textarea>' + extra +
          '<p class="tool-note"><b>Goal:</b> get the API to accept a token that says <code>"role": "admin"</code>. Build it below (or open the JWT workbench), then send it.</p>' +
          '<label class="pg-l">Header</label><textarea class="cmd-in mono atk-h" rows="3" spellcheck="false" aria-label="Header"></textarea>' +
          '<label class="pg-l">Payload</label><textarea class="cmd-in mono atk-p" rows="6" spellcheck="false" aria-label="Payload"></textarea>' +
          '<label class="pg-l">Signature</label><select class="atk-mode" aria-label="Signature"><option value="keep">Keep the original signature</option><option value="none">No signature (empty)</option><option value="hmac">HMAC with this secret →</option></select> <input class="cmd-in mono atk-sec" placeholder="secret text" aria-label="HMAC secret" style="display:inline-block;width:16em">' +
          '<div class="lab-bar"><button type="button" class="copy atk-build">Build the token</button></div>' +
          '<label class="pg-l">The token to send</label><textarea class="cmd-in mono atk-tok" rows="4" spellcheck="false" aria-label="Token to send"></textarea>' +
          '<div class="lab-bar"><button type="button" class="copy atk-send">Send to the API</button><button type="button" class="copy atk-fix" disabled>Apply the fix, and send it again</button></div><div class="atk-out" aria-live="polite"></div>';
        $('.atk-held', wrap).value = held; $('.atk-h', wrap).value = JSON.stringify(p.header, null, 2); $('.atk-p', wrap).value = JSON.stringify(p.payload, null, 2);
        $('.atk-tok', wrap).value = held;
        $('.atk-build', wrap).addEventListener('click', build);
        $('.atk-send', wrap).addEventListener('click', function () { send(false); });
        $('.atk-fix', wrap).addEventListener('click', function () { send(true); });
      }
      var envPromise = (IA._atkEnv = IA._atkEnv || A.setup());
      envPromise.then(ready);
      async function build() {
        var out = $('.atk-out', wrap);
        try {
          var h = JSON.parse($('.atk-h', wrap).value), pl = JSON.parse($('.atk-p', wrap).value), mode = $('.atk-mode', wrap).value;
          var enc = function (o) { return C.b64uEnc(C.utf8(JSON.stringify(o))); }, tok;
          if (mode === 'keep') tok = enc(h) + '.' + enc(pl) + '.' + C.parse(env.tokens[ex.lab]).parts[2];
          else if (mode === 'none') tok = enc(h) + '.' + enc(pl) + '.';
          else {
            if (!/^HS(256|384|512)$/.test(h.alg)) throw new Error('HMAC signing needs alg HS256, HS384 or HS512 in the header.');
            tok = await C.sign(h, pl, { kty: 'oct', k: C.b64uEnc(C.utf8($('.atk-sec', wrap).value)) });
          }
          $('.atk-tok', wrap).value = tok; out.innerHTML = '';
        } catch (e) { out.innerHTML = '<p class="cmd-bad">' + esc(e.message) + '</p>'; }
      }
      async function send(fixed) {
        var out = $('.atk-out', wrap), tok = $('.atk-tok', wrap).value.trim();
        var r = await A.validate(ex.lab, env, tok, fixed);
        var h = '<h4>' + (fixed ? 'After the fix' : 'What the API did') + '</h4><ul class="cmd-tok">' + r.steps.map(function (x) { return '<li><code>' + esc(x.slice(0, 1)) + '</code><span>' + esc(x.slice(2)) + '</span></li>'; }).join('') + '</ul>';
        if (!fixed) {
          h += '<p class="' + (r.accepted ? 'cmd-ok' : 'cmd-bad') + '">' + (r.accepted ? (r.admin ? '✓ Accepted. The API treats you as <b>' + esc(r.claims.sub) + '</b>, role <b>admin</b>. The attack worked.' : 'Accepted, but only as role ' + esc(String(r.claims.role)) + '. You need role admin.') : '✗ Rejected.') + '</p>';
          if (r.admin) { state.worked = true; state.token = tok; $('.atk-fix', wrap).disabled = false; h += '<p class="tool-note"><b>Why it works:</b> ' + lab.flaw + '</p>'; }
        } else {
          state.fixedRejected = !r.accepted;
          h += '<p class="' + (r.accepted ? 'cmd-bad' : 'cmd-ok') + '">' + (r.accepted ? '✗ Still accepted.' : '✓ Rejected. The same token no longer works.') + '</p><p class="tool-note"><b>The fix:</b> ' + lab.fix + '</p>';
        }
        out.innerHTML = h;
        if (state.worked && state.fixedRejected) root_check();
      }
      var root_check = function () { var b = box.parentNode.querySelector(':scope > .lab-bar .copy'); if (b) b.click(); };
      return {
        get: function () { return state; },
        set: async function () { if (!env) env = await envPromise; var t = await A.forge(ex.lab, env); $('.atk-tok', wrap) || ready(env); $('.atk-tok', wrap).value = t; await send(false); await send(true); },
        show: function () {},
      };
    },
    inspect: function (ex, box, id) {
      var art = el('pre', 'ex-art'); art.textContent = ex.artifact; box.appendChild(art);
      var subs = ex.parts.map(function (p, i) {
        var d = el('div', 'ex-part'); d.appendChild(el('p', 'ex-q', p.prompt)); box.appendChild(d);
        return builders.quiz(p, d, id + '-' + i);
      });
      return {
        get: function () { return subs.map(function (s) { return s.get(); }); },
        set: function (a) { subs.forEach(function (s, i) { s.set(a[i] || []); }); },
        show: function (res) { subs.forEach(function (s, i) { s.show(res.parts[i]); }); },
      };
    },
  };

  function mountExercise(root) {
    var id = root.getAttribute('data-ex'), ex = IA.exercises[id];
    if (!ex) return;
    var saved = store.get('ia-ex:' + id) || {};
    root.classList.add('ex'); root.innerHTML = '';
    root.appendChild(el('div', 'ex-q', ex.prompt));
    var box = el('div', 'ex-body'); root.appendChild(box);
    var ctl = builders[ex.kind](ex, box, id);
    var out = el('div', 'ex-out'), bar = el('div', 'lab-bar');
    var bCheck = button('Check'), bHint = button('Hint'), bSol = button('Show answer');
    bar.appendChild(bCheck); if ((ex.hints || []).length) bar.appendChild(bHint); bar.appendChild(bSol);
    root.appendChild(bar); root.appendChild(out);
    var hintBox = el('div', 'lab-hint'); hintBox.hidden = true; root.appendChild(hintBox);
    var hints = 0;
    function check() {
      var res = E.judge(ex, ctl.get());
      ctl.show(res);
      out.innerHTML = '<p class="' + (res.ok ? 'cmd-ok' : 'cmd-bad') + '">' + (res.ok ? '✓ ' : '') + esc(res.message) + (res.ok && ex.after ? ' ' + ex.after : '') + '</p>';
      root.classList.toggle('ok', res.ok);
      if (res.ok) { var st = store.get('ia-ex:' + id) || {}; st.ok = true; store.set('ia-ex:' + id, st); root.dispatchEvent(new CustomEvent('expass', { bubbles: true })); }
    }
    bCheck.addEventListener('click', check);
    bHint.addEventListener('click', function () { var hs = ex.hints || []; hints = Math.min(hs.length, hints + 1); hintBox.hidden = false; hintBox.innerHTML = hs.slice(0, hints).map(function (h, i) { return '<p><b>Hint ' + (i + 1) + ' of ' + hs.length + '.</b> ' + h + '</p>'; }).join(''); });
    bSol.addEventListener('click', function () { ctl.set(E.solution(ex)); check(); });
    if (saved.ok) root.classList.add('ok');
  }


  // ------------------------------------------------------------------ command drills
  function mountCmd(root) {
    var id = root.getAttribute('data-cmd'), spec = (IA.cmds || {})[id], J = window.GACmdline;
    if (!spec || !J) return;
    var saved = store.get('ia-cmd:' + id) || {};
    root.classList.add('ex', 'cmd'); root.innerHTML = '';
    root.appendChild(el('div', 'ex-q', spec.prompt));
    var ta = el('textarea', 'cmd-in mono'); ta.rows = spec.rows || 2; ta.spellcheck = false; ta.placeholder = 'Type the command here'; ta.value = saved.v || '';
    ta.setAttribute('aria-label', 'Command');
    var out = el('div', 'ex-out'), bar = el('div', 'lab-bar');
    var bHint = button('Hint'), bSol = button('Show answer');
    if ((spec.hints || []).length) bar.appendChild(bHint); bar.appendChild(bSol);
    root.appendChild(ta); root.appendChild(bar); root.appendChild(out);
    var hintBox = el('div', 'lab-hint'); hintBox.hidden = true; root.appendChild(hintBox);
    var hints = 0;
    function run() {
      store.set('ia-cmd:' + id, { v: ta.value, ok: (store.get('ia-cmd:' + id) || {}).ok });
      var r = J.judgeLine(ta.value, spec.specs);
      root.classList.toggle('ok', r.ok);
      if (r.empty) { out.innerHTML = ''; return; }
      if (r.ok) {
        out.innerHTML = '<p class="cmd-ok">✓ Correct. This is what each part does:</p><ul class="cmd-tok">' + r.tokens.map(function (t) { return '<li><code>' + esc(t.t) + '</code><span>' + t.why + '</span></li>'; }).join('') + '</ul>' + (spec.after ? '<p class="tool-note">' + spec.after + '</p>' : '');
        var st = store.get('ia-cmd:' + id) || {}; st.ok = true; store.set('ia-cmd:' + id, st);
        root.dispatchEvent(new CustomEvent('expass', { bubbles: true }));
      } else out.innerHTML = '<ul class="cmd-bad">' + r.problems.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>';
    }
    ta.addEventListener('input', function () { clearTimeout(ta._t); ta._t = setTimeout(run, 200); });
    bHint.addEventListener('click', function () { var hs = spec.hints || []; hints = Math.min(hs.length, hints + 1); hintBox.hidden = false; hintBox.innerHTML = hs.slice(0, hints).map(function (h, i) { return '<p><b>Hint ' + (i + 1) + ' of ' + hs.length + '.</b> ' + h + '</p>'; }).join(''); });
    bSol.addEventListener('click', function () { ta.value = spec.answer; run(); });
    if (saved.ok) root.classList.add('ok');
    run();
  }


  // ------------------------------------------------------------------ "write the URL" drills
  function mountUrl(root) {
    var id = root.getAttribute('data-url'), spec = (IA.urls || {})[id], F = window.IAFlow;
    if (!spec || !F) return;
    var saved = store.get('ia-url:' + id) || {};
    root.classList.add('ex', 'cmd'); root.innerHTML = '';
    root.appendChild(el('div', 'ex-q', spec.prompt));
    var ta = el('textarea', 'cmd-in mono'); ta.rows = 3; ta.spellcheck = false; ta.placeholder = 'Type the address here'; ta.value = saved.v || ''; ta.setAttribute('aria-label', 'URL');
    var out = el('div', 'ex-out'), bar = el('div', 'lab-bar'), bHint = button('Hint'), bSol = button('Show answer');
    if ((spec.hints || []).length) bar.appendChild(bHint); bar.appendChild(bSol);
    root.appendChild(ta); root.appendChild(bar); root.appendChild(out);
    var hintBox = el('div', 'lab-hint'); hintBox.hidden = true; root.appendChild(hintBox); var hints = 0;
    function run() {
      store.set('ia-url:' + id, { v: ta.value, ok: (store.get('ia-url:' + id) || {}).ok });
      if (!ta.value.trim()) { out.innerHTML = ''; root.classList.remove('ok'); return; }
      var r = F.judgeUrl(ta.value, spec.spec);
      root.classList.toggle('ok', r.ok);
      if (r.ok) {
        out.innerHTML = '<p class="cmd-ok">✓ Correct. Your request, parameter by parameter:</p><div class="table-wrap"><table><tbody>' + Object.keys(r.params).map(function (k) { return '<tr><td><code>' + esc(k) + '</code></td><td><code>' + esc(r.params[k]) + '</code></td></tr>'; }).join('') + '</tbody></table></div>' + (spec.after ? '<p class="tool-note">' + spec.after + '</p>' : '');
        var st = store.get('ia-url:' + id) || {}; st.ok = true; store.set('ia-url:' + id, st);
        root.dispatchEvent(new CustomEvent('expass', { bubbles: true }));
      } else out.innerHTML = '<ul class="cmd-bad">' + r.problems.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>';
    }
    ta.addEventListener('input', function () { clearTimeout(ta._t); ta._t = setTimeout(run, 250); });
    bHint.addEventListener('click', function () { var hs = spec.hints || []; hints = Math.min(hs.length, hints + 1); hintBox.hidden = false; hintBox.innerHTML = hs.slice(0, hints).map(function (h, i) { return '<p><b>Hint ' + (i + 1) + ' of ' + hs.length + '.</b> ' + h + '</p>'; }).join(''); });
    bSol.addEventListener('click', function () { ta.value = spec.answer; run(); });
    if (saved.ok) root.classList.add('ok');
    run();
  }

  // ------------------------------------------------------------------ a step's tick means: every exercise in it has been passed
  function exOk(n) { var c = n.getAttribute('data-cmd'), u = n.getAttribute('data-url'); return !!(store.get(c ? 'ia-cmd:' + c : u ? 'ia-url:' + u : 'ia-ex:' + n.getAttribute('data-ex')) || {}).ok; }
  function syncTicks() {
    $$('section[data-step]').forEach(function (sec) {
      var box = $('input[data-done]', sec); var ex = $$('[data-ex], [data-cmd], [data-url]', sec);
      if (!box || !ex.length || $('[data-manual-tick]', sec)) return;
      var done = ex.filter(exOk).length, all = done === ex.length;
      box.disabled = true;
      var label = box.parentNode, note = $('.done-note', label);
      if (!note) { while (label.lastChild && label.lastChild !== box) label.removeChild(label.lastChild); note = el('span', 'done-note'); label.appendChild(note); }
      note.textContent = all ? ' Done: every exercise in this step is passed' : ' ' + done + ' of ' + ex.length + ' exercises passed. This ticks itself when all are';
      if (box.checked !== all) { box.checked = all; box.dispatchEvent(new Event('change')); }
    });
  }
  document.addEventListener('expass', function () { syncTicks(); renderProgress(); });

  function renderProgress() {
    var box = $('#ia-progress'); if (!box) return;
    var levels = {};
    $$('section[data-step]').forEach(function (sec) {
      var lvl = sec.getAttribute('data-level') || 'Other';
      $$('[data-ex], [data-cmd], [data-url]', sec).forEach(function (n) {
        var o = levels[lvl] = levels[lvl] || { n: 0, t: 0 };
        o.t++; if (exOk(n)) o.n++;
      });
    });
    var keys = Object.keys(levels);
    box.innerHTML = keys.length ? keys.map(function (k) { var o = levels[k]; return '<div class="ga-pg"><span>' + esc(k) + '</span><b>' + o.n + ' / ' + o.t + '</b><i style="--w:' + Math.round(o.n / o.t * 100) + '%"></i></div>'; }).join('') : '<p>Exercises appear here as the lessons are added.</p>';
  }

  // ------------------------------------------------------------------ tools
  function when(sec) { return sec; }
  function fmtTime(sec) {
    var d = new Date(sec * 1000); if (isNaN(d)) return String(sec);
    var diff = Math.round(sec - Date.now() / 1000), a = Math.abs(diff);
    var span = a < 120 ? a + ' seconds' : a < 7200 ? Math.round(a / 60) + ' minutes' : a < 172800 ? Math.round(a / 3600) + ' hours' : Math.round(a / 86400) + ' days';
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC (' + (diff >= 0 ? 'in ' + span : span + ' ago') + ')';
  }
  var CLAIMS = {
    iss: 'Issuer: who created and signed the token',
    sub: 'Subject: who the token is about',
    aud: 'Audience: who the token is meant for. An API must check it is one of them',
    exp: 'Expiry: the token must not be accepted at or after this time',
    nbf: 'Not before: the token must not be accepted before this time',
    iat: 'Issued at',
    jti: 'Token ID: a unique name for this token',
    azp: 'Authorized party: the client the token was issued to',
    scope: 'Scopes granted',
    nonce: 'Value that ties an ID token to the request that asked for it',
  };
  function jsonView(o) { return esc(JSON.stringify(o, null, 2)); }

  function toolJwt(root) {
    root.innerHTML = '';
    var q = el('div', 'tool jwt');
    var tok = el('textarea', 'cmd-in mono'); tok.rows = 5; tok.spellcheck = false; tok.setAttribute('aria-label', 'Token'); tok.placeholder = 'Paste a JWT: three parts separated by dots';
    var ex = button('Make an example token');
    var dec = el('div', 'tool-out'), ver = el('div', 'tool-ver');
    q.appendChild(el('label', 'pg-l', 'A token (stays in this page)')); q.appendChild(tok); q.appendChild(ex); q.appendChild(dec); q.appendChild(ver); root.appendChild(q);
    var secret = 'lab-secret-lab-secret-lab-secret-32';
    function keyFrom(text, kid) {
      text = text.trim(); if (!text) return null;
      if (text[0] === '{') {
        var j = JSON.parse(text);
        if (Array.isArray(j.keys)) {                       // a whole key set (a JWKS): pick the key the token names
          var m = j.keys.filter(function (k) { return k.kid === kid; });
          if (!m.length) throw new Error('The key set has no key with kid ' + JSON.stringify(kid) + (j.keys.length ? ' (it has: ' + j.keys.map(function (k) { return k.kid; }).join(', ') + ')' : '') + '.');
          return m[0];
        }
        return j;
      }
      return { kty: 'oct', k: C.b64uEnc(C.utf8(text)) };
    }
    async function render() {
      var p = C.parse(tok.value);
      if (!tok.value.trim()) { dec.innerHTML = ''; ver.innerHTML = ''; return; }
      var h = '';
      if (p.errors.length) h += '<p class="cmd-bad">' + esc(p.errors.join(' ')) + '</p>';
      if (p.header) {
        h += '<h4>Header</h4><pre class="ex-art">' + jsonView(p.header) + '</pre>';
        var alg = p.header.alg;
        if (alg === 'none') h += '<p class="cmd-bad"><b>alg is none:</b> this token has no signature at all. A verifier must never accept it unless it asked for unsigned tokens.</p>';
        else if (C.ALGS[alg] && C.ALGS[alg].deprecated) h += '<p class="tool-note">' + esc(C.ALGS[alg].deprecated) + '</p>';
        else if (!C.ALGS[alg]) h += '<p class="tool-note">The algorithm <code>' + esc(String(alg)) + '</code> is not one this tool can check.</p>';
      }
      if (p.payload) {
        h += '<h4>Payload (claims)</h4><pre class="ex-art">' + jsonView(p.payload) + '</pre><div class="table-wrap"><table><thead><tr><th>Claim</th><th>Value</th><th>Meaning</th></tr></thead><tbody>';
        Object.keys(p.payload).forEach(function (k) {
          var v = p.payload[k], shown = ['exp', 'nbf', 'iat'].indexOf(k) >= 0 && typeof v === 'number' ? fmtTime(v) : JSON.stringify(v);
          h += '<tr><td><code>' + esc(k) + '</code></td><td>' + esc(shown) + '</td><td>' + esc(CLAIMS[k] || '') + '</td></tr>';
        });
        h += '</tbody></table></div><p class="tool-note"><b>Anyone who holds this token can read it.</b> A signed token is not encrypted: the signature only shows that it was not changed.</p>';
      }
      dec.innerHTML = h;
      if (!p.header || !p.payload) { ver.innerHTML = ''; return; }
      if (!ver.firstChild) {
        ver.innerHTML = '<h4>Check it like an API would</h4>' +
          '<label class="pg-l">Algorithms you accept (the verifier chooses, never the token)</label><input class="cmd-in mono v-alg" aria-label="Accepted algorithms">' +
          '<label class="pg-l">Key: a JWK (public key, or <code>{"kty":"oct",…}</code>), or for HS256 just the secret text</label><textarea class="cmd-in mono v-key" rows="4" spellcheck="false" aria-label="Key"></textarea>' +
          '<label class="pg-l">Issuer you expect (optional)</label><input class="cmd-in mono v-iss" aria-label="Expected issuer">' +
          '<label class="pg-l">Audience you expect (optional)</label><input class="cmd-in mono v-aud" aria-label="Expected audience">' +
          '<div class="v-out" aria-live="polite"></div>' +
          '<h4>Change it and sign again (HS256, HS384, HS512)</h4><textarea class="cmd-in mono v-edit" rows="5" spellcheck="false" aria-label="Payload to sign"></textarea><button type="button" class="copy v-sign">Sign with the key above</button><p class="v-msg"></p>';
        var inputs = $$('.v-alg, .v-key, .v-iss, .v-aud', ver);
        inputs.forEach(function (i) { i.addEventListener('input', check); });
        $('.v-sign', ver).addEventListener('click', resign);
        $('.v-alg', ver).value = p.header.alg && p.header.alg !== 'none' ? p.header.alg : '';
        $('.v-edit', ver).value = JSON.stringify(p.payload, null, 2);
        if (/^HS/.test(p.header.alg || '') && tok.dataset.example) $('.v-key', ver).value = secret;
      }
      check();
    }
    async function check() {
      var out = $('.v-out', ver); if (!out) return;
      var p = C.parse(tok.value), key;
      try { key = keyFrom($('.v-key', ver).value, p.header && p.header.kid); } catch (e) { out.innerHTML = '<p class="cmd-bad">The key problem: ' + esc(e.message) + '</p>'; return; }
      if (!key) { out.innerHTML = '<p class="tool-note">Enter a key to check the signature.</p>'; return; }
      var algs = $('.v-alg', ver).value.split(/[\s,]+/).filter(Boolean);
      var r = await C.verify(tok.value, { algorithms: algs, key: key, issuer: $('.v-iss', ver).value || undefined, audience: $('.v-aud', ver).value || undefined });
      out.innerHTML = '<ul class="cmd-tok">' + r.checks.map(function (c) { return '<li><code>' + (c.ok ? '✓' : '✗') + ' ' + esc(c.name) + '</code><span>' + esc(c.detail) + '</span></li>'; }).join('') + '</ul><p class="' + (r.ok ? 'cmd-ok' : 'cmd-bad') + '">' + (r.ok ? '✓ An API would accept this token.' : '✗ An API would reject this token.') + '</p>';
    }
    async function resign() {
      var msg = $('.v-msg', ver);
      try {
        var p = C.parse(tok.value), payload = JSON.parse($('.v-edit', ver).value), key = keyFrom($('.v-key', ver).value, p.header && p.header.kid);
        if (!/^HS(256|384|512)$/.test(p.header.alg)) throw new Error('Only HS256, HS384 and HS512 tokens can be signed here, because they use a secret you hold.');
        if (!key || key.kty !== 'oct') throw new Error('Enter the secret first.');
        tok.value = await C.sign(p.header, payload, key); msg.textContent = 'Signed. The token above is the new one.'; render();
      } catch (e) { msg.textContent = e.message; }
    }
    ex.addEventListener('click', async function () {
      var now = Math.floor(Date.now() / 1000);
      tok.value = await C.sign({ alg: 'HS256', typ: 'JWT' }, { iss: 'https://login.lab.test', sub: 'alice', aud: 'todo-api', iat: now, exp: now + 3600, scope: 'todos.read' }, { kty: 'oct', k: C.b64uEnc(C.utf8(secret)) });
      tok.dataset.example = '1'; ver.innerHTML = ''; render();
      var k = $('.v-key', ver); if (k) { k.value = secret; check(); }
    });
    tok.addEventListener('input', function () { ver.innerHTML = ''; delete tok.dataset.example; render(); });
  }

  function toolCert(root) {
    root.innerHTML = '';
    var q = el('div', 'tool cert');
    var ta = el('textarea', 'cmd-in mono'); ta.rows = 8; ta.spellcheck = false; ta.setAttribute('aria-label', 'Certificates in PEM form'); ta.placeholder = '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n(paste one or more; a chain can be pasted whole)';
    var host = el('input', 'cmd-in mono'); host.setAttribute('aria-label', 'Host name to check'); host.placeholder = 'todo.example.com (optional: a host name to test)';
    var out = el('div', 'tool-out');
    q.appendChild(el('label', 'pg-l', 'Certificates (they stay in this page)')); q.appendChild(ta); q.appendChild(el('label', 'pg-l', 'Does the leaf cover this name?')); q.appendChild(host); q.appendChild(out); root.appendChild(q);
    async function render() {
      if (!ta.value.trim()) { out.innerHTML = ''; return; }
      var all;
      try { all = X.parseAll(ta.value); } catch (e) { out.innerHTML = '<p class="cmd-bad">' + esc(e.message) + '</p>'; return; }
      if (!all.certs.length) { out.innerHTML = '<p class="cmd-bad">No certificate found. A certificate starts with <code>-----BEGIN CERTIFICATE-----</code>.' + (all.ignored.length ? ' (Ignored: ' + esc(all.ignored.join(', ')) + '. Never paste a private key into a web page.)' : '') + '</p>'; return; }
      var r;
      try { r = await X.checkChain(all.certs, { host: host.value.trim() || undefined }); } catch (e) { out.innerHTML = '<p class="cmd-bad">' + esc(e.message) + '</p>'; return; }
      var h = all.ignored.length ? '<p class="cmd-bad">Ignored: ' + esc(all.ignored.join(', ')) + '. Never paste a private key into a web page.</p>' : '';
      h += '<ol class="chain">';
      for (var i = 0; i < r.chain.length; i++) {
        var c = r.chain[i], st = r.steps[i], d = Math.round((c.notAfter - new Date()) / 86400000);
        var fp = C.hexEnc(await C.sha('SHA-256', c.der)).replace(/(..)(?=.)/g, '$1:');
        var key = c.publicKey.type === 'RSA' ? 'RSA ' + c.publicKey.bits + ' bits' : c.publicKey.type === 'EC' ? 'EC ' + c.publicKey.curve : c.publicKey.type;
        var rows = [
          ['Subject', c.subject.text], ['Issuer', c.issuer.text],
          ['Valid', c.notBefore.toISOString().slice(0, 10) + ' to ' + c.notAfter.toISOString().slice(0, 10) + (d >= 0 ? ' (' + d + ' days left)' : ' (expired ' + (-d) + ' days ago)')],
          ['Public key', key], ['Signature', c.signatureAlgorithm.name],
          ['Names (SAN)', c.san.dns.concat(c.san.ip).join(', ') || 'none'],
          ['CA', c.basicConstraints ? (c.basicConstraints.ca ? 'yes' + (c.basicConstraints.pathLen !== null ? ', path length ' + c.basicConstraints.pathLen : '') : 'no') : 'not stated'],
          ['Key usage', (c.keyUsage || []).join(', ') || 'not stated'], ['Extended key usage', (c.extKeyUsage || []).join(', ') || 'not stated'],
          ['SHA-256 fingerprint', fp], ['Serial', c.serial],
        ];
        if (c.notDecoded.length) rows.push(['Not decoded', c.notDecoded.join(', ')]);
        var probs = r.problems.filter(function (p) { return p.cert === i; });
        h += '<li><div class="cert-head"><b>' + esc(st.role) + '</b> ' + esc(c.subject.text) + '</div><dl class="cert-f">' + rows.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' +
          (st.signature ? '<p class="' + (st.signature.ok ? 'cmd-ok' : 'cmd-bad') + '">' + (st.signature.ok ? '✓ Signed by ' + esc(st.signedBy) + (st.signedBy === 'itself' ? ' (a root certificate vouches for itself; trust comes from your trust store)' : '') : '✗ ' + esc(st.signature.reason)) + '</p>' : '<p class="tool-note">Its issuer was not supplied, so its signature cannot be checked.</p>') +
          probs.map(function (p) { return '<p class="cmd-bad">' + (p.level === 'warn' ? '! ' : '✗ ') + 'This certificate ' + esc(p.text) + '</p>'; }).join('') + '</li>';
      }
      h += '</ol>';
      if (r.extra.length) h += '<p class="tool-note">' + r.extra.length + ' pasted certificate(s) are not part of this chain.</p>';
      h += '<p class="' + (r.ok ? 'cmd-ok' : 'cmd-bad') + '">' + (r.ok ? '✓ The chain is complete and every link checks out' : '✗ Problems found') + '. Whether a root is <em>trusted</em> depends on the trust store of the program that checks it.</p>';
      out.innerHTML = h;
    }
    ta.addEventListener('input', render); host.addEventListener('input', render);
  }

  function toolPkce(root) {
    root.innerHTML = '';
    var q = el('div', 'tool pkce');
    q.innerHTML = '<label class="pg-l">code_verifier (43 to 128 characters: letters, digits, <code>-._~</code>)</label><input class="cmd-in mono p-ver" aria-label="code verifier">' +
      '<div class="lab-bar"><button type="button" class="copy p-gen">Make a random one</button></div>' +
      '<label class="pg-l">code_challenge (S256: base64url of the SHA-256 of the verifier)</label><input class="cmd-in mono p-ch" readonly aria-label="code challenge">' +
      '<p class="p-msg"></p><h4>base64url</h4><label class="pg-l">Text</label><input class="cmd-in mono p-txt" aria-label="Text to encode"><label class="pg-l">Encoded</label><input class="cmd-in mono p-enc" aria-label="Base64url text">';
    root.appendChild(q);
    var ver = $('.p-ver', q), ch = $('.p-ch', q), msg = $('.p-msg', q), txt = $('.p-txt', q), enc = $('.p-enc', q);
    async function update() {
      var v = ver.value;
      if (!v) { ch.value = ''; msg.textContent = ''; return; }
      ch.value = await C.pkceChallenge(v);
      var okChars = /^[A-Za-z0-9\-._~]+$/.test(v), okLen = v.length >= 43 && v.length <= 128;
      msg.className = 'p-msg ' + (okChars && okLen ? 'cmd-ok' : 'cmd-bad');
      msg.textContent = okChars && okLen ? '✓ This is a valid code_verifier.' : !okChars ? '✗ A code_verifier may only contain letters, digits and - . _ ~' : '✗ A code_verifier is 43 to 128 characters; this is ' + v.length + '.';
    }
    $('.p-gen', q).addEventListener('click', function () { ver.value = C.pkceVerifier(); update(); });
    ver.addEventListener('input', update);
    txt.addEventListener('input', function () { enc.value = C.b64uEnc(C.utf8(txt.value)); enc.classList.remove('bad'); });
    enc.addEventListener('input', function () { try { txt.value = C.fromUtf8(C.b64uDec(enc.value)); enc.classList.remove('bad'); } catch (e) { enc.classList.add('bad'); } });
  }

  function toolTotp(root) {
    root.innerHTML = '';
    var q = el('div', 'tool totp');
    q.innerHTML = '<label class="pg-l">Shared secret (base32, as in a QR code)</label><input class="cmd-in mono t-sec" aria-label="Base32 secret"><div class="t-out" aria-live="off"></div>';
    root.appendChild(q);
    var sec = $('.t-sec', q), out = $('.t-out', q);
    var raw = C.random(20); sec.value = (function () { var s = '', bits = 0, v = 0, A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; raw.forEach(function (b) { v = (v << 8) | b; bits += 8; while (bits >= 5) { s += A[(v >>> (bits - 5)) & 31]; bits -= 5; } }); return s; })();
    async function tick() {
      var t = Math.floor(Date.now() / 1000), left = 30 - (t % 30);
      try { var code = await C.totp(C.b32Dec(sec.value), t); out.innerHTML = '<p class="t-code">' + esc(code.slice(0, 3) + ' ' + code.slice(3)) + '</p><p>Changes in ' + left + ' seconds. The code is HMAC-SHA-1 of the 30-second counter <code>' + Math.floor(t / 30) + '</code>, cut to 6 digits (RFC 6238).</p>'; }
      catch (e) { out.innerHTML = '<p class="cmd-bad">That is not a base32 secret (letters A to Z and digits 2 to 7).</p>'; }
    }
    tick(); var timer = setInterval(function () { if (!document.body.contains(q)) { clearInterval(timer); return; } tick(); }, 1000);
  }


  function toolCookie(root) {
    var K = window.IACookie;
    root.innerHTML = '';
    var q = el('div', 'tool cookie');
    q.innerHTML = '<div class="ck-form">' +
      '<label>Name <input class="cmd-in mono ck-name" value="session" aria-label="Cookie name"></label>' +
      '<label>SameSite <select class="ck-ss" aria-label="SameSite"><option value="">not set</option><option>Strict</option><option selected>Lax</option><option>None</option></select></label>' +
      '<label>Path <input class="cmd-in mono ck-path" value="/" aria-label="Path"></label>' +
      '<label class="ck-b"><input type="checkbox" class="ck-sec" checked> Secure</label>' +
      '<label class="ck-b"><input type="checkbox" class="ck-ho" checked> HttpOnly</label>' +
      '<label class="ck-b"><input type="checkbox" class="ck-dom"> Domain=example.com</label>' +
      '</div><p class="ck-hdr"></p><div class="ck-msg"></div><div class="table-wrap"><table><thead><tr><th>What happens</th><th>Cookie sent?</th><th>Why</th></tr></thead><tbody class="ck-rows"></tbody></table></div><p class="ck-js"></p>';
    root.appendChild(q);
    function cookie() { return { name: $('.ck-name', q).value || 'session', sameSite: $('.ck-ss', q).value, secure: $('.ck-sec', q).checked, httpOnly: $('.ck-ho', q).checked, domain: $('.ck-dom', q).checked ? 'example.com' : null, path: $('.ck-path', q).value || '/' }; }
    function render() {
      var c = cookie();
      var hdr = 'Set-Cookie: ' + c.name + '=3f9a…; Path=' + c.path + (c.domain ? '; Domain=' + c.domain : '') + (c.secure ? '; Secure' : '') + (c.httpOnly ? '; HttpOnly' : '') + (c.sameSite ? '; SameSite=' + c.sameSite : '');
      $('.ck-hdr', q).innerHTML = '<code>' + esc(hdr) + '</code><br><span class="tool-note">set by <code>https://app.example.com</code></span>';
      var acc = K.accepted(c), msg = $('.ck-msg', q);
      msg.innerHTML = acc.ok ? (c.sameSite === 'None' && !c.secure ? '<p class="cmd-bad">SameSite=None must be used together with Secure (MDN). Browsers may handle this differently, so always set both.</p>' : '') : '<p class="cmd-bad">✗ The browser refuses to store this cookie: ' + esc(acc.problems.join('; ')) + '.</p>';
      $('.ck-rows', q).innerHTML = K.SCENARIOS.map(function (s) {
        var r = K.sent(c, s);
        return '<tr class="' + (r.sent ? 'sent' : 'blocked') + '"><td><b>' + esc(s.label) + '</b><br><span class="tool-note">' + esc(s.detail) + '</span></td><td>' + (r.sent ? '✓ sent' : '✗ not sent') + '</td><td>' + esc(r.why) + '</td></tr>';
      }).join('');
      $('.ck-js', q).innerHTML = c.httpOnly ? '<b>Script on the page</b> cannot read this cookie (<code>document.cookie</code> does not show it), but the browser still sends it with requests the script makes.' : '<b>Script on the page can read this cookie</b> with <code>document.cookie</code>. If an attacker runs script in your page, the cookie leaves with it.';
    }
    $$('input, select', q).forEach(function (i) { i.addEventListener('input', render); i.addEventListener('change', render); });
    render();
  }

  function toolCrypto(root) {
    root.innerHTML = '';
    var q = el('div', 'tool crypto');
    q.innerHTML = '<label class="pg-l">Message</label><textarea class="cmd-in mono c-msg" rows="2" spellcheck="false" aria-label="Message">pay alice 10</textarea>' +
      '<h4>1. A hash: the same input always gives the same fingerprint</h4><div class="c-hash"></div>' +
      '<h4>2. A MAC: a hash that also needs a shared secret</h4><label class="pg-l">Shared secret</label><input class="cmd-in mono c-key" value="correct horse" aria-label="Shared secret"><div class="c-mac"></div>' +
      '<h4>3. A signature: made with a private key, checked with the public key</h4><div class="lab-bar"><button type="button" class="copy c-gen">Make a key pair</button><button type="button" class="copy c-sign">Sign the message</button></div><div class="c-sig tool-note">Make a key pair first.</div>';
    root.appendChild(q);
    var msg = $('.c-msg', q), key = $('.c-key', q), pair = null, sig = null, signedText = null;
    async function hashes() {
      var m = msg.value, out = '';
      for (var a of ['SHA-256', 'SHA-512']) out += '<p><b>' + a + '</b><br><code class="wrap">' + C.hexEnc(await C.sha(a, m)) + '</code></p>';
      $('.c-hash', q).innerHTML = out + '<p class="tool-note">Change one letter of the message and every digit changes.</p>';
      $('.c-mac', q).innerHTML = '<p><b>HMAC-SHA-256</b><br><code class="wrap">' + C.hexEnc(await C.hmac('SHA-256', key.value, m)) + '</code></p><p class="tool-note">Without the secret, nobody can make this value for a message they choose.</p>';
      await verifyNow();
    }
    async function verifyNow() {
      var box = $('.c-sig', q);
      if (!pair) { box.textContent = 'Make a key pair first.'; return; }
      if (!sig) { box.textContent = 'Key pair ready (ECDSA P-256). Now sign the message.'; return; }
      var ok = await window.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, C.utf8(msg.value));
      box.innerHTML = '<p><b>Signature</b><br><code class="wrap">' + C.b64uEnc(new Uint8Array(sig)) + '</code></p><p class="' + (ok ? 'cmd-ok' : 'cmd-bad') + '">' + (ok ? '✓ The public key confirms this signature belongs to this exact message.' : '✗ The message is not the one that was signed' + (signedText !== null ? ' (it was “' + esc(signedText) + '”)' : '') + '. Verification fails.') + '</p>';
    }
    $('.c-gen', q).addEventListener('click', async function () { pair = await window.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']); sig = null; signedText = null; verifyNow(); });
    $('.c-sign', q).addEventListener('click', async function () { if (!pair) { $('.c-sig', q).textContent = 'Make a key pair first.'; return; } sig = await window.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, C.utf8(msg.value)); signedText = msg.value; verifyNow(); });
    msg.addEventListener('input', hashes); key.addEventListener('input', hashes);
    hashes();
  }


  function toolFlow(root) {
    var F = window.IAFlow;
    root.innerHTML = '';
    var q = el('div', 'tool flow');
    q.innerHTML = '<div class="ck-form"><label class="ck-b"><input type="checkbox" class="f-pkce" checked> PKCE (code_challenge)</label><label class="ck-b"><input type="checkbox" class="f-state" checked> state</label><label class="ck-b"><input type="checkbox" class="f-iss" checked> iss in the response</label><button type="button" class="copy f-new">New random values</button></div><div class="f-body"></div>';
    root.appendChild(q);
    var body = $('.f-body', q);
    var CH = { front: 'front channel (through the browser)', back: 'back channel (server to server)', user: 'you', browser: 'your browser', api: 'API call' };
    async function render() {
      var f = await F.build({ pkce: $('.f-pkce', q).checked, state: $('.f-state', q).checked, iss: $('.f-iss', q).checked });
      var h = '<ol class="flow-steps">' + f.steps.map(function (s) {
        return '<li class="fs ' + s.channel + '"><div class="fs-h"><span class="fs-n">' + s.n + '</span><b>' + esc(s.title) + '</b><span class="lvl-chip">' + esc(CH[s.channel]) + '</span></div><p class="tool-note">' + esc(s.from) + ' → ' + esc(s.to) + '</p><pre class="ex-art">' + esc(s.http) + '</pre><p>' + s.note + '</p></li>';
      }).join('') + '</ol><h4>What an attacker can do</h4>' + f.attacks.map(function (a) {
        return '<div class="atk-card ' + (a.on ? 'good' : 'bad') + '"><b>' + esc(a.name) + '</b> <span class="lvl-chip">' + esc(a.protection) + (a.on ? ' on' : ' OFF') + '</span><p>' + a.story + '</p><p>' + (a.on ? '✓ ' + a.with : '✗ ' + a.without) + '</p></div>';
      }).join('');
      body.innerHTML = h;
    }
    $$('input', q).forEach(function (i) { i.addEventListener('change', render); });
    $('.f-new', q).addEventListener('click', render);
    render();
  }

  function toolGrant(root) {
    var F = window.IAFlow;
    root.innerHTML = '';
    var q = el('div', 'tool grant');
    q.innerHTML = '<label class="pg-l">Is a person signing in?</label><select class="g-user" aria-label="Is a person signing in?"><option value="1">Yes, a person</option><option value="0">No, a program on its own behalf</option></select>' +
      '<label class="pg-l">What can the device do?</label><select class="g-dev" aria-label="What can the device do?"><option value="full">It has a browser and a keyboard</option><option value="limited">No browser or no keyboard (TV, CLI on a server, printer)</option></select>' +
      '<div class="g-out" aria-live="polite"></div>';
    root.appendChild(q);
    function render() {
      var hasUser = $('.g-user', q).value === '1', dev = $('.g-dev', q).value;
      var r = F.chooseGrant({ hasUser: hasUser, device: hasUser ? dev : 'full' });
      $('.g-dev', q).disabled = !hasUser;
      $('.g-out', q).innerHTML = '<p class="cmd-ok">Use: <b>' + esc(r.title) + '</b> (<code>grant_type</code> <code>' + esc(r.grant) + '</code>)</p><p>' + esc(r.why) + '</p>';
    }
    $$('select', q).forEach(function (i) { i.addEventListener('change', render); });
    render();
  }

  // Sign in with Google, by hand: build the request, get sent to Google, come back, and see what Google returned.
  function toolGoogle(root) {
    root.innerHTML = '';
    var q = el('div', 'tool google'), KEY = 'ia-google';
    var redirect = location.origin + location.pathname;
    q.innerHTML = '<p class="tool-note">Nothing here is sent anywhere except to <code>accounts.google.com</code>, when you press <b>Open Google</b>.</p>' +
      '<label class="pg-l">Your client ID (from Google Cloud, step 1)</label><input class="cmd-in mono gg-id" placeholder="123456789012-abc….apps.googleusercontent.com" aria-label="Google client ID">' +
      '<label class="pg-l">The redirect URI you registered (must match exactly)</label><input class="cmd-in mono" readonly value="' + esc(redirect) + '" aria-label="Redirect URI">' +
      '<div class="lab-bar"><button type="button" class="copy gg-build">Build the sign-in address</button></div><div class="gg-url"></div><div class="gg-back"></div>';
    root.appendChild(q);
    var saved = null; try { saved = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) {}
    if (saved && saved.client_id) $('.gg-id', q).value = saved.client_id;
    $('.gg-build', q).addEventListener('click', async function () {
      var id = $('.gg-id', q).value.trim(), out = $('.gg-url', q);
      if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) { out.innerHTML = '<p class="cmd-bad">That does not look like a Google client ID: it ends with <code>.apps.googleusercontent.com</code>.</p>'; return; }
      var v = C.pkceVerifier(), ch = await C.pkceChallenge(v), st = C.b64uEnc(C.random(16)), no = C.b64uEnc(C.random(16));
      try { sessionStorage.setItem(KEY, JSON.stringify({ client_id: id, verifier: v, state: st, nonce: no, redirect: redirect })); } catch (e) {}
      var p = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state: st, nonce: no, code_challenge: ch, code_challenge_method: 'S256' });
      var url = 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
      out.innerHTML = '<p>Your request, parameter by parameter:</p><div class="table-wrap"><table><tbody>' + Array.from(p.entries()).map(function (kv) { return '<tr><td><code>' + esc(kv[0]) + '</code></td><td><code>' + esc(kv[1]) + '</code></td></tr>'; }).join('') + '</tbody></table></div><p><a class="copy" href="' + esc(url) + '">Open Google</a></p>';
    });
    // coming back from Google
    var sp = new URLSearchParams(location.search);
    if (saved && (sp.has('code') || sp.has('error'))) {
      var box = $('.gg-back', q), h = '';
      if (sp.has('error')) h = '<p class="cmd-bad">Google answered with an error: <code>' + esc(sp.get('error')) + '</code> ' + esc(sp.get('error_description') || '') + '</p>';
      else {
        var okState = sp.get('state') === saved.state;
        h = '<h4>You are back</h4><p class="' + (okState ? 'cmd-ok' : 'cmd-bad') + '">' + (okState ? '✓ The <code>state</code> matches the one this browser made, so this answer belongs to your request.' : '✗ The <code>state</code> does not match. Do not use this response.') + '</p>' +
          '<p>Google gave you a one-time <code>code</code>:</p><pre class="ex-art">' + esc(sp.get('code')) + '</pre><p>Exchange it from your terminal, where your client secret is. The page never sees the secret:</p>' +
          '<pre class="ex-art">' + esc('curl https://oauth2.googleapis.com/token \\\n  -d client_id=' + saved.client_id + ' \\\n  -d client_secret="$GOOGLE_CLIENT_SECRET" \\\n  -d grant_type=authorization_code \\\n  -d code=' + sp.get('code') + ' \\\n  -d redirect_uri=' + saved.redirect + ' \\\n  -d code_verifier=' + saved.verifier) + '</pre><p class="tool-note">Your <code>nonce</code> is <code>' + esc(saved.nonce) + '</code>. It must be inside the ID token you get back (step 14).</p>';
      }
      box.innerHTML = h;
      try { history.replaceState(null, '', location.pathname + '#google'); } catch (e) {}
      setTimeout(function () { q.scrollIntoView({ block: 'start' }); }, 300);
    }
  }

  var TOOLS = { flow: toolFlow, grant: toolGrant, google: toolGoogle, jwt: toolJwt, cert: toolCert, pkce: toolPkce, totp: toolTotp, cookie: toolCookie, crypto: toolCrypto };
  function mountTool(root) { var f = TOOLS[root.getAttribute('data-tool')]; if (f) f(root); }

  function init() {
    $$('[data-ex]').forEach(mountExercise);
    $$('[data-cmd]').forEach(mountCmd);
    $$('[data-url]').forEach(mountUrl);
    $$('[data-tool]').forEach(mountTool);
    renderProgress(); syncTicks();
  }
  window.IAUI = { init: init, mountExercise: mountExercise, mountCmd: mountCmd, mountTool: mountTool, syncTicks: syncTicks, renderProgress: renderProgress };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
