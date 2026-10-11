/* infra-sim — "Ask AI" tutor
 *
 * Select text on any page, then right-click it (or click the floating "Ask AI" button)
 * to ask a question about it. Questions go directly from your browser to the OpenAI
 * Responses API, using the key you enter in the settings panel (⚙).
 *
 * The API key is stored only in this browser (localStorage, or sessionStorage if
 * "remember" is off). It is never written to the repository.
 */
(function () {
  "use strict";

  var STORAGE = { key: "infrasim.ai.key", settings: "infrasim.ai.settings" };
  var DEFAULTS = {
    model: "gpt-6-sol",
    effort: "medium",
    webSearch: true,
    remember: true,
    baseUrl: "https://api.openai.com/v1"
  };
  var SUGGESTED_MODELS = ["gpt-6-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5.5"];
  var MAX_SELECTION = 4000;
  var MAX_SURROUNDING = 2000;
  var MAX_HISTORY = 12;   // messages kept for follow-up questions
  var LIBS = {
    marked: "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
    purify: "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"
  };

  var SYSTEM_PROMPT = [
    "You are an expert Docker, Kubernetes, Helm and Argo CD tutor embedded in a self-paced, scenario-based course called \"infra-sim\".",
    "The learner is a junior-to-intermediate developer who wants to LEARN how these tools work and how to fix them when they break, so optimize for understanding, not just for an answer.",
    "",
    "About the course's sandbox (important):",
    "- Lessons contain scenarios that run in an in-browser SIMULATOR, not on real Docker or Kubernetes. It models Docker Engine 29, Docker Compose v5, Kubernetes 1.37 (3 nodes: cp-1, worker-1, worker-2; ingress controller Traefik with IngressClass \"traefik\"; default StorageClass \"standard\"), Helm 4 and Argo CD 3.",
    "- Only a subset of each CLI exists in the simulator, and the practice images (shop/web, shop/api), the chart repository https://charts.shop.example and the git repository https://git.shop.example/shop/gitops.git exist only there. If a command fails with a message that mentions the sandbox, explain the real-world equivalent instead.",
    "- When the prompt includes the learner's recent terminal output, base your diagnosis on it. Quote the decisive line. Do not invent output the learner did not show.",
    "",
    "Accuracy rules (most important):",
    "- Be technically precise. When behaviour differs between versions, say which version introduced or changed it.",
    "- Never invent commands, flags, API fields, error messages, image names or chart values. If you are not certain something exists or behaves as described, say so explicitly and explain how the learner can verify it (--help, kubectl explain, the official docs, a small experiment in the sandbox).",
    "- Prefer the official documentation (docs.docker.com, kubernetes.io, helm.sh, argo-cd.readthedocs.io) as sources. When web search is available, use it to verify version-specific or recent facts, and cite the pages you relied on.",
    "- If the selected course passage looks incorrect, outdated or oversimplified, say so clearly and give the correct information.",
    "",
    "Teaching style:",
    "- Start with a direct answer in 1-3 sentences.",
    "- For troubleshooting questions, teach the method: which command shows the evidence, what the output means, what the cause is, and why the fix works. Give a hint before the full solution unless the learner asks for the solution.",
    "- Include short, correct command or YAML examples when they help.",
    "- Point out one common mistake or misconception when relevant.",
    "- For conceptual questions, end with a single line starting with \"Check your understanding:\" containing a short question. Skip it for quick factual answers.",
    "- Use Markdown with fenced code blocks (```bash, ```yaml, ```dockerfile). Be concise; go deeper only when asked.",
    "- Stay on topic: containers, Kubernetes, Helm, GitOps and the surrounding tooling. Briefly redirect unrelated questions back to the course."
  ].join("\n");

  var CHIPS_SELECTION = [
    ["Explain simply", "Explain the selected passage in simple terms, as if I'm new to containers and Kubernetes."],
    ["Show an example", "Show a short, concrete example (commands and their output, or YAML) of the selected concept."],
    ["Why it matters", "Why does this matter in a real system? What goes wrong when people get it wrong?"],
    ["Common mistakes", "What are the most common mistakes or misconceptions about this?"],
    ["Is this accurate?", "Is the selected passage accurate and up to date? Point out anything incorrect, outdated or oversimplified."],
    ["Quiz me", "Ask me 3 short questions, one at a time, to check that I understood this passage. Wait for my answer before giving the next question."]
  ];
  var CHIPS_GENERAL = [
    ["I'm stuck: give me a hint", "I'm stuck in the scenario I'm working on. Look at my recent terminal output and give me a hint about what to check next, without revealing the full solution."],
    ["Explain my last error", "Explain the last error in my terminal output: what it means, what usually causes it, and how to confirm the cause."],
    ["Summarize lesson", "Summarize the key ideas of this lesson in 5 bullet points."],
    ["Quiz me", "Ask me 3 short questions, one at a time, about this lesson. Wait for my answer before giving the next question."]
  ];

  /* ---------- storage ---------- */
  function readStore(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
  function writeStore(store, key, value) {
    try { if (value == null) window[store].removeItem(key); else window[store].setItem(key, value); } catch (e) { /* unavailable */ }
  }
  var memoryKey = null;
  function getSettings() {
    var s = {};
    try { s = JSON.parse(readStore("localStorage", STORAGE.settings) || "{}") || {}; } catch (e) { s = {}; }
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = s[k] !== undefined ? s[k] : DEFAULTS[k]; });
    return out;
  }
  function saveSettings(s) { writeStore("localStorage", STORAGE.settings, JSON.stringify(s)); }
  function getKey() { return readStore("localStorage", STORAGE.key) || readStore("sessionStorage", STORAGE.key) || memoryKey || ""; }
  function saveKey(key, remember) {
    memoryKey = key || null;
    writeStore("localStorage", STORAGE.key, null);
    writeStore("sessionStorage", STORAGE.key, null);
    if (key) writeStore(remember ? "localStorage" : "sessionStorage", STORAGE.key, key);
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function clip(s, n) { s = (s || "").replace(/\s+\n/g, "\n").trim(); return s.length > n ? s.slice(0, n) + " …" : s; }
  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }
  var libsPromise = null;
  function ensureLibs() {
    if (window.marked && window.DOMPurify) return Promise.resolve(true);
    if (!libsPromise) {
      libsPromise = Promise.all([window.marked ? true : loadScript(LIBS.marked), window.DOMPurify ? true : loadScript(LIBS.purify)])
        .then(function () {
          if (window.DOMPurify && !window.__simAiHook) {
            window.__simAiHook = true;
            window.DOMPurify.addHook("afterSanitizeAttributes", function (node) {
              if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
            });
          }
          return !!(window.marked && window.DOMPurify);
        });
    }
    return libsPromise;
  }
  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      return window.DOMPurify.sanitize(window.marked.parse(text, { gfm: true, breaks: false }));
    }
    // Fallback: escaped text with fenced code blocks and paragraphs
    var parts = String(text).split(/```(\w*)\n?/);
    var html = "";
    for (var i = 0; i < parts.length; i++) {
      if (i % 3 === 0) html += esc(parts[i]).split(/\n{2,}/).map(function (p) { return p.trim() ? "<p>" + p.replace(/\n/g, "<br>") + "</p>" : ""; }).join("");
      else if (i % 3 === 2) html += "<pre><code>" + esc(parts[i]) + "</code></pre>";
    }
    return html;
  }

  /* ---------- selection & context ---------- */
  var BLOCKS = "p, li, pre, td, th, blockquote, .callout, .quiz, .exercise, .goal, .objectives, h1, h2, h3";

  function selectionInfo() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var text = sel.toString().trim();
    if (!text) return null;
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || el.closest(".ai-backdrop, .ai-fab, input, textarea")) return null;
    return { text: text, range: range, element: el };
  }

  function pointInRange(range, x, y) {
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return true;
    }
    return false;
  }

  function nearestHeading(el) {
    var article = document.querySelector("article") || document.body;
    var node = el;
    while (node && node.parentElement && node.parentElement !== article) node = node.parentElement;
    while (node) {
      if (/^H[23]$/.test(node.tagName || "")) return node.textContent.trim();
      node = node.previousElementSibling;
    }
    return "";
  }

  function buildContext(sel) {
    var info = window.InfraSimCourse || {};
    var lesson = info.lesson;
    var level = lesson && info.levels ? info.levels[lesson.level - 1] : null;
    var goalEl = document.querySelector(".goal p");
    var ctx = {
      lessonLabel: lesson ? "Lesson " + lesson.id + ": " + lesson.title : (document.title || "Course home"),
      levelLabel: level ? "Level " + level.id + " (" + level.name + ")" : "",
      goal: goalEl ? goalEl.textContent.trim() : "",
      heading: "",
      selection: "",
      surrounding: ""
    };
    if (sel) {
      ctx.selection = clip(sel.text, MAX_SELECTION);
      ctx.heading = nearestHeading(sel.element);
      var block = sel.element.closest(BLOCKS);
      if (block && block.textContent.trim() !== sel.text) ctx.surrounding = clip(block.textContent, MAX_SURROUNDING);
    }
    return ctx;
  }

  function buildInstructions(ctx) {
    var lines = [SYSTEM_PROMPT, "", "## Course context", "Page: " + ctx.lessonLabel + (ctx.levelLabel ? " · " + ctx.levelLabel : "")];
    if (ctx.goal) lines.push("Lesson goal: " + ctx.goal);
    if (ctx.heading) lines.push("Section: " + ctx.heading);
    if (ctx.selection) lines.push("", "## Passage the learner selected", "<<<", ctx.selection, ">>>");
    if (ctx.surrounding) lines.push("", "## Surrounding text from the lesson", "<<<", ctx.surrounding, ">>>");
    if (!ctx.selection) lines.push("", "The learner did not select a passage; answer in the context of the current page.");
    var term = window.InfraSimUI && window.InfraSimUI.context ? window.InfraSimUI.context() : "";
    if (term) lines.push("", "## The learner's recent sandbox terminal output (simulated)", "<<<", term, ">>>");
    return lines.join("\n");
  }

  /* ---------- OpenAI Responses API ---------- */
  function apiUrl(path) { return getSettings().baseUrl.replace(/\/+$/, "") + path; }

  function extractError(status, bodyText) {
    var msg = "";
    try { var j = JSON.parse(bodyText); msg = (j.error && (j.error.message || j.error.code)) || ""; } catch (e) { msg = bodyText.slice(0, 300); }
    if (status === 401) return "The API key was rejected (401). Open ⚙ settings and check the key.";
    if (status === 403) return "Access denied (403). Your key or project may not have access to this model. " + msg;
    if (status === 404) return "Not found (404). The model name may be wrong or unavailable to your key. Use ⚙ → Load my models. " + msg;
    if (status === 429) return "Rate limit or quota exceeded (429). Check your OpenAI usage limits and billing. " + msg;
    return "Request failed (" + status + "). " + msg;
  }

  function collectSources(response, into) {
    if (!response || !response.output) return;
    response.output.forEach(function (item) {
      (item.content || []).forEach(function (c) {
        (c.annotations || []).forEach(function (a) {
          if (a.type === "url_citation" && a.url && !into.some(function (s) { return s.url === a.url; })) into.push({ url: a.url, title: a.title || a.url });
        });
      });
    });
  }

  async function streamResponse(body, handlers, signal) {
    var res = await fetch(apiUrl("/responses"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getKey() },
      body: JSON.stringify(body),
      signal: signal
    });
    if (!res.ok) {
      var text = await res.text();
      var err = new Error(extractError(res.status, text));
      err.status = res.status; err.raw = text;
      throw err;
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();
      for (var i = 0; i < events.length; i++) {
        var data = events[i].split(/\r?\n/).filter(function (l) { return l.indexOf("data:") === 0; })
          .map(function (l) { return l.slice(5).trim(); }).join("\n");
        if (!data || data === "[DONE]") continue;
        var ev;
        try { ev = JSON.parse(data); } catch (e) { continue; }
        handlers(ev);
      }
    }
  }

  /* ---------- UI ---------- */
  var ui = {};
  var unsupported = {};   // model -> { reasoning: true, tools: true } learned from 400 responses this session
  var state = { ctx: null, messages: [], controller: null, busy: false, lastFocus: null };

  function buildUI() {
    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "ai-fab";
    fab.innerHTML = "✨ Ask AI";
    fab.title = "Ask the AI tutor about the selected text (or right-click the selection)";
    document.body.appendChild(fab);
    ui.fab = fab;

    var wrap = document.createElement("div");
    wrap.className = "ai-backdrop";
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-title">' +
        '<header><h2 id="ai-title">✨ Ask the infra-sim tutor</h2>' +
          '<button type="button" class="icon-btn" data-act="new" title="Start a new conversation">New</button>' +
          '<button type="button" class="icon-btn" data-act="settings" title="AI settings" aria-label="AI settings">⚙</button>' +
          '<button type="button" class="icon-btn" data-act="close" title="Close (Esc)" aria-label="Close">✕</button></header>' +
        '<div class="ai-body">' +
          '<div class="ai-settings" hidden></div>' +
          '<div class="ai-context"></div>' +
          '<div class="ai-chips"></div>' +
          '<div class="ai-thread" aria-live="polite"></div>' +
        '</div>' +
        '<form class="ai-ask">' +
          '<label class="ai-label" for="ai-question">Your question</label>' +
          '<textarea id="ai-question" placeholder="e.g. Why is this faster than loading full entities?"></textarea>' +
          '<div class="row"><small>Ctrl + Enter to send</small>' +
            '<button type="button" class="btn secondary small" data-act="stop" hidden>Stop</button>' +
            '<button type="submit" class="btn small" data-act="ask">Ask</button></div>' +
        '</form>' +
        '<div class="ai-foot"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    ui.backdrop = wrap;
    ui.modal = wrap.querySelector(".ai-modal");
    ui.settings = wrap.querySelector(".ai-settings");
    ui.context = wrap.querySelector(".ai-context");
    ui.chips = wrap.querySelector(".ai-chips");
    ui.thread = wrap.querySelector(".ai-thread");
    ui.form = wrap.querySelector(".ai-ask");
    ui.input = wrap.querySelector("#ai-question");
    ui.stop = wrap.querySelector('[data-act="stop"]');
    ui.ask = wrap.querySelector('[data-act="ask"]');
    ui.foot = wrap.querySelector(".ai-foot");
    ui.body = wrap.querySelector(".ai-body");

    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) closeModal(); });
    wrap.querySelector('[data-act="close"]').addEventListener("click", closeModal);
    wrap.querySelector('[data-act="settings"]').addEventListener("click", function () { toggleSettings(); });
    wrap.querySelector('[data-act="new"]').addEventListener("click", function () { abort(); state.messages = []; ui.thread.innerHTML = ""; renderChips(); ui.input.focus(); });
    ui.stop.addEventListener("click", abort);
    ui.form.addEventListener("submit", function (e) { e.preventDefault(); ask(ui.input.value); });
    ui.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(ui.input.value); }
    });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Tab") trapFocus(e);
    });

    // Escape closes the modal wherever focus is (it may be on <body> after clicking plain text in the modal)
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !ui.backdrop.hidden) { e.preventDefault(); closeModal(); }
    });

    fab.addEventListener("mousedown", function (e) { e.preventDefault(); });   // keep the selection
    fab.addEventListener("click", function () {
      var sel = selectionInfo();
      hideFab();
      openModal(sel);
    });

    // Optional entry point in the top bar for questions without a selection
    var bar = document.querySelector(".topbar");
    var themeBtn = bar && bar.querySelector("#theme-btn");
    if (bar && themeBtn) {
      var b = document.createElement("button");
      b.className = "icon-btn";
      b.type = "button";
      b.textContent = "✨ Ask AI";
      b.title = "Ask the AI tutor about this page. Tip: select text and right-click it to ask about a passage.";
      b.addEventListener("click", function () { openModal(null); });
      bar.insertBefore(b, themeBtn);
    }
  }

  function trapFocus(e) {
    var f = Array.prototype.filter.call(ui.modal.querySelectorAll("button, textarea, input, select, a[href], summary"),
      function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function renderFoot() {
    var s = getSettings();
    ui.foot.innerHTML = "Model: <b>" + esc(s.model) + "</b> · reasoning: " + esc(s.effort) +
      " · web search: " + (s.webSearch ? "on" : "off") +
      " · AI answers can be wrong. Check important details against the official docs.";
  }

  function renderContext() {
    var c = state.ctx;
    if (c.selection) {
      ui.context.innerHTML = '<div class="ai-label">Selected text · ' + esc(c.lessonLabel) + (c.heading ? " › " + esc(c.heading) : "") + "</div>" +
        "<blockquote>" + esc(c.selection) + "</blockquote>";
    } else {
      ui.context.innerHTML = '<div class="ai-label">Asking about · ' + esc(c.lessonLabel) + "</div>" +
        '<p class="hint" style="margin:0 0 12px;color:var(--muted);font-size:13px">Tip: select any text in a lesson and right-click it to ask about that exact passage.</p>';
    }
  }

  function renderChips() {
    var chips = state.ctx && state.ctx.selection ? CHIPS_SELECTION : CHIPS_GENERAL;
    ui.chips.innerHTML = "";
    ui.chips.hidden = state.messages.length > 0;
    chips.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c[0];
      b.title = c[1];
      b.addEventListener("click", function () { ask(c[1]); });
      ui.chips.appendChild(b);
    });
  }

  function openModal(sel) {
    var ctx = buildContext(sel);
    var sameContext = state.ctx && state.ctx.selection === ctx.selection && state.ctx.lessonLabel === ctx.lessonLabel;
    if (!sameContext) {
      abort();
      state.ctx = ctx;
      state.messages = [];
      ui.thread.innerHTML = "";
    }
    state.lastFocus = document.activeElement;
    renderContext();
    renderChips();
    renderFoot();
    ui.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    ensureLibs();
    if (!getKey()) { toggleSettings(true, "Add your OpenAI API key to start asking questions."); }
    else { ui.settings.hidden = true; ui.input.focus(); }
  }

  function closeModal() {
    abort();
    ui.backdrop.hidden = true;
    document.body.style.overflow = "";
    if (state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus(); } catch (e) { /* ignore */ } }
  }

  function abort() {
    if (state.controller) { state.controller.abort(); state.controller = null; }
    setBusy(false);
  }

  function setBusy(b) {
    state.busy = b;
    ui.stop.hidden = !b;
    ui.ask.disabled = b;
  }

  /* ---------- settings panel ---------- */
  function toggleSettings(forceOpen, message) {
    var open = forceOpen === true ? true : ui.settings.hidden;
    if (!open) { ui.settings.hidden = true; ui.input.focus(); return; }
    var s = getSettings();
    var key = getKey();
    ui.settings.innerHTML =
      "<h3>AI settings</h3>" +
      (message ? '<p class="hint" style="color:var(--text)">' + esc(message) + "</p>" : "") +
      '<label for="ai-key">OpenAI API key</label>' +
      '<div class="field-row"><input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" value="' + esc(key) + '">' +
      '<button type="button" class="icon-btn" data-s="show">Show</button></div>' +
      '<p class="hint">Stored only in this browser and sent only to the API base URL below. Use a key with a spending limit, and never commit it to the repository.</p>' +
      '<label class="inline"><input type="checkbox" id="ai-remember"' + (s.remember ? " checked" : "") + '> Remember the key on this device (otherwise it\'s kept until this tab closes)</label>' +
      '<label for="ai-model">Model</label>' +
      '<div class="field-row"><input id="ai-model" type="text" list="ai-models" spellcheck="false" value="' + esc(s.model) + '">' +
      '<button type="button" class="icon-btn" data-s="models">Load my models</button></div>' +
      '<datalist id="ai-models">' + SUGGESTED_MODELS.map(function (m) { return '<option value="' + esc(m) + '">'; }).join("") + "</datalist>" +
      '<p class="hint">Use your most capable model for the best accuracy. "Load my models" lists the models your key can use.</p>' +
      '<label for="ai-effort">Reasoning effort</label>' +
      '<select id="ai-effort">' + ["default", "low", "medium", "high"].map(function (v) {
        return '<option value="' + v + '"' + (s.effort === v ? " selected" : "") + ">" + (v === "default" ? "Model default" : v) + "</option>";
      }).join("") + "</select>" +
      '<p class="hint">Higher effort means more careful, more accurate answers, but slower and more expensive.</p>' +
      '<label class="inline"><input type="checkbox" id="ai-web"' + (s.webSearch ? " checked" : "") + "> Verify answers with web search and show sources (recommended for accuracy)</label>" +
      '<details><summary>Advanced</summary>' +
        '<label for="ai-base">API base URL</label>' +
        '<input id="ai-base" type="url" spellcheck="false" value="' + esc(s.baseUrl) + '">' +
        '<p class="hint">Default: https://api.openai.com/v1. Point this at your own proxy if you prefer not to keep the key in the browser.</p>' +
      "</details>" +
      '<div class="actions"><button type="button" class="btn small" data-s="save">Save</button>' +
      '<button type="button" class="btn secondary small" data-s="test">Test connection</button>' +
      '<button type="button" class="btn secondary small" data-s="clear">Remove key</button>' +
      '<span class="result" aria-live="polite"></span></div>';
    ui.settings.hidden = false;
    var $ = function (sel) { return ui.settings.querySelector(sel); };
    var result = $(".result");
    function show(msg, ok) { result.textContent = msg; result.className = "result " + (ok ? "ok" : "err"); }
    function read() {
      return {
        model: $("#ai-model").value.trim() || DEFAULTS.model,
        effort: $("#ai-effort").value,
        webSearch: $("#ai-web").checked,
        remember: $("#ai-remember").checked,
        baseUrl: ($("#ai-base").value.trim() || DEFAULTS.baseUrl)
      };
    }
    function persist() {
      var v = read();
      saveSettings(v);
      saveKey($("#ai-key").value.trim(), v.remember);
      renderFoot();
      return v;
    }
    $('[data-s="show"]').addEventListener("click", function (e) {
      var k = $("#ai-key"); k.type = k.type === "password" ? "text" : "password"; e.target.textContent = k.type === "password" ? "Show" : "Hide";
    });
    $('[data-s="save"]').addEventListener("click", function () {
      persist();
      if (!getKey()) { show("Saved, but no API key is set yet.", false); return; }
      show("Saved.", true);
      setTimeout(function () { ui.settings.hidden = true; ui.input.focus(); }, 500);
    });
    $('[data-s="clear"]').addEventListener("click", function () { $("#ai-key").value = ""; saveKey("", false); show("Key removed from this browser.", true); });
    $('[data-s="test"]').addEventListener("click", function () {
      persist();
      show("Testing…", true);
      listModels().then(function (ids) {
        var model = getSettings().model;
        var found = ids.indexOf(model) !== -1;
        show(found ? "Connected. Model \"" + model + "\" is available." : "Connected, but \"" + model + "\" isn't in your model list. Use \"Load my models\".", found);
      }).catch(function (err) { show(err.message, false); });
    });
    $('[data-s="models"]').addEventListener("click", function () {
      persist();
      show("Loading models…", true);
      listModels().then(function (ids) {
        var chat = ids.filter(function (id) {
          return /^(gpt-|o\d|chat)/.test(id) && !/(image|audio|realtime|tts|transcribe|whisper|embedding|moderation|dall-e|sora|search-preview|live)/.test(id);
        }).sort().reverse();
        $("#ai-models").innerHTML = chat.map(function (m) { return '<option value="' + esc(m) + '">'; }).join("");
        show(chat.length + " text models available. Click the model field to pick one.", true);
      }).catch(function (err) { show(err.message, false); });
    });
    (key ? $("#ai-model") : $("#ai-key")).focus();
  }

  async function listModels() {
    if (!getKey()) throw new Error("Enter an API key first.");
    var res = await fetch(apiUrl("/models"), { headers: { "Authorization": "Bearer " + getKey() } });
    var text = await res.text();
    if (!res.ok) throw new Error(extractError(res.status, text));
    var j = JSON.parse(text);
    return (j.data || []).map(function (m) { return m.id; });
  }

  /* ---------- asking ---------- */
  function addUserMessage(text) {
    var div = document.createElement("div");
    div.className = "ai-msg user";
    div.innerHTML = '<div class="bubble"></div>';
    div.firstChild.textContent = text;
    ui.thread.appendChild(div);
  }

  function addAssistantMessage() {
    var div = document.createElement("div");
    div.className = "ai-msg assistant";
    div.innerHTML = '<div class="status">Thinking…</div><div class="bubble" hidden></div><div class="ai-sources" hidden></div><div class="meta-line" hidden></div>';
    ui.thread.appendChild(div);
    return {
      root: div,
      status: div.querySelector(".status"),
      bubble: div.querySelector(".bubble"),
      sources: div.querySelector(".ai-sources"),
      meta: div.querySelector(".meta-line")
    };
  }

  function scrollToBottom() { ui.body.scrollTop = ui.body.scrollHeight; }

  async function ask(question) {
    question = (question || "").trim();
    if (!question || state.busy) return;
    if (!getKey()) { toggleSettings(true, "Add your OpenAI API key to start asking questions."); return; }

    ui.input.value = "";
    ui.chips.hidden = true;
    ui.settings.hidden = true;
    addUserMessage(question);
    state.messages.push({ role: "user", content: question });
    var view = addAssistantMessage();
    scrollToBottom();

    await ensureLibs();
    var settings = getSettings();
    var history = state.messages.slice(-MAX_HISTORY);
    var body = {
      model: settings.model,
      instructions: buildInstructions(state.ctx),
      input: history.map(function (m) { return { role: m.role, content: m.content }; }),
      stream: true,
      store: false
    };
    var known = unsupported[settings.model] || {};
    var notes = [];
    if (settings.effort && settings.effort !== "default" && !known.reasoning) body.reasoning = { effort: settings.effort };
    if (settings.webSearch && !known.tools) body.tools = [{ type: "web_search" }];
    if (settings.webSearch && known.tools) notes.push("Web search isn't available for this model, so the answer isn't web-verified.");

    var text = "", sources = [], usage = null, renderQueued = false;
    function render() {
      renderQueued = false;
      view.bubble.hidden = false;
      view.bubble.innerHTML = renderMarkdown(text);
      scrollToBottom();
    }
    function queueRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); } }

    function onEvent(ev) {
      switch (ev.type) {
        case "response.output_text.delta":
          view.status.hidden = true;
          text += ev.delta || "";
          queueRender();
          break;
        case "response.web_search_call.in_progress":
        case "response.web_search_call.searching":
          view.status.hidden = false;
          view.status.textContent = "Searching the web to verify…";
          break;
        case "response.reasoning_summary_text.delta":
        case "response.output_item.added":
          if (!text) { view.status.hidden = false; if (ev.item && ev.item.type === "reasoning") view.status.textContent = "Thinking carefully…"; }
          break;
        case "response.output_text.annotation.added":
          var a = ev.annotation || {};
          if (a.type === "url_citation" && a.url && !sources.some(function (s) { return s.url === a.url; })) sources.push({ url: a.url, title: a.title || a.url });
          break;
        case "response.completed":
          collectSources(ev.response, sources);
          usage = ev.response && ev.response.usage;
          break;
        case "response.incomplete":
          collectSources(ev.response, sources);
          var reason = ev.response && ev.response.incomplete_details && ev.response.incomplete_details.reason;
          notes.push("The answer was cut short" + (reason ? " (" + reason + ")" : "") + ".");
          break;
        case "response.failed":
          throw new Error((ev.response && ev.response.error && ev.response.error.message) || "The model failed to answer.");
        case "error":
          throw new Error(ev.message || (ev.error && ev.error.message) || "Streaming error.");
      }
    }

    setBusy(true);
    state.controller = new AbortController();
    try {
      // Graceful fallbacks for models that don't support an optional feature (max 2 retries)
      for (var attempt = 0; ; attempt++) {
        try {
          await streamResponse(body, onEvent, state.controller.signal);
          break;
        } catch (err) {
          var raw = (err.raw || "").toLowerCase();
          if (attempt >= 2 || err.status !== 400 || text) throw err;
          if (body.reasoning && /reasoning|effort/.test(raw)) {
            delete body.reasoning;
            (unsupported[settings.model] = unsupported[settings.model] || {}).reasoning = true;
            notes.push("This model doesn't support reasoning effort, so it answered without it.");
          } else if (body.tools && /tool|web_search/.test(raw)) {
            delete body.tools;
            (unsupported[settings.model] = unsupported[settings.model] || {}).tools = true;
            notes.push("Web search isn't available for this model, so the answer isn't web-verified.");
          } else {
            throw err;
          }
          view.status.textContent = "Retrying…";
        }
      }
      if (renderQueued || text) render();
      if (!text) throw new Error("The model returned an empty answer. Try rephrasing, or choose another model in ⚙ settings.");
      state.messages.push({ role: "assistant", content: text });
      finishMessage(view, text, sources, usage, notes, settings);
    } catch (err) {
      view.status.hidden = true;
      if (err.name === "AbortError") {
        if (text) { render(); state.messages.push({ role: "assistant", content: text }); finishMessage(view, text, sources, usage, ["Stopped."], settings); }
        else { view.root.remove(); state.messages.pop(); }
      } else {
        state.messages.pop();   // let the learner retry the same question
        var e = document.createElement("div");
        e.className = "ai-error";
        e.textContent = err.message || String(err);
        if (err.message && /fetch|network/i.test(err.message)) e.textContent += " Check your internet connection and the API base URL.";
        view.root.appendChild(e);
        if (err.status === 401) toggleSettings(true, "Your API key was rejected. Please check it.");
      }
    } finally {
      state.controller = null;
      setBusy(false);
      scrollToBottom();
    }
  }

  function finishMessage(view, text, sources, usage, notes, settings) {
    view.status.hidden = true;
    if (window.hljs) view.bubble.querySelectorAll("pre code").forEach(function (c) { try { window.hljs.highlightElement(c); } catch (e) { /* ignore */ } });
    if (sources.length) {
      view.sources.hidden = false;
      view.sources.innerHTML = "<b>Sources</b><ol>" + sources.map(function (s) {
        var safe = /^https?:\/\//i.test(s.url) ? s.url : "#";
        return '<li><a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + "</a></li>";
      }).join("") + "</ol>";
    }
    var bits = [esc(settings.model)];
    if (usage && usage.total_tokens) bits.push(usage.total_tokens.toLocaleString() + " tokens");
    if (settings.webSearch && !notes.some(function (n) { return /web search/i.test(n); })) bits.push(sources.length ? sources.length + " source" + (sources.length > 1 ? "s" : "") : "no web sources cited");
    view.meta.hidden = false;
    view.meta.innerHTML = "<span>" + bits.join(" · ") + "</span>" + notes.map(function (n) { return "<span>⚠ " + esc(n) + "</span>"; }).join("") +
      '<button type="button" data-copy>Copy answer</button>';
    view.meta.querySelector("[data-copy]").addEventListener("click", function (e) {
      var copy = window.InfraSimCopy || function (t) { return navigator.clipboard.writeText(t); };
      copy(text).then(function () { e.target.textContent = "Copied"; setTimeout(function () { e.target.textContent = "Copy answer"; }, 1400); },
                      function () { e.target.textContent = "Copy failed"; });
    });
  }

  /* ---------- selection triggers ---------- */
  function hideFab() { ui.fab.classList.remove("show"); }
  function maybeShowFab() {
    if (!ui.backdrop.hidden) return hideFab();
    var sel = selectionInfo();
    if (!sel || sel.text.length < 2) return hideFab();
    var rects = sel.range.getClientRects();
    var r = rects.length ? rects[rects.length - 1] : sel.range.getBoundingClientRect();
    var x = Math.min(window.innerWidth - 110, Math.max(8, r.right - 40));
    var y = r.bottom + 8;
    if (y > window.innerHeight - 44) y = Math.max(8, r.top - 40);
    ui.fab.style.left = x + "px";
    ui.fab.style.top = y + "px";
    ui.fab.classList.add("show");
  }

  function wireSelection() {
    document.addEventListener("contextmenu", function (e) {
      if (e.shiftKey) return;                                    // Shift + right-click = normal browser menu
      if (!ui.backdrop.hidden) return;
      var sel = selectionInfo();
      if (!sel) return;
      if (!pointInRange(sel.range, e.clientX, e.clientY)) return; // only when right-clicking the selection itself
      e.preventDefault();
      hideFab();
      openModal(sel);
    });
    document.addEventListener("mouseup", function (e) { if (!e.target.closest || !e.target.closest(".ai-fab")) setTimeout(maybeShowFab, 10); });
    document.addEventListener("touchend", function () { setTimeout(maybeShowFab, 250); });
    document.addEventListener("keyup", function (e) { if (e.shiftKey || e.key === "Shift") maybeShowFab(); });
    document.addEventListener("selectionchange", function () {
      var s = window.getSelection();
      if (!s || s.isCollapsed) hideFab();
    });
    window.addEventListener("scroll", hideFab, { passive: true });
    window.addEventListener("resize", hideFab);
  }

  buildUI();
  wireSelection();
})();
