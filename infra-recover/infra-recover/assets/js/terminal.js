/* infra-sim — browser terminal, file editor and scenario (lab) panel. */
(function () {
  "use strict";
  var S = window.InfraSim;
  if (!S) return;
  var LAB_KEY = "infrasim.labs.v1";
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } }
  function el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (html != null) e.innerHTML = html; return e; }
  var uid = 0, terminals = [];

  /* ---------- editor dialog (nano / vi / kubectl edit) ---------- */
  var editor = null;
  function openEditor(name, text) {
    return new Promise(function (resolve) {
      if (!editor) {
        editor = el("div", { "class": "sim-editor-backdrop", hidden: "" });
        editor.innerHTML = '<div class="sim-editor" role="dialog" aria-modal="true" aria-labelledby="sim-editor-title">' +
          '<header><h2 id="sim-editor-title"></h2><span class="hint">Ctrl+S saves · Esc cancels</span></header>' +
          '<label class="sr-only" for="sim-editor-text">File contents</label>' +
          '<textarea id="sim-editor-text" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea>' +
          '<footer><button type="button" class="btn secondary" data-act="cancel">Cancel</button><button type="button" class="btn" data-act="save">Save and close</button></footer></div>';
        document.body.appendChild(editor);
      }
      var ta = editor.querySelector("textarea"), prev = document.activeElement;
      editor.querySelector("h2").textContent = "Editing " + name;
      ta.value = text; editor.hidden = false; ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0;
      function close(value) {
        editor.hidden = true; editor.removeEventListener("keydown", onKey); editor.removeEventListener("click", onClick);
        if (prev && prev.focus) prev.focus();
        resolve(value);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(null); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); close(ta.value); }
        else if (e.key === "Tab" && e.target === ta && !e.shiftKey && !e.ctrlKey) {   // YAML needs spaces, never tabs
          e.preventDefault(); var s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end");
        } else if (e.key === "Tab") {
          var f = editor.querySelectorAll("textarea, button"), first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      function onClick(e) { var act = e.target.getAttribute && e.target.getAttribute("data-act"); if (act === "save") close(ta.value); else if (act === "cancel" || e.target === editor) close(null); }
      editor.addEventListener("keydown", onKey); editor.addEventListener("click", onClick);
    });
  }

  /* ---------- tab completion ---------- */
  var SUBS = {
    docker: "build compose container cp exec history image images info inspect kill login logs network port ps pull push restart rm rmi run search start stats stop system tag top version volume".split(" "),
    kubectl: "annotate api-resources apply auth cluster-info config cordon create delete describe diff drain edit events exec explain expose get label logs patch port-forward rollout run scale set taint top uncordon version wait".split(" "),
    helm: "create get history install lint list pull repo rollback search show status template uninstall upgrade version".split(" "),
    argocd: "admin app cluster login proj repo version".split(" "),
    git: "add branch checkout clone commit diff log pull push restore revert status".split(" ")
  };
  SUBS.k = SUBS.kubectl;
  var SUB2 = { "docker compose": "build config down exec logs ps restart start stop up".split(" "), "docker network": "connect create disconnect inspect ls prune rm".split(" "), "docker volume": "create inspect ls prune rm".split(" "), "docker image": "history inspect ls prune rm".split(" "), "docker system": "df prune".split(" "),
    "kubectl rollout": "history pause restart resume status undo".split(" "), "kubectl set": "env image resources".split(" "), "kubectl config": "current-context get-contexts set-context view".split(" "), "kubectl auth": "can-i whoami".split(" "), "kubectl top": "node pod".split(" "),
    "helm repo": "add list remove update".split(" "), "helm get": "all manifest notes values".split(" "), "helm show": "all chart values".split(" "), "helm search": ["repo"],
    "argocd app": "create delete diff get history list rollback set sync wait".split(" "), "argocd repo": "add list rm".split(" "), "argocd proj": "create get list".split(" ") };
  SUB2["k rollout"] = SUB2["kubectl rollout"]; SUB2["k set"] = SUB2["kubectl set"];
  var KTYPES = "pods deployments services configmaps secrets namespaces nodes ingresses replicasets statefulsets daemonsets jobs cronjobs endpoints events persistentvolumeclaims persistentvolumes storageclasses networkpolicies resourcequotas serviceaccounts roles rolebindings applications all".split(" ");
  function complete(sim, text) {
    var m = /(\S*)$/.exec(text), word = m[1], before = text.slice(0, text.length - word.length), words = before.trim().split(/\s+/).filter(Boolean), sc = sim.scope(), cands = [];
    var amp = before.lastIndexOf("&&"), lastPipe = Math.max(before.lastIndexOf("|"), before.lastIndexOf(";"), amp < 0 ? -1 : amp + 1);
    if (lastPipe >= 0) words = before.slice(lastPipe + 1).trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      cands = sc.type === "host" ? Object.keys(S.commands).concat(["cat", "cd", "clear", "cp", "curl", "echo", "grep", "head", "help", "history", "ls", "mkdir", "mv", "nano", "pwd", "rm", "sed", "sleep", "tail", "touch", "wc"]) : (sc.proc.image.tools || []).concat(["exit"]);
    } else if (sc.type === "host" && words.length === 1 && SUBS[words[0]] && word[0] !== "-" && word.indexOf("/") < 0) cands = SUBS[words[0]];
    else if (sc.type === "host" && words.length === 2 && SUB2[words[0] + " " + words[1]] && word[0] !== "-") cands = SUB2[words[0] + " " + words[1]];
    else if (sc.type === "host" && (words[0] === "kubectl" || words[0] === "k") && ["get", "describe", "delete", "edit"].indexOf(words[1]) >= 0 && words.length === 2 && word[0] !== "-") cands = KTYPES;
    else if (sc.type === "host" && (words[0] === "kubectl" || words[0] === "k") && words.length >= 3 && word[0] !== "-" && sim.k8s) {
      var kd = S.k8s.BY_NAME[(words[1] === "logs" || words[1] === "exec" || words[1] === "port-forward" ? "pods" : words[2] || "").toLowerCase()], nsI = words.indexOf("-n"), ns = nsI >= 0 ? words[nsI + 1] : sim.k8s.currentNs;
      if (words[nsI >= 0 ? words.length - 1 : -1] === "-n") cands = sim.k8s.list("Namespace").map(function (n) { return n.metadata.name; });
      else if (kd) cands = sim.k8s.list(kd.kind, kd.namespaced ? ns : null).map(function (o) { return o.metadata.name; });
    } else if (sc.type === "host" && words[0] === "docker" && ["stop", "start", "restart", "rm", "logs", "exec", "inspect", "kill", "top", "port"].indexOf(words[1]) >= 0 && word[0] !== "-") cands = sim.docker.containers.map(function (c) { return c.name; });
    if (!cands.length || /[./~]/.test(word)) {   // file names
      var slash = word.lastIndexOf("/"), dirPart = slash >= 0 ? word.slice(0, slash + 1) : "", base = word.slice(slash + 1);
      var dir = S.util.norm((dirPart || ".").replace(/^~/, sc.env.HOME || "/"), sc.cwd);
      if (sc.fs.isDir(dir)) {
        var files = sc.fs.list(dir).filter(function (n) { return n.indexOf(base) === 0 && (base[0] === "." || n[0] !== "."); }).map(function (n) { return dirPart + n + (sc.fs.isDir(S.util.norm(n, dir)) ? "/" : ""); });
        if (files.length || /[./~]/.test(word)) cands = files;
      }
    }
    cands = cands.filter(function (c, i, l) { return c.indexOf(word) === 0 && l.indexOf(c) === i; }).sort();
    if (!cands.length) return { text: text, list: [] };
    var common = cands[0];
    cands.forEach(function (c) { while (c.indexOf(common) !== 0) common = common.slice(0, -1); });
    return { text: before + common + (cands.length === 1 && !/\/$/.test(common) ? " " : ""), list: cands.length > 1 && common === word ? cands : [] };
  }

  /* ---------- terminal ---------- */
  function Terminal(host, opts) {
    opts = opts || {};
    var self = this, id = ++uid;
    this.host = host; this.opts = opts; this.sim = null; this.hist = []; this.hpos = 0; this.buffer = ""; this.onChange = opts.onChange || function () {};
    host.classList.add("term");
    host.innerHTML = '<div class="term-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="term-title">' + (opts.title || "sandbox") + '</span>' +
      '<button type="button" class="term-btn" data-act="clear" title="Clear the screen (Ctrl+L)">Clear</button></div>' +
      '<div class="term-out" id="term-out-' + id + '" role="log" aria-label="Terminal output" tabindex="0"></div>' +
      '<form class="term-in" autocomplete="off"><label class="sr-only" for="term-input-' + id + '">Terminal command input</label><span class="term-prompt" aria-hidden="true"></span>' +
      '<input id="term-input-' + id + '" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-describedby="term-out-' + id + '" enterkeyhint="send"></form>';
    this.out = host.querySelector(".term-out"); this.input = host.querySelector("input"); this.promptEl = host.querySelector(".term-prompt");
    host.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); self.enter(); });
    host.querySelector('[data-act="clear"]').addEventListener("click", function () { self.clear(); self.input.focus(); });
    this.out.addEventListener("click", function () { if (!String(window.getSelection())) self.input.focus({ preventScroll: true }); });
    this.input.addEventListener("keydown", function (e) { self.key(e); });
    this.input.addEventListener("paste", function (e) {
      var text = (e.clipboardData || window.clipboardData).getData("text");
      if (text.indexOf("\n") < 0) return;
      e.preventDefault(); self.pasteLines(self.input.value + text);
    });
    terminals.push(this);
  }
  Terminal.prototype.boot = function (sim) { this.sim = sim; this.paintPrompt(); };
  Terminal.prototype.paintPrompt = function () { this.promptEl.textContent = this.buffer ? "> " : this.sim.prompt(); };
  Terminal.prototype.print = function (text, cls) {
    if (!text) return;
    var out = this.out, last = out.lastChild, span = el("span", cls ? { "class": cls } : null);
    span.textContent = text;
    out.appendChild(span);
    while (out.childNodes.length > 1500) out.removeChild(out.firstChild);
    out.scrollTop = out.scrollHeight;
    void last;
  };
  Terminal.prototype.clear = function () { this.out.textContent = ""; };
  Terminal.prototype.transcript = function (max) { var t = this.out.textContent || ""; return t.length > max ? t.slice(-max) : t; };
  Terminal.prototype.key = function (e) {
    var input = this.input, self = this;
    if (e.key === "ArrowUp") { if (this.hpos > 0) { this.hpos--; input.value = this.hist[this.hpos]; e.preventDefault(); setTimeout(function () { input.setSelectionRange(input.value.length, input.value.length); }, 0); } }
    else if (e.key === "ArrowDown") { if (this.hpos < this.hist.length) { this.hpos++; input.value = this.hist[this.hpos] || ""; e.preventDefault(); } }
    else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && input.value.trim()) {
      e.preventDefault();
      var r = complete(this.sim, input.value.slice(0, input.selectionStart)), rest = input.value.slice(input.selectionStart);
      input.value = r.text + rest; input.setSelectionRange(r.text.length, r.text.length);
      if (r.list.length) { this.print(this.promptEl.textContent + input.value + "\n", "term-echo"); this.print(r.list.join("  ") + "\n"); }
    }
    else if (e.ctrlKey && e.key.toLowerCase() === "c" && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      if (this.sim.busy) this.sim.abort();
      else { this.print(this.promptEl.textContent + input.value + "^C\n", "term-echo"); input.value = ""; this.buffer = ""; this.paintPrompt(); }
    }
    else if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); this.clear(); }
    else if (e.ctrlKey && e.key.toLowerCase() === "u") { e.preventDefault(); input.value = ""; }
    void self;
  };
  Terminal.prototype.enter = function () {
    if (this.sim.busy) return;
    var line = this.input.value;
    this.input.value = "";
    this.print(this.promptEl.textContent + line + "\n", "term-echo");
    if (line.trim()) { if (this.hist[this.hist.length - 1] !== line) this.hist.push(line); }
    this.hpos = this.hist.length;
    this.buffer += (this.buffer ? "\n" : "") + line;
    if (this.sim.needsMore(this.buffer)) { this.paintPrompt(); return; }
    var script = this.buffer; this.buffer = "";
    return this.exec(script);
  };
  Terminal.prototype.pasteLines = async function (text) {
    var lines = text.replace(/\r/g, "").split("\n"), buf = "";
    this.input.value = "";
    for (var i = 0; i < lines.length; i++) {
      if (i === lines.length - 1 && !buf && lines[i].trim()) { this.input.value = lines[i]; break; }   // last line stays editable
      buf += (buf ? "\n" : "") + lines[i];
      if (this.sim.needsMore(buf)) continue;
      if (buf.trim()) { this.print(this.sim.prompt() + buf.replace(/\n/g, "\n> ") + "\n", "term-echo"); this.hist.push(buf.split("\n")[0]); await this.exec(buf); }
      buf = "";
    }
    if (buf) { this.buffer = buf; this.print(this.sim.prompt() + buf.replace(/\n/g, "\n> ") + "\n", "term-echo"); }
    this.hpos = this.hist.length; this.paintPrompt();
  };
  Terminal.prototype.exec = async function (script) {
    var self = this;
    this.host.classList.add("busy"); this.promptEl.textContent = "";
    try { await this.sim.run(script, { out: function (t) { self.print(t); }, err: function (t) { self.print(t, "term-err"); } }); }
    catch (e) { this.print("sandbox error: " + (e && e.message ? e.message : e) + "\n(this is a bug in the simulator, not in your command)\n", "term-err"); if (window.console) console.error(e); }
    this.host.classList.remove("busy");
    this.paintPrompt(); this.onChange();
    this.input.focus({ preventScroll: true });
  };
  /* Run commands as if typed (used by "Run" buttons). */
  Terminal.prototype.type = function (text) { if (this.sim.busy) return; this.input.value = ""; return this.pasteLines(text + "\n"); };

  function newSim(term) {
    var sim = new S.Sim({ realtime: true, speed: 4 });
    sim.ui = { edit: openEditor, clear: function () { term.clear(); }, print: function (t) { term.print(t); } };
    return sim;
  }
  // one shared clock: simulated time advances by a second per real second while a terminal is idle
  setInterval(function () {
    if (document.hidden) return;
    terminals.forEach(function (t) { if (t.sim && !t.sim.busy && t.host.isConnected) { try { t.sim.advance(1000); } catch (e) { if (window.console) console.error(e); } t.onChange(true); } });
  }, 1000);

  /* ---------- lab panel ---------- */
  var TECH = { docker: "Docker", compose: "Docker Compose", kubernetes: "Kubernetes", helm: "Helm", argocd: "Argo CD", mixed: "Full stack" };
  var LEVELS = ["", "Easy", "Easy", "Medium", "Hard", "Expert"];
  function Lab(host, id) {
    var def = S.labs && S.labs[id], self = this;
    this.host = host; this.id = id; this.def = def;
    if (!def) { host.innerHTML = '<p class="callout warn">Unknown lab "' + id + '".</p>'; return; }
    var n = ++uid;
    host.classList.add("lab-ready");
    host.innerHTML =
      '<header class="lab-head"><div><span class="lab-kicker">' + (def.fix ? "🔧 Fix-it scenario" : "🧪 Hands-on scenario") + ' · ' + (TECH[def.tech] || def.tech) + ' · ' + LEVELS[def.level || 1] + '</span>' +
      '<h3 class="lab-title" id="lab-title-' + n + '">' + def.title + '</h3></div>' +
      '<div class="lab-actions"><button type="button" class="btn" data-act="start">▶ Start the sandbox</button><button type="button" class="icon-btn" data-act="reset" hidden>↺ Reset</button></div></header>' +
      '<div class="lab-story">' + def.story + '</div>' +
      '<div class="lab-body" hidden><div class="lab-side"><h4 class="lab-h">Your tasks</h4><ol class="lab-tasks"></ol><div class="lab-diagnose"></div><p class="lab-status" role="status" aria-live="polite"></p></div>' +
      '<div class="lab-term" role="group" aria-labelledby="lab-title-' + n + '"></div></div>' +
      '<details class="lab-solution"><summary>Stuck? Show the solution and the explanation</summary><div class="lab-solution-body"></div></details>';
    this.body = host.querySelector(".lab-body"); this.tasksEl = host.querySelector(".lab-tasks"); this.statusEl = host.querySelector(".lab-status");
    host.querySelector('[data-act="start"]').addEventListener("click", function () { self.start(); });
    host.querySelector('[data-act="reset"]').addEventListener("click", function () { self.start(); });
    this.renderSolution();
    if (load(LAB_KEY, []).indexOf(id) >= 0) host.classList.add("lab-done");
  }
  Lab.prototype.renderSolution = function () {
    var def = this.def, esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }, html = "", run = [];
    (def.solution || []).forEach(function (step) {
      if (typeof step === "string") { run.push(step); return; }
      if (run.length) { html += "<pre><code class=\"language-bash\">" + esc(run.join("\n")) + "</code></pre>"; run = []; }
      if (step.note) html += "<p>" + step.note + "</p>";
      if (step.file) html += "<p>Edit <code>" + esc(step.file) + "</code> (<code>nano " + esc(step.file) + "</code>) so that it contains:</p><pre><code class=\"language-" + (/\.ya?ml$/.test(step.file) ? "yaml" : /Dockerfile/.test(step.file) ? "dockerfile" : "plaintext") + "\">" + esc(step.content.replace(/\n$/, "")) + "</code></pre>";
    });
    if (run.length) html += "<pre><code class=\"language-bash\">" + esc(run.join("\n")) + "</code></pre>";
    if (def.explain) html += '<div class="callout tip"><span class="title">Why this works</span>' + def.explain + "</div>";
    this.host.querySelector(".lab-solution-body").innerHTML = html;
    if (window.InfraSimCourse && window.InfraSimCourse.decorateCode) window.InfraSimCourse.decorateCode(this.host.querySelector(".lab-solution-body"));
  };
  Lab.prototype.start = async function () {
    var self = this, def = this.def, host = this.host, startBtn = host.querySelector('[data-act="start"]');
    if (this.starting) return;
    this.starting = true;
    this.body.hidden = false; startBtn.hidden = true; host.querySelector('[data-act="reset"]').hidden = false;
    var termHost = host.querySelector(".lab-term");
    if (this.term) { terminals.splice(terminals.indexOf(this.term), 1); }
    termHost.innerHTML = ""; var inner = el("div"); termHost.appendChild(inner);
    var term = this.term = new Terminal(inner, { title: "sandbox — " + def.title.replace(/<[^>]+>/g, ""), onChange: function (quiet) { self.check(quiet); } });
    var sim = newSim(term);
    this.h = S.labHelpers(sim); this.done = {}; this.answered = false; this.finished = false;
    term.print("Preparing the scenario...\n", "term-info");
    sim.realtime = false;
    try { if (def.setup) await def.setup(sim, this.h); } catch (e) { term.print("setup failed: " + (e && e.message) + "\n", "term-err"); if (window.console) console.error(e); }
    sim.history = []; sim.host.cwd = def.cwd || sim.host.cwd; sim.realtime = true;
    term.clear();
    term.print((def.banner || "The sandbox is ready. Type  help  to see what this shell can do.") + "\n\n", "term-info");
    term.boot(sim);
    this.renderTasks(); this.check(true);
    this.starting = false;
    term.input.focus({ preventScroll: true });
  };
  Lab.prototype.renderTasks = function () {
    var self = this, def = this.def;
    this.tasksEl.innerHTML = "";
    (def.tasks || []).forEach(function (t, i) {
      var li = el("li", { "class": "lab-task" });
      li.innerHTML = '<span class="mark" aria-hidden="true"></span><div><div class="text">' + t.text + '</div>' + (t.hint ? '<details class="hint"><summary>Hint</summary><div>' + t.hint + "</div></details>" : "") + '<span class="sr-only state">not done yet</span></div>';
      self.tasksEl.appendChild(li); void i;
    });
    var dg = this.host.querySelector(".lab-diagnose"), d = def.diagnose;
    dg.innerHTML = "";
    if (d) {
      var qid = "lab-q-" + (++uid);
      dg.innerHTML = '<h4 class="lab-h">Diagnosis check</h4><p class="q" id="' + qid + '">' + d.q + '</p><div class="opts" role="group" aria-labelledby="' + qid + '">' + d.options.map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '">' + o + "</button>"; }).join("") + '</div><p class="explain" aria-live="polite"></p>';
      dg.querySelectorAll("button.opt").forEach(function (b) {
        b.addEventListener("click", function () {
          var i = +b.getAttribute("data-i"), ex = dg.querySelector(".explain");
          dg.querySelectorAll("button.opt").forEach(function (x) { x.classList.remove("wrong"); });
          if (i === d.answer) { b.classList.add("correct"); dg.querySelectorAll("button.opt").forEach(function (x) { x.disabled = true; }); ex.innerHTML = "<b>Correct.</b> " + d.why; self.answered = true; self.check(); }
          else { b.classList.add("wrong"); ex.innerHTML = "<b>Not quite.</b> " + (d.wrong || "Look at the command output again: which line names the actual failure?"); }
        });
      });
    }
  };
  Lab.prototype.check = function (quiet) {
    if (!this.term || !this.term.sim || this.starting) return;
    var self = this, def = this.def, items = this.tasksEl.children, all = true, count = 0;
    (def.tasks || []).forEach(function (t, i) {
      var ok = false;
      try { ok = !!t.check(self.term.sim, self.h); } catch (e) { ok = false; }
      if (t.sticky && self.done[i]) ok = true;
      if (ok) self.done[i] = true;
      if (items[i]) { items[i].classList.toggle("done", ok); var s = items[i].querySelector(".state"); if (s) s.textContent = ok ? "done" : "not done yet"; }
      if (ok) count++; else all = false;
    });
    var total = (def.tasks || []).length;
    if (all && total && !this.finished) {
      this.finished = true;
      this.host.classList.add("lab-done");
      var list = load(LAB_KEY, []); if (list.indexOf(this.id) < 0) { list.push(this.id); save(LAB_KEY, list); }
      this.statusEl.innerHTML = "<b>✓ Scenario solved.</b> " + (def.explain ? "Open the solution below to read why the fix works." : "Nice work.");
      var sol = this.host.querySelector(".lab-solution"); if (sol && def.explain) sol.open = true;
      document.dispatchEvent(new CustomEvent("infrasim:lab-done", { detail: { id: this.id } }));
    } else if (!this.finished && !quiet) this.statusEl.textContent = count + " of " + total + " tasks done.";
    else if (!this.finished && !this.statusEl.textContent) this.statusEl.textContent = count + " of " + total + " tasks done.";
  };

  function mount(root) {
    (root || document).querySelectorAll("[data-lab]").forEach(function (host) { if (!host.classList.contains("lab-ready")) host._lab = new Lab(host, host.getAttribute("data-lab")); });
  }
  window.InfraSimUI = {
    Terminal: Terminal, Lab: Lab, mount: mount, newSim: newSim, TECH: TECH, LEVELS: LEVELS,
    completed: function () { return load(LAB_KEY, []); },
    /* Recent terminal activity, for the AI tutor's context. */
    context: function () {
      var t = terminals.filter(function (x) { return x.sim && x.host.isConnected; }).pop();
      return t ? t.transcript(2500) : "";
    }
  };
  mount(document);
})();
