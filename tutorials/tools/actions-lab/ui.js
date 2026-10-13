// The interactive parts of the GitHub Actions lab: the editor with live checking, the run preview, and the drills.
// It uses GA (engine.js), js-yaml, and the real actionlint, compiled to WebAssembly and loaded when you first type.
(function () {
  'use strict';
  var GA = window.GA, yaml = window.jsyaml;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = GA.escHtml;
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

  // ------------------------------------------------------------------ the checker (actionlint in WebAssembly)
  var Checker = {
    state: 'idle', queue: [], cache: {}, listeners: [],
    onState: function (fn) { this.listeners.push(fn); fn(this.state); },
    set: function (s) { this.state = s; this.listeners.forEach(function (f) { f(s); }); },
    init: function () {
      var self = this;
      if (self.state !== 'idle') return;
      self.set('loading');
      var blob = $('#al-wasm');
      if (!blob || typeof DecompressionStream === 'undefined' || typeof WebAssembly === 'undefined' || typeof Go === 'undefined') { self.set('unavailable'); return; }
      var bin = atob(blob.textContent.replace(/\s+/g, ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().then(function (buf) {
        var go = new Go();
        return WebAssembly.instantiate(buf, go.importObject).then(function (r) {
          go.run(r.instance);
          var t0 = Date.now();
          (function wait() { if (window.lintReady) { self.set('ready'); } else if (Date.now() - t0 > 5000) self.set('unavailable'); else setTimeout(wait, 20); })();
        });
      }).catch(function () { self.set('unavailable'); });
    },
    lint: function (text) {
      if (this.state !== 'ready') return null;
      if (this.cache[text] !== undefined) return this.cache[text];
      var out = JSON.parse(window.lintWorkflow(text));
      if (!Array.isArray(out)) out = [{ line: 1, column: 1, kind: 'internal', message: 'The checker could not read this: ' + (out.fatal || 'unknown error') }];
      if (Object.keys(this.cache).length > 200) this.cache = {};
      return (this.cache[text] = out);
    },
  };
  window.GAChecker = Checker;

  function parseWorkflow(text) {
    try { return { doc: yaml.load(text) }; }
    catch (e) {
      var m = e.mark || {};
      var msg = String(e.reason || e.message || 'The YAML could not be read');
      if (/tab/i.test(msg) || /\t/.test(text.split('\n')[m.line] || '')) msg = 'Tabs are not allowed in YAML. Indent with spaces.';
      return { error: { line: (m.line || 0) + 1, column: (m.column || 0) + 1, message: msg, kind: 'yaml-syntax' } };
    }
  }

  // ------------------------------------------------------------------ plain-English versions of actionlint's messages
  var FRIENDLY = [
    [/"runs-on" section is missing in job "([^"]+)"/, function (m) { return 'Job <code>' + m[1] + '</code> has no <code>runs-on</code>. Every job needs to say what kind of machine runs it, for example <code>runs-on: ubuntu-latest</code>.'; }],
    [/job "([^"]+)" needs job "([^"]+)" which does not exist/, function (m) { return '<code>needs: ' + m[2] + '</code> in job <code>' + m[1] + '</code> names a job that is not in this file. <code>needs</code> takes the job id (the key under <code>jobs:</code>), so check the spelling.'; }],
    [/"steps" section is missing in job "([^"]+)"/, function (m) { return 'Job <code>' + m[1] + '</code> has no <code>steps</code>. A job is a list of steps, and each step runs a command or an action.'; }],
    [/step must run script with "run" section or run action with "uses" section/, function () { return 'A step must do something: give it <code>run:</code> (a shell command) or <code>uses:</code> (an action), and not neither.'; }],
    [/"on" section is missing in workflow/, function () { return 'The workflow has no <code>on:</code> section, so nothing would ever start it. Say which events start it, for example <code>on: push</code>.'; }],
    [/"jobs" section is missing in workflow/, function () { return 'The workflow has no <code>jobs:</code> section, so there is nothing to run.'; }],
    [/"([^"]+)" job should not be empty/, function (m) { return 'Job <code>' + m[1] + '</code> has nothing under it yet. Give it <code>runs-on</code> and <code>steps</code>.'; }],
    [/unexpected key "([^"]+)" for "([^"]+)" section\. expected one of (.*)/, function (m) { return '<code>' + m[1] + '</code> is not a valid key in this place (' + m[2] + '). The keys allowed here are: ' + m[3] + '.'; }],
    [/unknown Webhook event "([^"]+)"\. see https/, function (m) { return '<code>' + m[1] + '</code> is not an event GitHub knows. Check the spelling of the trigger under <code>on:</code>.'; }],
    [/property "([^"]+)" is not defined in object type/, function (m) { return '<code>' + m[1] + '</code> does not exist in that context. A typo in a <code>${{ }}</code> expression gives an empty value silently on GitHub, which is why this check matters.'; }],
    [/input "([^"]+)" is not defined in action "([^"]+)"/, function (m) { return 'The action <code>' + m[2] + '</code> has no input called <code>' + m[1] + '</code>. Inputs go under <code>with:</code> and are spelled exactly as the action defines them.'; }],
    [/missing input "([^"]+)" which is required by action "([^"]+)"/, function (m) { return 'The action <code>' + m[2] + '</code> needs an input called <code>' + m[1] + '</code>, and you have not set it under <code>with:</code>.'; }],
    [/"([^"]+)" is potentially untrusted/, function (m) { return '<code>' + m[1] + '</code> is text that people outside your team can write. Pasted into a script, it can run as a command. Pass it through <code>env</code> and read it as a shell variable (<code>"$NAME"</code>).'; }],
    [/if: condition .* is always evaluated to true/, function () { return 'This <code>if</code> is always true. When text surrounds <code>${{ }}</code>, the whole thing becomes a non-empty string, and any non-empty string is true. Write the whole condition inside one <code>${{ }}</code>, or leave the braces off.'; }],
    [/permissions|scope "([^"]+)"/, function () { return null; }],
    [/unknown permission scope "([^"]+)"/, function (m) { return '<code>' + m[1] + '</code> is not a permission scope for <code>GITHUB_TOKEN</code>. Check the spelling.'; }],
    [/shell name "([^"]+)" is invalid/, function (m) { return '<code>shell: ' + m[1] + '</code> is not a shell GitHub knows. Use <code>bash</code>, <code>pwsh</code>, <code>python</code>, <code>sh</code>, <code>cmd</code> or <code>powershell</code>.'; }],
    [/label "([^"]+)" is unknown/, function (m) { return '<code>' + m[1] + '</code> is not a runner label GitHub provides. For GitHub-hosted runners use labels such as <code>ubuntu-latest</code>; for your own runners the label must be one you registered.'; }],
    [/duplicate/i, function () { return null; }],
    [/context "([^"]+)" is not allowed here/, function (m) { return 'You cannot use the <code>' + m[1] + '</code> context in this place. Which contexts work where is listed in GitHub\'s "context availability" table.'; }],
  ];
  function friendly(p) {
    if (p.kind === 'yaml-syntax') return { text: esc(p.message), raw: null };
    for (var i = 0; i < FRIENDLY.length; i++) {
      var m = FRIENDLY[i][0].exec(p.message);
      if (m) { var t = FRIENDLY[i][1](m); if (t) return { text: t, raw: p.message }; }
    }
    return { text: esc(p.message.length > 240 ? p.message.slice(0, 240) + '…' : p.message), raw: null };
  }

  // ------------------------------------------------------------------ the editor
  function makeEditor(initial, onChange, hooks) {
    hooks = hooks || {};
    var wrap = el('div', 'ed');
    var gut = el('div', 'ed-gut'), hl = el('div', 'ed-hl'), ta = el('textarea', 'ed-ta');
    ta.value = initial; ta.spellcheck = false; ta.setAttribute('wrap', 'off'); ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('aria-label', 'Workflow YAML editor');
    wrap.appendChild(gut); var body = el('div', 'ed-body'); body.appendChild(hl); body.appendChild(ta); wrap.appendChild(body);
    var lines = 0;
    function layout() {
      var n = ta.value.split('\n').length;
      if (n !== lines) {
        lines = n;
        var g = '', h = '';
        for (var i = 1; i <= Math.max(n, 12); i++) { g += '<div>' + i + '</div>'; h += '<div class="l" data-l="' + i + '">&nbsp;</div>'; }
        gut.innerHTML = g; hl.innerHTML = h;
      }
      var rows = Math.max(12, Math.min(n + 1, 34));
      ta.style.height = (rows * 21 + 16) + 'px';
      gut.style.boxSizing = 'border-box'; gut.style.height = ta.style.height;   // a long file scrolls inside the editor, and the line numbers scroll with it
      sync();
    }
    function sync() { gut.scrollTop = ta.scrollTop; hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
    ta.addEventListener('scroll', sync);
    ta.addEventListener('input', function () { layout(); onChange(); });
    ['keyup', 'click', 'focus'].forEach(function (ev) { ta.addEventListener(ev, function () { if (hooks.caret) hooks.caret(); }); });
    ta.addEventListener('keydown', function (e) {
      if ((e.key === ' ' || e.code === 'Space') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (hooks.complete) hooks.complete(); return; }
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        var s = ta.selectionStart, en = ta.selectionEnd;
        if (e.shiftKey) {
          var ls = ta.value.lastIndexOf('\n', s - 1) + 1;
          if (ta.value.slice(ls, ls + 2) === '  ') { ta.setSelectionRange(ls, ls + 2); insert(''); ta.setSelectionRange(Math.max(ls, s - 2), Math.max(ls, en - 2)); }
        } else insert('  ');
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
        var pos = ta.selectionStart, ls2 = ta.value.lastIndexOf('\n', pos - 1) + 1, line = ta.value.slice(ls2, pos);
        var ind = /^ */.exec(line)[0], extra = /:\s*$/.test(line) || /^\s*-\s*$/.test(line) ? '  ' : '';
        if (/^\s*-\s+\S/.test(line) && !/:\s*$/.test(line)) ind = ind + '  ';
        e.preventDefault(); insert('\n' + ind + extra);
      }
    });
    function insert(t) {
      ta.focus();
      var ok = false; try { ok = document.execCommand('insertText', false, t); } catch (e) {}
      if (!ok) { ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    }
    layout();
    return {
      el: wrap, ta: ta, get: function () { return ta.value; },
      replace: function (from, to, t) { ta.focus(); ta.setSelectionRange(from, to); insert(t); },
      set: function (v) { ta.value = v; layout(); onChange(); },
      mark: function (errLines, warnLines) {
        $$('.l', hl).forEach(function (d) { d.className = 'l'; });
        errLines.forEach(function (n) { var d = $('.l[data-l="' + n + '"]', hl); if (d) d.className = 'l err'; });
        $$('.ed-gut div', wrap).forEach(function (d, i) { d.className = errLines.indexOf(i + 1) >= 0 ? 'err' : ''; });
      },
      goto: function (line) {
        var parts = ta.value.split('\n'), pos = 0;
        for (var i = 0; i < line - 1 && i < parts.length; i++) pos += parts[i].length + 1;
        ta.focus(); ta.setSelectionRange(pos, pos + (parts[line - 1] || '').length);
        ta.scrollTop = Math.max(0, (line - 4) * 21);
      },
    };
  }

  // ------------------------------------------------------------------ the run preview
  var PRESETS = [
    { id: 'push-main', label: 'Push to main', ev: { name: 'push', ref: 'refs/heads/main', paths: ['src/api/Program.cs'] } },
    { id: 'push-feature', label: 'Push to feature/login', ev: { name: 'push', ref: 'refs/heads/feature/login', paths: ['src/api/Program.cs'] } },
    { id: 'pr', label: 'Pull request into main', ev: { name: 'pull_request', ref: 'refs/pull/7/merge', base_ref: 'main', head_ref: 'feature/login', action: 'opened', paths: ['src/api/Program.cs'] } },
    { id: 'tag', label: 'Push tag v1.2.0', ev: { name: 'push', ref: 'refs/tags/v1.2.0', paths: [] } },
    { id: 'docs', label: 'Push to main, docs only', ev: { name: 'push', ref: 'refs/heads/main', paths: ['docs/README.md'] } },
    { id: 'merge-queue', label: 'Pull request enters the merge queue', ev: { name: 'merge_group', ref: 'refs/heads/gh-readonly-queue/main/pr-7-3d3c42e', action: 'checks_requested' } },
    { id: 'manual', label: 'Run manually (workflow_dispatch)', ev: { name: 'workflow_dispatch', ref: 'refs/heads/main', inputs: {} } },
    { id: 'schedule', label: 'Scheduled run', ev: { name: 'schedule', ref: 'refs/heads/main' } },
  ];
  function renderPreview(box, doc, presetId, pathsText) {
    var preset = PRESETS.filter(function (p) { return p.id === presetId; })[0] || PRESETS[0];
    var ev = JSON.parse(JSON.stringify(preset.ev));
    if (pathsText !== undefined && ev.paths) ev.paths = pathsText.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var res = GA.simulate(doc, ev);
    var verdict = el('p', 'pv-verdict ' + (res.event.runs ? 'yes' : 'no'),
      (res.event.runs ? '▶ The workflow runs: ' : '■ The workflow does not run: ') + esc(res.event.reason));
    var graph = el('div', 'pv-graph');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'pv-lines'); graph.appendChild(svg);
    var cols = el('div', 'pv-cols');
    res.levels.forEach(function (ids) {
      var col = el('div', 'pv-col');
      ids.forEach(function (id) {
        var j = res.jobs.filter(function (x) { return x.id === id; })[0];
        var card = el('div', 'pv-job ' + j.status);
        card.setAttribute('data-id', id);
        var badges = '';
        if (j.matrix) badges += '<span class="pv-b">' + j.matrix.length + ' matrix job' + (j.matrix.length === 1 ? '' : 's') + '</span>';
        if (j.matrixUnknown) badges += '<span class="pv-b">matrix built at run time</span>';
        if (j.environment) badges += '<span class="pv-b gate">environment: ' + esc(j.environment) + '</span>';
        if (j.uses) badges += '<span class="pv-b">reusable workflow</span>';
        card.innerHTML = '<b>' + esc(j.name) + '</b>' + (j.runsOn ? '<small>' + esc(j.runsOn) + '</small>' : '') + badges +
          '<em>' + (j.status === 'run' ? '✓ runs' : j.status === 'skip' ? '– skipped' : '? depends') + '</em>' +
          '<span class="pv-why">' + esc(j.reason) + '</span>';
        col.appendChild(card);
      });
      cols.appendChild(col);
    });
    graph.appendChild(cols);
    box.innerHTML = '';
    box.appendChild(verdict);
    if (!res.jobs.length) { box.appendChild(el('p', 'pv-empty', 'There are no jobs to show yet.')); return; }
    box.appendChild(graph);
    if (res.problems.length) box.appendChild(el('p', 'pv-verdict no', esc(res.problems.join('; '))));
    requestAnimationFrame(function () {
      var gb = graph.getBoundingClientRect();
      svg.setAttribute('width', gb.width); svg.setAttribute('height', gb.height);
      var d = '';
      res.jobs.forEach(function (j) {
        j.needs.forEach(function (n) {
          var a = $('.pv-job[data-id="' + n + '"]', graph), b = $('.pv-job[data-id="' + j.id + '"]', graph);
          if (!a || !b) return;
          var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          var x1 = ra.right - gb.left, y1 = ra.top + ra.height / 2 - gb.top, x2 = rb.left - gb.left, y2 = rb.top + rb.height / 2 - gb.top, mx = (x1 + x2) / 2;
          d += '<path d="M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2 + '"/>';
        });
      });
      svg.innerHTML = d;
    });
  }
  function previewControls(box, getDoc, opts) {
    opts = opts || {};
    var wrap = el('div', 'pv');
    var bar = el('div', 'pv-bar');
    var sel = el('select', 'pv-sel'); sel.setAttribute('aria-label', 'Event to simulate');
    var allowed = opts.presets || PRESETS.map(function (p) { return p.id; });
    PRESETS.filter(function (p) { return allowed.indexOf(p.id) >= 0; }).forEach(function (p) { var o = el('option'); o.value = p.id; o.textContent = p.label; sel.appendChild(o); });
    if (opts.preset) sel.value = opts.preset;
    var paths = el('input', 'pv-paths'); paths.type = 'text'; paths.placeholder = 'changed files, comma separated'; paths.value = 'src/api/Program.cs';
    paths.setAttribute('aria-label', 'Changed files');
    bar.appendChild(el('label', null, 'If this happens on GitHub: ')); bar.appendChild(sel); bar.appendChild(paths);
    var out = el('div', 'pv-out');
    wrap.appendChild(bar); wrap.appendChild(out);
    function refresh() {
      var cur = PRESETS.filter(function (p) { return p.id === sel.value; })[0];
      paths.hidden = !(cur.ev.paths);
      if (cur.ev.paths && !paths.dataset.touched) paths.value = cur.ev.paths.join(', ');
      var doc = getDoc();
      if (!doc) { out.innerHTML = '<p class="pv-empty">Fix the YAML first, then the preview appears.</p>'; return; }
      try { renderPreview(out, doc, sel.value, cur.ev.paths ? paths.value : undefined); } catch (e) { out.innerHTML = '<p class="pv-empty">The preview could not be built: ' + esc(e.message) + '</p>'; }
    }
    sel.addEventListener('change', function () { delete paths.dataset.touched; refresh(); });
    paths.addEventListener('input', function () { paths.dataset.touched = '1'; refresh(); });
    box.appendChild(wrap);
    return { refresh: refresh };
  }

  // ------------------------------------------------------------------ one lab
  var labs = {};
  function mountLab(root) {
    var id = root.getAttribute('data-lab');
    var spec = GA.labs[id];
    if (!spec) { root.innerHTML = '<p class="pv-empty">Missing lab ' + esc(id) + '</p>'; return; }
    var saved = store.get('ga-lab:' + id) || {};
    // A lab has one file, or several (spec.files) shown as tabs. Every check names the file it reads.
    var multi = Array.isArray(spec.files);
    var files = multi ? spec.files : [{ name: null, starter: spec.starter || '', solution: spec.solution }];
    // Guided starts from the lesson's file; Empty starts from nothing, and you type every line. The choice is kept, per lab,
    // and the last choice is the default for labs you have not opened yet.
    var canChoose = !multi && !spec.scenario && id !== 'free' && (spec.starter || '').trim() !== '';
    var mode = canChoose ? (saved.mode || ((saved.code || '').trim() ? 'guided' : null) || store.get('ga-mode') || 'empty') : 'guided';
    var chosen = !!saved.mode;                 // false: this lab follows the last choice made anywhere on the page
    var starterOf = function (f) { return mode === 'empty' ? '' : (f.starter || ''); };
    var kindOf = function (i) { return files[i].assist || spec.assist || (spec.format === 'text' ? 'none' : 'workflow'); };
    var texts = files.map(function (f, i) {
      if (multi) return saved.files && saved.files[f.name] !== undefined ? saved.files[f.name] : (f.starter || '');
      return saved.code !== undefined ? saved.code : starterOf(f);
    });
    var active = 0;
    var hintsShown = 0, backup = null, revealed = false;
    root.innerHTML = '';
    root.classList.add('lab');
    var head = el('div', 'lab-head');
    head.innerHTML = '<span class="lab-tag">' + esc(spec.tag || 'Lab') + '</span><b>' + esc(spec.title) + '</b><span class="lab-lvl lvl-' + (spec.level || 1) + '">' + esc(['', 'Easy', 'Easy+', 'Medium', 'Hard', 'Expert'][spec.level || 1]) + '</span><span class="lab-status" aria-live="polite"></span>';
    root.appendChild(head);
    if (spec.scenario) root.appendChild(el('div', 'lab-scn', spec.scenario));
    var modeBar = null, modeBtns = {}, modeNote = null;
    if (canChoose) {
      modeBar = el('div', 'lab-mode', '<span class="lab-mode-l">Start from</span>');
      [['guided', 'Guided', 'The lesson\'s starting file: you add the new part'], ['empty', 'Empty', 'A blank file: you type every line']].forEach(function (m) {
        var b = el('button', 'lab-mode-b', m[1]); b.type = 'button'; b.title = m[2]; b.setAttribute('data-mode', m[0]);
        b.addEventListener('click', function () { setMode(m[0], b); });
        modeBar.appendChild(b); modeBtns[m[0]] = b;
      });
      modeNote = el('span', 'lab-mode-n'); modeBar.appendChild(modeNote);
      root.appendChild(modeBar);
    }
    root.appendChild(el('div', 'lab-task', spec.task));
    var blankNote = el('div', 'lab-blank'); blankNote.hidden = true; root.appendChild(blankNote);
    var tabs = null, tabBtns = [];
    if (multi) {
      tabs = el('div', 'lab-tabs'); tabs.setAttribute('role', 'tablist');
      files.forEach(function (f, i) {
        var b = el('button', 'lab-tab', '<span class="dot" aria-hidden="true"></span>' + esc(f.name));
        b.type = 'button'; b.setAttribute('role', 'tab');
        b.addEventListener('click', function () { show(i); });
        tabs.appendChild(b); tabBtns.push(b);
      });
      root.appendChild(tabs);
    }
    var main = el('div', 'lab-main');
    var side = el('div', 'lab-side');
    var reqList = el('ul', 'reqs'), probs = el('div', 'probs');
    side.appendChild(el('h4', null, 'Requirements')); side.appendChild(reqList);
    side.appendChild(el('h4', null, 'Problems found')); side.appendChild(probs);
    var assist = el('div', 'lab-assist'); assist.setAttribute('aria-live', 'off');
    var lastSuggest = null;
    function showAssist() {
      var kind = kindOf(active);
      if (kind === 'none' || !GA.suggest) { assist.hidden = true; return; }
      var ta = editor.ta, sg = null;
      if (ta.selectionStart === ta.selectionEnd) { try { sg = GA.suggest(ta.value, ta.selectionStart, kind); } catch (e) { sg = null; } }
      lastSuggest = sg;
      var ln = ta.value.slice(0, ta.selectionStart).split('\n').length;
      assist.innerHTML = '';
      if (!sg) { assist.appendChild(el('p', 'as-none', '<b>Line ' + ln + '.</b> Nothing to suggest here. Put the cursor where a key starts and the keys that fit are listed. <kbd>Ctrl</kbd>+<kbd>Space</kbd> types the first one.')); return; }
      assist.appendChild(el('p', 'as-head', '<b>Line ' + ln + ', ' + esc(sg.where) + '.</b> ' + (sg.value ? 'Values that fit:' : sg.items.length ? 'Keys that fit here:' : '') + (sg.free ? ' ' + esc(sg.free) : '')));
      var list = el('div', 'as-list');
      sg.items.slice(0, 24).forEach(function (it, i) {
        var b = el('button', 'as-item' + (i === 0 ? ' first' : ''), '<code>' + esc(it.label) + '</code><span>' + esc(it.desc) + '</span>');
        b.type = 'button';
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });      // keep the cursor in the editor
        b.addEventListener('click', function () { editor.replace(sg.from, sg.to, it.insert); showAssist(); });
        list.appendChild(b);
      });
      if (sg.items.length) assist.appendChild(list);
    }
    var editor = makeEditor(texts[0], function () { texts[active] = editor.get(); schedule(); showAssist(); }, {
      caret: showAssist,
      complete: function () { showAssist(); if (lastSuggest && lastSuggest.items.length) { var it = lastSuggest.items[0]; editor.replace(lastSuggest.from, lastSuggest.to, it.insert); } },
    });
    var edCol = el('div', 'lab-ed');
    edCol.appendChild(editor.el); edCol.appendChild(assist);
    main.appendChild(edCol); main.appendChild(side);
    root.appendChild(main);
    var bar = el('div', 'lab-bar');
    var bHint = el('button', null, 'Hint'), bNext = el('button', null, 'Next line'), bSol = el('button', null, 'Show solution'), bReset = el('button', null, 'Start over'), bCopy = el('button', null, 'Copy');
    bNext.title = 'Show only the next line this file still needs. Your text stays as it is.';
    bSol.title = 'Open the finished file under the editor. Your text stays as it is.';
    [bHint, bNext, bSol, bReset, bCopy].forEach(function (b) { b.type = 'button'; b.className = 'copy'; bar.appendChild(b); });
    if (spec.scenario || id === 'free') bNext.hidden = true;       // a fix scenario is about finding the line yourself
    if (id === 'free') { bSol.hidden = true; bHint.hidden = true; }
    var checker = el('span', 'lab-ck', ''); bar.appendChild(checker);
    root.appendChild(bar);
    var hintBox = el('div', 'lab-hint'); hintBox.hidden = true; root.appendChild(hintBox);
    var nextBox = el('div', 'lab-next'); nextBox.hidden = true; root.appendChild(nextBox);
    var solBox = el('div', 'lab-sol'); solBox.hidden = true; root.appendChild(solBox);
    var pvHost = el('div', 'lab-pv');
    var pvTitle = el('h4', null, 'What would run? <small>a preview of the run, from your YAML</small>');
    var curDoc = null;
    var pvc = previewControls(pvHost, function () { return curDoc; }, spec.preview);
    var pvWrap = el('div', 'lab-pvwrap'); pvWrap.appendChild(pvTitle); pvWrap.appendChild(pvHost); root.appendChild(pvWrap);
    var win = el('div', 'lab-win'); win.hidden = true; root.appendChild(win);

    function show(i) {
      texts[active] = editor.get();
      active = i;
      editor.set(texts[i]);            // triggers a check
      editor.ta.setAttribute('aria-label', multi ? 'Editor for ' + files[i].name : 'Workflow YAML editor');
      showAssist();
    }
    // The note under the task in Empty mode: what the guided file would have given, and where help is.
    function renderMode() {
      if (!canChoose) return;
      Object.keys(modeBtns).forEach(function (k) { modeBtns[k].classList.toggle('on', k === mode); modeBtns[k].setAttribute('aria-pressed', k === mode ? 'true' : 'false'); });
      modeNote.textContent = mode === 'empty' ? 'A blank file: you type every line.' : 'The lesson\'s starting file: you add the new part.';
      blankNote.hidden = mode !== 'empty';
      if (mode !== 'empty') return;
      var ids = [];
      try { var sd = spec.format === 'text' ? null : yaml.load(spec.solution); if (sd && sd.jobs && typeof sd.jobs === 'object') ids = Object.keys(sd.jobs); } catch (e) {}
      blankNote.innerHTML = '<p><b>Empty file.</b> Type the whole file yourself. The task above was written for the guided starting file, and here you write that part too.' +
        (ids.length ? ' The checks look for ' + (ids.length === 1 ? 'the job id ' : 'these job ids: ') + ids.map(function (x) { return '<code>' + esc(x) + '</code>'; }).join(', ') + '.' : '') + '</p>' +
        '<p>Under the editor you see the keys that fit on the line the cursor is on. Stuck? <b>Next line</b> shows only the next line you need, and <b>Show solution</b> opens the finished file beside your own. Neither changes what you typed.</p>' +
        '<details><summary>See the guided starting file</summary><pre>' + esc(spec.starter || '') + '</pre></details>';
    }
    var armedMode = null;
    function setMode(m, btn) {
      if (m === mode) return;
      var cur = editor.get(), untouched = cur.trim() === '' || cur === (files[0].starter || '');
      if (!untouched && armedMode !== m) {
        armedMode = m; modeNote.textContent = 'Click ' + btn.textContent + ' again: this replaces what you typed.';
        setTimeout(function () { if (armedMode === m) { armedMode = null; renderMode(); } }, 4000); return;
      }
      armedMode = null; mode = m; chosen = true; store.set('ga-mode', m);
      backup = null; revealed = false;
      texts = files.map(starterOf); editor.set(texts[active]); renderMode(); persist();
      document.dispatchEvent(new CustomEvent('ga-mode', { detail: { mode: m, from: id } }));
    }
    // The choice made in another lab becomes this lab's start too, as long as nothing was chosen or typed here.
    if (canChoose) document.addEventListener('ga-mode', function (e) {
      if (e.detail.from === id || chosen || e.detail.mode === mode || !root.isConnected) return;
      if (editor.get() !== starterOf(files[0])) return;
      mode = e.detail.mode; texts = files.map(starterOf); editor.set(texts[active]); renderMode();
    });
    // The next line: compare what is typed with the solution, by place in the file.
    var nextOpen = false;
    function renderNext() {
      if (!nextOpen) { nextBox.hidden = true; return; }
      var f = files[active], r = GA.nextLine(editor.get(), f.solution || '');
      var crumbs = function (c) { return c.length ? ' under ' + c.map(function (x) { return x === '-' ? 'a list item' : '<code>' + esc(x.replace(/\|$/, '')) + '</code>'; }).join(' › ') : ' at the top level (no indent)'; };
      var html;
      if (r.kind === 'done') html = '<p><b>Nothing is missing.</b> Every line of the solution is in your file' + (current.pass ? '.' : '. If a requirement is still open, read the Problems panel.') + '</p>';
      else if (r.kind === 'missing') {
        var key = (/^\s*(?:-\s+)?([\w.\/-]+)\s*:/.exec(r.line) || [])[1];
        var d = key && GA.describeKey ? GA.describeKey(r.crumbs, key, kindOf(active)) : null;
        html = '<p><b>The next line your file needs</b>' + crumbs(r.crumbs) + ':</p><pre>' + esc(r.line) + '</pre>' + (d ? '<p class="nx-why"><code>' + esc(key) + '</code>: ' + esc(d) + '.</p>' : '') +
          '<p class="nx-left">' + (r.left > 1 ? (r.left - 1) + ' more line' + (r.left === 2 ? '' : 's') + ' after this one. ' : 'This is the last one. ') + 'Type it, and this box moves on by itself.' + (kindOf(active) !== 'none' ? ' The spaces at the start matter: they say what the line belongs to.' : '') + '</p>';
      } else html = '<p><b>All the lines are there, but line ' + r.yoursN + ' differs from the solution</b>' + crumbs(r.crumbs) + '. Another way of writing it can be just as right: the requirements decide.</p><pre>yours:    ' + esc(r.yours.trim()) + '\nsolution: ' + esc(r.line.trim()) + '</pre>';
      nextBox.innerHTML = html; nextBox.hidden = false;
    }
    function renderSol() {
      if (solBox.hidden) return;
      solBox.innerHTML = '<div class="sol-head"><b>The solution</b><span>Read it and type what you need. Your own text is untouched.</span></div>';
      files.forEach(function (f) { if (multi) solBox.appendChild(el('p', 'sol-file', esc(f.name))); solBox.appendChild(el('pre', null, esc(f.solution || ''))); });
      var put = el('button', 'copy', backup !== null ? 'Back to my code' : 'Put it in the editor'); put.type = 'button';
      put.addEventListener('click', function () {
        if (backup !== null) { var b = backup; backup = null; revealed = false; setAll(b); renderSol(); return; }
        texts[active] = editor.get(); backup = texts.slice(); revealed = true;
        setAll(files.map(function (f) { return f.solution; }));
        win.innerHTML = '<h4>The solution</h4>' + (spec.explain || ''); win.hidden = false; renderSol();
      });
      solBox.appendChild(put);
    }
    function persist(extra) {
      var prev = store.get('ga-lab:' + id) || {};
      var rec = { passed: !!prev.passed, passedOnce: !!prev.passedOnce };   // typing after a pass must not forget the pass
      if (canChoose && (chosen || texts[0] !== starterOf(files[0]))) rec.mode = mode;   // an untouched lab keeps following the page's choice
      if (multi) { rec.files = {}; files.forEach(function (f, i) { rec.files[f.name] = texts[i]; }); } else rec.code = texts[0];
      Object.keys(extra || {}).forEach(function (k) { rec[k] = extra[k]; });
      store.set('ga-lab:' + id, rec);
    }
    // Parse and lint one file.
    function inspect(text) {
      var empty = text.trim() === '';
      var parsed = empty ? { doc: null } : (spec.format === 'text' ? { doc: {} } : parseWorkflow(text));
      var problems = [], lintRan = false;
      if (parsed.error) problems.push(parsed.error);
      else if (!empty && spec.lint === false) lintRan = true;
      else if (!empty) { Checker.init(); var res = Checker.lint(text); if (res) { problems = res.slice(); lintRan = true; } }
      var doc = parsed.doc && typeof parsed.doc === 'object' ? parsed.doc : null;
      return { text: text, empty: empty, error: parsed.error, problems: problems, lintRan: lintRan, doc: doc, traps: [] };
    }
    var timer = null, current = { pass: false };
    function schedule() { clearTimeout(timer); timer = setTimeout(run, 180); }
    function run() {
      texts[active] = editor.get();
      persist();
      var info = texts.map(inspect);
      var all = {};
      files.forEach(function (f, i) { all[f.name || 'file'] = { doc: info[i].doc, text: info[i].text }; });
      var indexOf = function (name) { if (!multi || !name) return 0; for (var i = 0; i < files.length; i++) if (files[i].name === name) return i; return 0; };
      var reqs = (spec.checks || []).map(function (c) {
        var f = info[indexOf(c.file)];
        if (!f.doc) return { c: c, ok: false };
        try { return { c: c, ok: c.test(f.doc, f.text, all) === true }; } catch (e) { return { c: c, ok: false }; }
      });
      (spec.traps || []).forEach(function (t) { var f = info[indexOf(t.file)]; if (!f.doc) return; try { if (t.test(f.doc, f.text, all)) f.traps.push(t); } catch (e) {} });
      if (spec.lint !== false && GA.globalTraps) info.forEach(function (f) {
        if (!f.doc) return;
        var hasAction = f.problems.some(function (p) { return p.kind === 'action'; });
        var gts = []; try { gts = GA.globalTraps(f.doc, f.text); } catch (e) {}
        gts.forEach(function (g) { if (g.action && hasAction) return; f.traps.push({ msg: g.msg, line: function () { return g.line; } }); });
      });
      var cur = info[active];
      curDoc = cur.doc;
      reqList.innerHTML = '';
      var blind = !!spec.scenario;   // read-and-fix: do not give the answer away, describe each requirement once it is met
      reqs.forEach(function (r, i) {
        var label = blind && !r.ok ? 'Still to fix (' + (i + 1) + ' of ' + reqs.length + ')' : (multi && r.c.file ? '<span class="req-file">' + esc(r.c.file) + '</span> ' : '') + r.c.label;
        reqList.appendChild(el('li', r.ok ? 'ok' : 'todo', '<span class="ic" aria-hidden="true">' + (r.ok ? '✓' : '○') + '</span><span>' + label + '</span>'));
      });
      probs.innerHTML = '';
      var errLines = [];
      if (cur.empty) probs.appendChild(el('p', 'probs-none', 'Start typing. Problems show up here as you type, each with the line number.'));
      else {
        cur.problems.sort(function (a, b) { return a.line - b.line || a.column - b.column; });
        cur.problems.forEach(function (p) {
          var f = friendly(p);
          var row = el('button', 'prob', '<span class="ln">Line ' + p.line + '</span><span class="msg">' + f.text + '</span>' + (f.raw ? '<span class="raw">' + esc(f.raw.length > 150 ? f.raw.slice(0, 150) + '…' : f.raw) + '</span>' : ''));
          row.type = 'button';
          row.addEventListener('click', function () { editor.goto(p.line); });
          probs.appendChild(row);
          errLines.push(p.line);
        });
        cur.traps.forEach(function (t) {
          var tl = t.line ? t.line(cur.text) : 0;
          if (tl && cur.problems.some(function (p) { return p.line === tl; })) return;   // the checker already explains that line
          probs.appendChild(el('div', 'prob trap', '<span class="ln">Mistake</span><span class="msg">' + t.msg + '</span>'));
          if (tl) errLines.push(tl);
        });
        if (!cur.problems.length && !cur.traps.length) probs.appendChild(el('p', 'probs-none ok', spec.lint === false ? (spec.format === 'text' ? '✓ No problems found in the lines.' : '✓ The YAML is valid.') : Checker.state === 'ready' ? '✓ No problems. The checker (actionlint) is happy with this file.' : (Checker.state === 'unavailable' ? 'The YAML is valid. The full checker could not start in this browser.' : 'The YAML is valid. Loading the full checker…')));
      }
      if (multi) info.forEach(function (f, i) {
        var bad = f.empty || f.problems.length || f.traps.length;
        tabBtns[i].className = 'lab-tab' + (i === active ? ' on' : '') + (f.empty ? ' empty' : bad ? ' bad' : ' good');
        tabBtns[i].setAttribute('aria-selected', i === active ? 'true' : 'false');
        if (i !== active && !f.empty && (f.problems.length || f.traps.length)) {
          var n = f.problems.length + f.traps.length;
          var go = el('button', 'prob other', '<span class="ln">' + esc(files[i].name) + '</span><span class="msg">' + n + ' problem' + (n === 1 ? '' : 's') + ' in the other file. Click to open it.</span>');
          go.type = 'button'; go.addEventListener('click', function () { show(i); });
          probs.appendChild(go);
        }
      });
      editor.mark(errLines);
      var okCount = reqs.filter(function (r) { return r.ok; }).length;
      var clean = info.every(function (f) { return !f.empty && !f.error && f.lintRan && !f.problems.length && !f.traps.length; });
      var pass = clean && reqs.length > 0 && okCount === reqs.length;   // the sandbox has no requirements, so it never counts as passed
      current.pass = pass;
      var status = $('.lab-status', head);
      status.textContent = pass ? '✓ Passed' : okCount + ' of ' + reqs.length + ' requirements';
      status.className = 'lab-status' + (pass ? ' pass' : '');
      root.classList.toggle('passed', pass || !!(store.get('ga-lab:' + id) || {}).passedOnce);
      if (pass) {
        persist({ passed: true, passedOnce: true });
        root.classList.add('passed');
        if (win.hidden) { win.innerHTML = '<h4>✓ You did it</h4>' + (spec.explain || ''); win.hidden = false; }
        root.dispatchEvent(new CustomEvent('labpass', { bubbles: true, detail: { id: id } }));
      } else if (!win.hidden && !revealed) { win.hidden = true; }
      pvWrap.hidden = !(curDoc && spec.preview !== false);
      if (curDoc && spec.preview !== false) pvc.refresh();
      renderNext();
      root.dispatchEvent(new CustomEvent('labchange', { bubbles: true, detail: { id: id, pass: pass } }));
    }
    function setAll(values) { texts = values.slice(); editor.set(texts[active]); }
    Checker.onState(function (s) {
      checker.textContent = s === 'loading' ? 'Loading the checker…' : s === 'ready' ? 'Checker: actionlint ' + (window.ACTIONLINT_VERSION || '') : s === 'unavailable' ? 'Checker unavailable in this browser' : '';
      if (s === 'ready') run();
    });
    bHint.addEventListener('click', function () {
      var hs = spec.hints || [];
      if (!hs.length) return;
      hintsShown = Math.min(hs.length, hintsShown + 1);
      hintBox.hidden = false;
      hintBox.innerHTML = hs.slice(0, hintsShown).map(function (h, i) { return '<p><b>Hint ' + (i + 1) + ' of ' + hs.length + '.</b> ' + h + '</p>'; }).join('');
      bHint.textContent = hintsShown < hs.length ? 'Another hint' : 'No more hints';
    });
    bNext.addEventListener('click', function () { nextOpen = !nextOpen; bNext.textContent = nextOpen ? 'Hide next line' : 'Next line'; renderNext(); });
    bSol.addEventListener('click', function () { solBox.hidden = !solBox.hidden; bSol.textContent = solBox.hidden ? 'Show solution' : 'Hide solution'; renderSol(); });
    var armed2 = false;
    bReset.addEventListener('click', function () {
      if (!armed2) { armed2 = true; bReset.textContent = 'Click again: start over'; setTimeout(function () { armed2 = false; bReset.textContent = 'Start over'; }, 4000); return; }
      armed2 = false; bReset.textContent = 'Start over'; backup = null; revealed = false; hintsShown = 0; hintBox.hidden = true; bHint.textContent = 'Hint'; win.hidden = true;
      solBox.hidden = true; bSol.textContent = 'Show solution'; nextOpen = false; bNext.textContent = 'Next line';
      var keep = canChoose && chosen ? { mode: mode } : {};
      store.set('ga-lab:' + id, keep);
      texts = files.map(multi ? function (f) { return f.starter || ''; } : starterOf);
      editor.ta.value = texts[active]; run(); store.set('ga-lab:' + id, keep);   // a fresh start also forgets the pass
      editor.set(texts[active]);
      root.classList.remove('passed'); syncTicks(); renderProgress();
    });
    bCopy.addEventListener('click', function () {
      var t = editor.get();
      function ok() { bCopy.textContent = 'Copied'; setTimeout(function () { bCopy.textContent = 'Copy'; }, 1500); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { editor.ta.select(); });
      else editor.ta.select();
    });
    if (saved.passedOnce) root.classList.add('passed');
    // Load the checker when the lab comes into view.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { Checker.init(); io.disconnect(); } }, { rootMargin: '600px' });
      io.observe(root);
    }
    editor.ta.addEventListener('focus', function () { Checker.init(); });
    // For the tests: put text into the lab (a string, or { fileName: text } for a lab with several files) and check it now.
    renderMode(); showAssist();
    labs[id] = { root: root, editor: editor, run: run, spec: spec, passed: function () { return current.pass; },
      mode: function () { return mode; }, setMode: function (m) { armedMode = m; setMode(m, modeBtns[m] || { textContent: m }); },
      set: function (v) { if (multi) texts = files.map(function (f) { return v[f.name] !== undefined ? v[f.name] : ''; }); else texts = [String(v)]; editor.ta.value = texts[active]; editor.ta.dispatchEvent(new Event('input')); clearTimeout(timer); run(); } };
    run();
  }

  // ------------------------------------------------------------------ a set of labs: a list of challenges, one open at a time
  function mountSet(root) {
    var ids = root.getAttribute('data-ids').split(/\s+/).filter(Boolean);
    var nav = el('div', 'set-nav'), panel = el('div', 'set-panel');
    root.appendChild(nav); root.appendChild(panel);
    var buttons = {};
    ids.forEach(function (id, i) {
      var spec = GA.labs[id];
      var b = el('button', 'set-btn', '<span class="n">' + (i + 1) + '</span><span class="t">' + esc(spec.title) + '</span><span class="lv lvl-' + (spec.level || 1) + '">' + esc(['', 'Easy', 'Easy+', 'Medium', 'Hard', 'Expert'][spec.level || 1]) + '</span><span class="ck" aria-hidden="true">✓</span>');
      b.type = 'button';
      b.addEventListener('click', function () { open(id); });
      nav.appendChild(b); buttons[id] = b;
      if ((store.get('ga-lab:' + id) || {}).passedOnce) b.classList.add('done');
    });
    var summary = el('p', 'set-sum'); root.insertBefore(summary, nav);
    function count() { var n = ids.filter(function (id) { return buttons[id].classList.contains('done'); }).length; summary.textContent = n + ' of ' + ids.length + ' done'; }
    function open(id) {
      ids.forEach(function (x) { buttons[x].classList.toggle('open', x === id); });
      panel.innerHTML = '';
      var host = el('div'); host.setAttribute('data-lab', id); panel.appendChild(host);
      mountLab(host);
      store.set('ga-set:' + (root.getAttribute('data-set') || ''), id);
    }
    root.addEventListener('labpass', function (e) {
      buttons[e.detail.id].classList.add('done'); count();
    });
    count();
    var last = store.get('ga-set:' + (root.getAttribute('data-set') || ''));
    var first = ids.filter(function (id) { return !buttons[id].classList.contains('done'); })[0] || ids[0];
    open(ids.indexOf(last) >= 0 ? last : first);
  }

  // ------------------------------------------------------------------ command drills
  function mountCmd(root) {
    var id = root.getAttribute('data-cmd');
    var spec = GA.cmds[id];
    if (!spec) return;
    var saved = store.get('ga-cmd:' + id) || {};
    root.classList.add('cmd');
    root.innerHTML = '<div class="cmd-q">' + spec.prompt + '</div>';
    var ta = el('textarea', 'cmd-in'); ta.rows = spec.rows || 2; ta.spellcheck = false; ta.placeholder = 'Type the command here'; ta.value = saved.v || '';
    ta.setAttribute('aria-label', 'Command');
    var out = el('div', 'cmd-out'), bar = el('div', 'lab-bar');
    var bHint = el('button', 'copy', 'Hint'), bSol = el('button', 'copy', 'Show answer');
    bHint.type = bSol.type = 'button';
    bar.appendChild(bHint); bar.appendChild(bSol);
    root.appendChild(ta); root.appendChild(out); root.appendChild(bar);
    var hintBox = el('div', 'lab-hint'); hintBox.hidden = true; root.appendChild(hintBox);
    var hints = 0;
    function run() {
      store.set('ga-cmd:' + id, { v: ta.value, ok: (store.get('ga-cmd:' + id) || {}).ok });
      var r = GA.judgeLine(ta.value, spec.specs);
      root.classList.toggle('ok', r.ok);
      if (r.empty) { out.innerHTML = ''; return; }
      if (r.ok) {
        out.innerHTML = '<p class="cmd-ok">✓ Correct. This is what each part does:</p><ul class="cmd-tok">' + r.tokens.map(function (t) { return '<li><code>' + esc(t.t) + '</code><span>' + t.why + '</span></li>'; }).join('') + '</ul>' + (spec.after ? '<p class="cmd-after">' + spec.after + '</p>' : '');
        var st = store.get('ga-cmd:' + id) || {}; st.ok = true; store.set('ga-cmd:' + id, st);
        root.dispatchEvent(new CustomEvent('cmdpass', { bubbles: true }));
      } else out.innerHTML = '<ul class="cmd-bad">' + r.problems.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>';
    }
    ta.addEventListener('input', function () { clearTimeout(ta._t); ta._t = setTimeout(run, 200); });
    bHint.addEventListener('click', function () { var hs = spec.hints || []; if (!hs.length) return; hints = Math.min(hs.length, hints + 1); hintBox.hidden = false; hintBox.innerHTML = hs.slice(0, hints).map(function (h) { return '<p><b>Hint ' + (hints > 1 ? '' : '') + '</b>' + h + '</p>'; }).join(''); });
    bSol.addEventListener('click', function () { ta.value = spec.answer; run(); });
    if (saved.ok) root.classList.add('ok');
    run();
  }

  // ------------------------------------------------------------------ expression and filter drills (type, see the table of cases)
  function mountDrill(root) {
    var id = root.getAttribute('data-drill');
    var spec = GA.drills[id];
    if (!spec) return;
    var saved = store.get('ga-drill:' + id) || {};
    root.classList.add('drill-lab');
    root.innerHTML = '<div class="cmd-q">' + spec.goal + '</div>';
    var ta = el('textarea', 'cmd-in mono'); ta.rows = spec.rows || (spec.kind === 'filter' ? 4 : 2); ta.spellcheck = false; ta.placeholder = spec.placeholder || ''; ta.value = saved.v !== undefined ? saved.v : (spec.starter || '');
    ta.setAttribute('aria-label', 'Your answer');
    var out = el('div', 'drill-out'), bar = el('div', 'lab-bar');
    var bHint = el('button', 'copy', 'Hint'), bSol = el('button', 'copy', 'Show answer');
    bHint.type = bSol.type = 'button'; bar.appendChild(bHint); bar.appendChild(bSol);
    root.appendChild(ta); root.appendChild(out); root.appendChild(bar);
    var hintBox = el('div', 'lab-hint'); hintBox.hidden = true; root.appendChild(hintBox);
    var hints = 0;
    function run() {
      store.set('ga-drill:' + id, { v: ta.value, ok: (store.get('ga-drill:' + id) || {}).ok });
      var rows = [], err = null, all = true;
      if (!ta.value.trim()) { out.innerHTML = ''; root.classList.remove('ok'); return; }
      try {
        spec.cases.forEach(function (c) {
          var got;
          if (spec.kind === 'filter') {
            var pats = ta.value.split('\n').map(function (s) { return s.replace(/^\s*-\s*/, '').replace(/^(['"])(.*)\1$/, '$2').trim(); }).filter(Boolean);
            got = GA.matchFilter(pats, c.name);
          } else {
            var v = GA.evalCondition(ta.value, Object.assign({ __status: { success: true, failure: false, cancelled: false } }, c.ctx));
            got = GA.isUnknown(v) ? 'unknown' : v;
          }
          if (spec.kind === 'value') { var rv = GA.evaluate(ta.value, Object.assign({}, c.ctx)); got = GA.isUnknown(rv) ? 'unknown' : rv; }
          var ok = spec.kind === 'value' ? JSON.stringify(got) === JSON.stringify(c.expect) : got === c.expect; if (!ok) all = false;
          rows.push('<tr class="' + (ok ? 'ok' : 'bad') + '"><td>' + (ok ? '✓' : '✗') + '</td><td>' + (spec.kind === 'filter' ? '<code>' + esc(c.name) + '</code>' : c.label) + '</td><td>' + (spec.kind === 'value' ? '<code>' + esc(JSON.stringify(c.expect)) + '</code>' : (c.expect ? 'run' : 'skip')) + '</td><td>' + (got === 'unknown' ? '?' : spec.kind === 'value' ? '<code>' + esc(JSON.stringify(got)) + '</code>' : got ? 'run' : 'skip') + '</td></tr>');
        });
      } catch (e) { err = e.message; all = false; }
      out.innerHTML = err ? '<p class="cmd-bad">The expression has a problem: ' + esc(err) + '</p>' : '<div class="table-wrap"><table class="drill-tab"><thead><tr><th></th><th>Case</th><th>Should</th><th>Yours</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' + (all ? '<p class="cmd-ok">✓ Every case is right.' + (spec.after ? ' ' + spec.after : '') + '</p>' : '');
      root.classList.toggle('ok', all);
      if (all) {
        var st = store.get('ga-drill:' + id) || {}; st.ok = true; store.set('ga-drill:' + id, st);
        root.dispatchEvent(new CustomEvent('cmdpass', { bubbles: true }));
      }
    }
    ta.addEventListener('input', function () { clearTimeout(ta._t); ta._t = setTimeout(run, 150); });
    bHint.addEventListener('click', function () { var hs = spec.hints || []; if (!hs.length) return; hints = Math.min(hs.length, hints + 1); hintBox.hidden = false; hintBox.innerHTML = hs.slice(0, hints).map(function (h, i) { return '<p><b>Hint ' + (i + 1) + ' of ' + hs.length + '.</b> ' + h + '</p>'; }).join(''); });
    bSol.addEventListener('click', function () { ta.value = spec.answer; run(); });
    if (saved.ok) root.classList.add('ok');
    run();
  }

  // ------------------------------------------------------------------ the expression playground and the free workflow editor
  function mountPlayground(root) {
    var presets = [
      ['github.ref == \'refs/heads/main\'', { github: { ref: 'refs/heads/main' } }],
      ['contains(github.event.head_commit.message, \'[skip ci]\')', { github: { event: { head_commit: { message: 'Fix typo [skip ci]' } } } }],
      ['startsWith(github.ref, \'refs/tags/v\') && github.event_name == \'push\'', { github: { ref: 'refs/tags/v1.2.0', event_name: 'push' } }],
      ['format(\'{0}-{1}\', github.run_number, github.sha)', { github: { run_number: 42, sha: 'a1b2c3d' } }],
      ['join(github.event.pull_request.labels.*.name, \', \')', { github: { event: { pull_request: { labels: [{ name: 'bug' }, { name: 'ci' }] } } } }],
      ['fromJSON(\'[1,2,3]\')[1]', {}],
      ['case(github.ref == \'refs/heads/main\', \'production\', \'development\')', { github: { ref: 'refs/heads/main' } }],
      ['\'\' || \'fallback\'', {}],
    ];
    root.innerHTML = '';
    var q = el('div', 'pg');
    var sel = el('select', 'pv-sel'); presets.forEach(function (p, i) { var o = el('option'); o.value = i; o.textContent = p[0].length > 60 ? p[0].slice(0, 58) + '…' : p[0]; sel.appendChild(o); });
    var expr = el('textarea', 'cmd-in mono'); expr.rows = 2; expr.spellcheck = false; expr.value = presets[0][0]; expr.setAttribute('aria-label', 'Expression');
    var ctx = el('textarea', 'cmd-in mono'); ctx.rows = 6; ctx.spellcheck = false; ctx.setAttribute('aria-label', 'Context as JSON');
    var out = el('div', 'pg-out');
    q.appendChild(el('label', 'pg-l', 'Pick an example, or write your own expression (without <code>${{ }}</code>)')); q.appendChild(sel); q.appendChild(expr);
    q.appendChild(el('label', 'pg-l', 'The contexts it can read (JSON)')); q.appendChild(ctx); q.appendChild(out);
    root.appendChild(q);
    function load() { var p = presets[sel.value]; expr.value = p[0]; ctx.value = JSON.stringify(p[1], null, 2); run(); }
    function run() {
      var c; try { c = JSON.parse(ctx.value || '{}'); } catch (e) { out.innerHTML = '<p class="cmd-bad">The context is not valid JSON: ' + esc(e.message) + '</p>'; return; }
      try {
        var v = GA.evaluate(expr.value, c);
        var shown = GA.isUnknown(v) ? '<i>cannot be known here: ' + esc(v.why) + '</i>' : '<code>' + esc(JSON.stringify(v)) + '</code>';
        var asIf = GA.isUnknown(v) ? '' : ' As an <code>if:</code> condition this is <b>' + (GA.truthy(v) ? 'true, so it runs' : 'false, so it is skipped') + '</b>.';
        out.innerHTML = '<p class="cmd-ok">Result: ' + shown + '.' + asIf + '</p>';
      } catch (e) { out.innerHTML = '<p class="cmd-bad">' + esc(e.message) + '</p>'; }
    }
    sel.addEventListener('change', load); expr.addEventListener('input', run); ctx.addEventListener('input', run);
    load();
  }
  function mountFree(root) {
    var spec = { id: 'free', tag: 'Sandbox', title: 'Free-play editor', level: 1, task: root.getAttribute('data-task') || 'Paste or write any workflow. It is checked with the same rules as every lab.', starter: GA.freeStarter || '', checks: [], traps: [], preview: {} };
    GA.labs.free = spec;
    var host = el('div'); host.setAttribute('data-lab', 'free'); root.appendChild(host);
    mountLab(host);
  }

  // ------------------------------------------------------------------ a step's tick means: every exercise in it has been passed
  function exercisesOf(sec) {
    var out = [];
    $$('[data-ids]', sec).forEach(function (n) { n.getAttribute('data-ids').split(/\s+/).filter(Boolean).forEach(function (id) { out.push(['lab', id]); }); });
    $$('[data-lab]', sec).forEach(function (n) { var id = n.getAttribute('data-lab'); if (id !== 'free' && !n.closest('[data-set]') && !n.closest('[data-free]')) out.push(['lab', id]); });
    $$('[data-cmd]', sec).forEach(function (n) { out.push(['cmd', n.getAttribute('data-cmd')]); });
    $$('[data-drill]', sec).forEach(function (n) { out.push(['drill', n.getAttribute('data-drill')]); });
    return out;
  }
  function exerciseDone(e) {
    var s = store.get('ga-' + e[0] + ':' + e[1]) || {};
    return e[0] === 'lab' ? !!s.passedOnce : !!s.ok;
  }
  function syncTicks() {
    $$('section[data-step]').forEach(function (sec) {
      var box = $('input[data-done]', sec);
      if (!box) return;
      var ex = exercisesOf(sec);
      if (!ex.length || $('[data-manual-tick]', sec)) return;                                   // a reading step: you tick it yourself
      var done = ex.filter(exerciseDone).length, all = done === ex.length;
      box.disabled = true;
      var label = box.parentNode;
      var note = $('.done-note', label);
      if (!note) { while (label.lastChild && label.lastChild !== box) label.removeChild(label.lastChild); note = el('span', 'done-note'); label.appendChild(note); }
      note.textContent = all ? ' Done: every exercise in this step is passed' : ' ' + done + ' of ' + ex.length + ' exercises passed. This ticks itself when all are';
      if (box.checked !== all) { box.checked = all; box.dispatchEvent(new Event('change')); }
    });
  }
  document.addEventListener('labpass', syncTicks);
  document.addEventListener('cmdpass', syncTicks);

  // ------------------------------------------------------------------ progress across the whole page
  function renderProgress() {
    var box = $('#ga-progress');
    if (!box) return;
    var passed = function (id) { return !!(store.get('ga-lab:' + id) || {}).passedOnce; };
    var ids = Object.keys(GA.labs).filter(function (i) { return /^[ABC]\d+$/.test(i); });
    var groups = [
      ['Guided labs', ids.filter(function (i) { return /^A/.test(i); }), passed],
      ['Command drills', Object.keys(GA.cmds), function (i) { return !!(store.get('ga-cmd:' + i) || {}).ok; }],
      ['Expression and pattern drills', Object.keys(GA.drills), function (i) { return !!(store.get('ga-drill:' + i) || {}).ok; }],
      ['Write from scratch', ids.filter(function (i) { return /^B/.test(i) && i !== 'B7'; }), passed],
      ['The capstone', ['B7'], passed],
      ['Read and fix', ids.filter(function (i) { return /^C/.test(i); }), passed],
    ];
    box.innerHTML = groups.map(function (g) {
      var n = g[1].filter(g[2]).length, t = g[1].length;
      return '<div class="ga-pg"><span>' + g[0] + '</span><b>' + n + ' / ' + t + '</b><i style="--w:' + (t ? Math.round(n / t * 100) : 0) + '%"></i></div>';
    }).join('');
  }
  document.addEventListener('labpass', renderProgress);
  document.addEventListener('cmdpass', renderProgress);
  document.addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('[data-copy]');
    if (!row) return;
    var t = row.getAttribute('data-copy');
    function ok() { row.classList.add('copied'); setTimeout(function () { row.classList.remove('copied'); }, 1200); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () {}); else ok();
  });

  function init() {
    $$('[data-set]').forEach(mountSet);
    $$('[data-lab]').forEach(function (n) { if (!n.closest('[data-set]') && !n.classList.contains('lab')) mountLab(n); });
    $$('[data-cmd]').forEach(mountCmd);
    $$('[data-drill]').forEach(mountDrill);
    $$('[data-playground]').forEach(mountPlayground);
    $$('[data-free]').forEach(mountFree);
    renderProgress();
    syncTicks();
  }
  window.GAUI = { init: init, labs: labs, Checker: Checker, parseWorkflow: parseWorkflow, friendly: friendly, renderPreview: renderPreview };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
