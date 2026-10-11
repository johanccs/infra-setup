/* infra-sim — navigation, progress, quizzes */
(function () {
  "use strict";

  var LEVELS = [
    { id: 1, name: "Docker foundations", subtitle: "Containers and images",
      goal: "Run, inspect, build and persist containers with confidence.",
      desc: "Your first containers, looking inside them, ports and configuration, building images, and keeping data." },
    { id: 2, name: "Docker networking & Compose", subtitle: "Multi-container apps",
      goal: "Connect containers into an application and debug it methodically.",
      desc: "Networks and DNS, Docker Compose, and a repeatable method for finding out why a container misbehaves." },
    { id: 3, name: "Kubernetes foundations", subtitle: "The core objects",
      goal: "Deploy, expose, configure and update an application on a cluster.",
      desc: "How the cluster works, Deployments, Services, ConfigMaps and Secrets, rollouts, probes and resources." },
    { id: 4, name: "Kubernetes troubleshooting", subtitle: "When pods won't run",
      goal: "Diagnose any stuck pod or unreachable Service from its symptoms.",
      desc: "The debugging loop, Pending pods, broken networking, storage, and namespaces, RBAC and quotas." },
    { id: 5, name: "Helm", subtitle: "Packaging and releases",
      goal: "Install, write, upgrade and repair Helm releases.",
      desc: "Charts, values and releases, writing and debugging templates, upgrades, rollbacks and stuck releases." },
    { id: 6, name: "Argo CD & GitOps", subtitle: "Git as the source of truth",
      goal: "Operate applications through git and fix them when Argo CD says no.",
      desc: "Applications, sync and health, automated sync and self-heal, and troubleshooting the whole stack." }
  ];

  var LESSONS = [
    { id: 1,  level: 1, slug: "01-first-container",        title: "Containers and Images: Your First Container", summary: "What a container is, images, docker run, ps, stop, rm." },
    { id: 2,  level: 1, slug: "02-inside-a-container",     title: "Inside a Container: Logs, Exec, Inspect",     summary: "The container lifecycle and the three commands that explain it." },
    { id: 3,  level: 1, slug: "03-ports-env-restarts",     title: "Ports, Environment Variables and Restart Policies", summary: "Publishing ports, configuration, restart behaviour." },
    { id: 4,  level: 1, slug: "04-building-images",        title: "Building Images: Dockerfile, Layers and Cache", summary: "Instructions, layer caching, multi-stage builds." },
    { id: 5,  level: 1, slug: "05-volumes",                title: "Volumes: Data That Survives the Container",   summary: "Writable layer, named volumes, bind mounts." },
    { id: 6,  level: 2, slug: "06-networking",             title: "Container Networking and DNS",                summary: "Bridge networks, name resolution, what -p really does." },
    { id: 7,  level: 2, slug: "07-compose",                title: "Docker Compose: A Whole Stack in One File",   summary: "Services, networks, volumes, up/down, logs." },
    { id: 8,  level: 2, slug: "08-troubleshooting-docker", title: "Troubleshooting Docker: A Method",            summary: "State, logs, configuration, connectivity; exit codes." },
    { id: 9,  level: 3, slug: "09-how-kubernetes-works",   title: "How Kubernetes Works",                        summary: "Control plane, nodes, the API, kubectl, namespaces." },
    { id: 10, level: 3, slug: "10-pods-and-deployments",   title: "Pods, Deployments and Self-Healing",          summary: "Declarative YAML, ReplicaSets, reconciliation." },
    { id: 11, level: 3, slug: "11-services-and-dns",       title: "Services and DNS",                            summary: "ClusterIP, NodePort, selectors, endpoints." },
    { id: 12, level: 3, slug: "12-configmaps-and-secrets", title: "ConfigMaps and Secrets",                      summary: "Configuration as env vars and files; what Secrets are not." },
    { id: 13, level: 3, slug: "13-rollouts-and-rollbacks", title: "Rollouts and Rollbacks",                      summary: "Rolling updates, history, undo, stuck rollouts." },
    { id: 14, level: 3, slug: "14-probes-and-resources",   title: "Health Probes, Requests and Limits",          summary: "Readiness, liveness, OOMKilled, QoS." },
    { id: 15, level: 4, slug: "15-the-debugging-loop",     title: "The Debugging Loop: Get, Describe, Logs",     summary: "Reading pod statuses and finding the evidence." },
    { id: 16, level: 4, slug: "16-pending-pods",           title: "Pending Pods: Scheduling, Taints and Nodes",  summary: "Requests, selectors, taints, cordon and drain." },
    { id: 17, level: 4, slug: "17-broken-networking",      title: "Broken Networking: Services, Ingress, Policies", summary: "The connectivity checklist, Ingress, NetworkPolicy." },
    { id: 18, level: 4, slug: "18-storage",                title: "Storage and Stateful Apps",                   summary: "PVCs, StorageClasses, StatefulSets." },
    { id: 19, level: 4, slug: "19-namespaces-rbac-quotas", title: "Namespaces, RBAC and Quotas",                 summary: "Isolation, least privilege, Forbidden, quota errors." },
    { id: 20, level: 5, slug: "20-helm-basics",            title: "Helm Basics: Charts, Releases, Values",       summary: "Repositories, install, upgrade, what Helm stores." },
    { id: 21, level: 5, slug: "21-writing-charts",         title: "Writing and Debugging Charts",                summary: "Templates, values, helpers, lint and template." },
    { id: 22, level: 5, slug: "22-upgrades-and-rollbacks", title: "Upgrades, Rollbacks and Broken Releases",     summary: "Value handling, --wait, history, pending releases." },
    { id: 23, level: 6, slug: "23-gitops-with-argocd",     title: "GitOps with Argo CD: Your First Application", summary: "Source, destination, sync status and health." },
    { id: 24, level: 6, slug: "24-sync-policies",          title: "Sync Policies, Drift and Rolling Back with Git", summary: "Automated sync, prune, self-heal, git revert." },
    { id: 25, level: 6, slug: "25-troubleshooting-argocd", title: "Troubleshooting Argo CD and the Capstone",    summary: "Comparison, sync and health errors; launch day." }
  ];

  var VERSION = "1.0.0";   // bump on every release; keep package.json in sync

  var STORE_KEY = "infrasim.completed.v1";
  var THEME_KEY = "infrasim.theme";

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  var completed = load(STORE_KEY, []);
  function isDone(id) { return completed.indexOf(id) !== -1; }
  function setDone(id, done) {
    completed = completed.filter(function (x) { return x !== id; });
    if (done) completed.push(id);
    save(STORE_KEY, completed);
  }

  var body = document.body;
  var root = body.getAttribute("data-root") || "";
  var currentId = parseInt(body.getAttribute("data-lesson") || "0", 10);
  var page = body.getAttribute("data-page") || "";

  function href(lesson) { return root + "lessons/" + lesson.slug + ".html"; }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- Theme ---------- */
  var savedTheme = load(THEME_KEY, null);
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  function currentTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /* ---------- Top bar ---------- */
  function buildTopbar() {
    var bar = el("header", { "class": "topbar" });
    bar.innerHTML =
      '<button type="button" class="icon-btn" id="menu-btn" aria-label="Toggle lesson menu">☰</button>' +
      '<a class="brand" href="' + root + 'index.html"><span class="logo">&gt;_</span><span>infra-sim</span></a>' +
      '<span class="version" title="Course version">v' + VERSION + '</span>' +
      '<span class="spacer"></span>' +
      '<span class="progress-pill" id="progress-pill"></span>' +
      '<button type="button" class="icon-btn" id="theme-btn" aria-label="Toggle dark mode"></button>';
    var skip = body.querySelector(".skip-link");      // keep the skip link as the first focusable element
    body.insertBefore(bar, skip ? skip.nextSibling : body.firstChild);
    var themeBtn = bar.querySelector("#theme-btn");
    function paint() { themeBtn.textContent = currentTheme() === "dark" ? "☀ Light" : "☾ Dark"; }
    paint();
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      save(THEME_KEY, next);
      paint();
    });
    var menuBtn = bar.querySelector("#menu-btn");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-controls", "sidebar");
    menuBtn.addEventListener("click", function () {
      var open = body.classList.toggle("nav-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function updateProgressPill() {
    var pill = document.getElementById("progress-pill");
    if (pill) pill.textContent = completed.length + " / " + LESSONS.length + " lessons completed";
  }

  /* ---------- Sidebar ---------- */
  function buildSidebar() {
    var nav = document.getElementById("sidebar");
    if (!nav) return;
    var prevSearch = document.getElementById("course-search");
    var prevQuery = prevSearch ? prevSearch.value : "";
    var html = '<div class="search" role="search">' +
      '<label class="sr-only" for="course-search">Search the course</label>' +
      '<input id="course-search" type="search" autocomplete="off" placeholder="Search lessons…  ( / )" aria-controls="search-results">' +
      '<div id="search-results" class="search-results" hidden></div></div>' +
      '<a class="lesson-link' + (page === "home" ? " active" : "") + '" href="' + root + 'index.html"><span class="num">⌂</span><span>Course home</span></a>' +
      '<a class="lesson-link' + (page === "sandbox" ? " active" : "") + '" href="' + root + 'sandbox.html"><span class="num">▶</span><span>Scenario library &amp; sandbox</span></a>';
    LEVELS.forEach(function (lv) {
      html += '<div class="level-title"><span class="dot" style="background:var(--lvl-' + lv.id + ')"></span>' +
        'Level ' + lv.id + ' · ' + lv.name + '</div>';
      LESSONS.filter(function (l) { return l.level === lv.id; }).forEach(function (l) {
        var cls = "lesson-link" + (l.id === currentId ? " active" : "") + (isDone(l.id) ? " done" : "");
        html += '<a class="' + cls + '" href="' + href(l) + '"><span class="num">' + (isDone(l.id) ? "✓" : l.id) + '</span><span>' + esc(l.title) + '</span></a>';
      });
    });
    nav.innerHTML = html;
    if (prevQuery) document.getElementById("course-search").value = prevQuery;
    wireSearch();
    var active = nav.querySelector(".active");
    if (active) {
      active.setAttribute("aria-current", "page");
      // Scroll only the sidebar (scrollIntoView would also scroll the page)
      nav.scrollTop = Math.max(0, active.offsetTop - nav.clientHeight / 2);
    }
  }

  /* ---------- Sidebar resize and collapse (desktop) ---------- */
  var SIDEBAR_KEY = "infrasim.sidebar";
  var SIDEBAR_MIN = 200, SIDEBAR_MAX = 560, SIDEBAR_DEFAULT = 300;
  function wireSidebarResize() {
    var nav = document.getElementById("sidebar");
    if (!nav) return;
    var docEl = document.documentElement;
    var state = load(SIDEBAR_KEY, {});
    var width = typeof state.w === "number" ? clampWidth(state.w) : SIDEBAR_DEFAULT;

    var rail = el("aside", { "class": "sidebar-rail", "aria-label": "Lesson menu size" });
    rail.innerHTML =
      '<div class="sidebar-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="sidebar"' +
      ' aria-label="Resize lesson menu" aria-valuemin="' + SIDEBAR_MIN + '" aria-valuemax="' + SIDEBAR_MAX + '"' +
      ' title="Drag to resize · double-click to reset"></div>' +
      '<button type="button" class="sidebar-toggle" aria-controls="sidebar"></button>';
    nav.parentNode.insertBefore(rail, nav.nextSibling);
    var handle = rail.querySelector(".sidebar-resizer");
    var toggle = rail.querySelector(".sidebar-toggle");

    function clampWidth(w) { return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w))); }
    function collapsed() { return docEl.classList.contains("sidebar-collapsed"); }
    function persist() { save(SIDEBAR_KEY, { w: width, collapsed: collapsed() }); }
    function apply() {
      docEl.style.setProperty("--sidebar-w", width + "px");
      handle.setAttribute("aria-valuenow", String(width));
      var c = collapsed();
      toggle.textContent = c ? "»" : "«";
      toggle.setAttribute("aria-label", c ? "Show lesson menu" : "Hide lesson menu");
      toggle.title = c ? "Show lesson menu" : "Hide lesson menu";
      toggle.setAttribute("aria-expanded", c ? "false" : "true");
      handle.hidden = c;
    }
    function setCollapsed(c) { docEl.classList.toggle("sidebar-collapsed", c); apply(); persist(); }
    apply();

    toggle.addEventListener("click", function () { setCollapsed(!collapsed()); });

    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      body.classList.add("sidebar-resizing");
      var left = nav.getBoundingClientRect().left;
      function move(ev) {
        var raw = ev.clientX - left;
        if (raw < SIDEBAR_MIN / 2) return;          // far left: collapse on release
        width = clampWidth(raw);
        apply();
      }
      function up(ev) {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        body.classList.remove("sidebar-resizing");
        if (ev.type === "pointerup" && ev.clientX - left < SIDEBAR_MIN / 2) setCollapsed(true);
        else persist();
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", function () { width = SIDEBAR_DEFAULT; apply(); persist(); });
    handle.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 60 : 20;
      if (e.key === "ArrowLeft") width = clampWidth(width - step);
      else if (e.key === "ArrowRight") width = clampWidth(width + step);
      else if (e.key === "Home") width = SIDEBAR_MIN;
      else if (e.key === "End") width = SIDEBAR_MAX;
      else return;
      e.preventDefault();
      apply();
      persist();
    });
  }

  /* ---------- Full-text search ---------- */
  var searchLoading = null;
  function loadSearchIndex() {
    if (window.INFRASIM_SEARCH_INDEX) return Promise.resolve(window.INFRASIM_SEARCH_INDEX);
    if (!searchLoading) {
      searchLoading = new Promise(function (resolve) {
        var sc = document.createElement("script");
        sc.src = root + "assets/js/search-index.js";
        sc.onload = function () { resolve(window.INFRASIM_SEARCH_INDEX || []); };
        sc.onerror = function () { resolve([]); };
        document.head.appendChild(sc);
      });
    }
    return searchLoading;
  }

  function searchIndex(index, query) {
    var terms = query.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
    if (!terms.length) return [];
    var results = [];
    index.forEach(function (e) {
      var text = e.x.toLowerCase(), head = e.h.toLowerCase(), title = e.t.toLowerCase(), score = 0;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var inText = text.indexOf(t) !== -1, inHead = head.indexOf(t) !== -1, inTitle = title.indexOf(t) !== -1;
        if (!inText && !inHead && !inTitle) return;          // every term must match
        score += (inHead ? 8 : 0) + (inTitle ? 4 : 0) + Math.min(text.split(t).length - 1, 5);
      }
      results.push({ e: e, score: score });
    });
    results.sort(function (a, b) { return b.score - a.score || a.e.l - b.e.l; });
    return results.slice(0, 12);
  }

  function snippet(text, term) {
    var lower = text.toLowerCase(), t = term.toLowerCase();
    var i = lower.indexOf(t);
    var start = Math.max(0, i - 50), stop = Math.min(text.length, start + 150);
    var piece = text.slice(start, stop), out = "", pos = 0, lp = piece.toLowerCase();
    // Highlight on raw text, escape each segment (never regex over escaped HTML)
    if (t.length > 1) {
      for (var j = lp.indexOf(t); j !== -1; j = lp.indexOf(t, pos)) {
        out += esc(piece.slice(pos, j)) + "<mark>" + esc(piece.slice(j, j + t.length)) + "</mark>";
        pos = j + t.length;
      }
    }
    out += esc(piece.slice(pos));
    return (start > 0 ? "…" : "") + out + (stop < text.length ? "…" : "");
  }

  function wireSearch() {
    var input = document.getElementById("course-search");
    var box = document.getElementById("search-results");
    if (!input || !box) return;
    var timer = null;
    function run() {
      var q = input.value.trim();
      if (q.length < 2) { box.hidden = true; box.innerHTML = ""; return; }
      loadSearchIndex().then(function (index) {
        var res = searchIndex(index, q);
        var first = q.split(/\s+/).filter(function (t) { return t.length > 1; })[0] || q;
        box.innerHTML = res.length
          ? res.map(function (r) {
              var e = r.e;
              return '<a class="search-hit" href="' + root + "lessons/" + e.s + ".html" + (e.a ? "#" + e.a : "") + '">' +
                '<span class="hit-title">' + e.l + ". " + esc(e.t) + (e.h && e.h !== "Introduction" ? " › " + esc(e.h) : "") + "</span>" +
                '<span class="hit-snippet">' + snippet(e.x, first) + "</span></a>";
            }).join("")
          : '<p class="no-hits">No matches. Try fewer or different words.</p>';
        box.hidden = false;
      });
    }
    input.addEventListener("focus", loadSearchIndex);
    input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(run, 120); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { input.value = ""; run(); input.blur(); }
      if (e.key === "Enter") { var hit = box.querySelector(".search-hit"); if (hit) location.href = hit.href; }
      if (e.key === "ArrowDown") { var h = box.querySelector(".search-hit"); if (h) { e.preventDefault(); h.focus(); } }
    });
    box.addEventListener("keydown", function (e) {
      var hits = Array.prototype.slice.call(box.querySelectorAll(".search-hit"));
      var i = hits.indexOf(document.activeElement);
      if (e.key === "ArrowDown" && i < hits.length - 1) { e.preventDefault(); hits[i + 1].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? hits[i - 1] : input).focus(); }
      if (e.key === "Escape") { input.focus(); }
    });
    if (window.__simSlashBound) return;      // wireSearch runs on every sidebar rebuild
    window.__simSlashBound = true;
    document.addEventListener("keydown", function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      var input = document.getElementById("course-search");
      if (!input) return;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(tag) && !document.querySelector(".ai-backdrop:not([hidden])") && !document.querySelector(".sim-editor-backdrop:not([hidden])")) {
        e.preventDefault();
        body.classList.add("nav-open");
        input.focus();
      }
    });
  }

  /* ---------- Lesson header meta ---------- */
  function decorateLesson() {
    var lesson = LESSONS.filter(function (l) { return l.id === currentId; })[0];
    if (!lesson) return;
    var lv = LEVELS[lesson.level - 1];
    var meta = document.querySelector("article .meta");
    if (meta) {
      meta.insertAdjacentHTML("afterbegin",
        '<span class="badge lvl-' + lv.id + '">Level ' + lv.id + ' · ' + lv.name + '</span>' +
        '<span class="badge">Lesson ' + lesson.id + ' of ' + LESSONS.length + '</span>');
    }

    // Completion box
    var article = document.querySelector("article");
    var box = el("div", { "class": "complete-box" });
    article.appendChild(box);
    function paint() {
      var done = isDone(lesson.id);
      box.innerHTML = done
        ? '<p>Nice work, you\'ve completed this lesson.</p><button type="button" class="btn done" id="complete-btn">✓ Completed (click to undo)</button>'
        : '<p>Finished the reading, the scenarios and the quiz?</p><button type="button" class="btn" id="complete-btn">Mark lesson as complete</button>';
      box.querySelector("#complete-btn").addEventListener("click", function () {
        setDone(lesson.id, !isDone(lesson.id));
        paint(); buildSidebar(); updateProgressPill();
      });
    }
    paint();

    // Pager
    var pager = document.getElementById("pager");
    if (pager) {
      var prev = LESSONS[lesson.id - 2], next = LESSONS[lesson.id];
      pager.innerHTML =
        (prev ? '<a class="prev" href="' + href(prev) + '"><small>← Previous</small>' + esc(prev.title) + '</a>' : '<span></span>') +
        (next ? '<a class="next" href="' + href(next) + '"><small>Next →</small>' + esc(next.title) + '</a>'
              : '<a class="next" href="' + root + 'index.html"><small>Finished!</small>Back to course home</a>');
    }
    document.title = lesson.title + " · infra-sim";
  }

  /* ---------- Home page ---------- */
  function buildHome() {
    var host = document.getElementById("curriculum");
    if (!host) return;
    var html = "";
    LEVELS.forEach(function (lv) {
      var lessons = LESSONS.filter(function (l) { return l.level === lv.id; });
      var done = lessons.filter(function (l) { return isDone(l.id); }).length;
      html += '<section class="level-card"><header>' +
        '<span class="badge lvl-' + lv.id + '">Level ' + lv.id + '</span>' +
        '<h2>' + lv.name + ' · ' + lv.subtitle + '</h2>' +
        '<div class="bar" title="' + done + ' of ' + lessons.length + ' done"><span style="width:' + (100 * done / lessons.length) + '%"></span></div>' +
        '<small style="color:var(--muted)">' + done + '/' + lessons.length + '</small></header>' +
        '<p class="desc"><b>🎯 Goal:</b> ' + lv.goal + '<br>' + lv.desc + '</p><div class="lesson-grid">';
      lessons.forEach(function (l) {
        html += '<a class="lesson-card' + (isDone(l.id) ? " done" : "") + '" href="' + href(l) + '">' +
          '<span class="n">Lesson ' + l.id + '</span><span class="t">' + esc(l.title) + '</span><span class="s">' + esc(l.summary) + '</span></a>';
      });
      html += "</div></section>";
    });
    host.innerHTML = html;

    var resume = document.getElementById("resume-btn");
    if (resume) {
      var nextLesson = LESSONS.filter(function (l) { return !isDone(l.id); })[0];
      if (completed.length && nextLesson) { resume.href = href(nextLesson); resume.textContent = "Continue: Lesson " + nextLesson.id + " →"; }
      else if (!nextLesson) { resume.href = href(LESSONS[0]); resume.textContent = "Course complete. Review from the start"; }
      else { resume.href = href(LESSONS[0]); }
    }
    var reset = document.getElementById("reset-btn");
    if (reset) reset.addEventListener("click", function () {
      if (confirm("Reset your course progress?")) { completed = []; save(STORE_KEY, completed); buildHome(); updateProgressPill(); }
    });
  }

  /* ---------- Quizzes ---------- */
  function wireQuizzes() {
    document.querySelectorAll(".quiz").forEach(function (quiz) {
      var answer = quiz.getAttribute("data-answer");
      var q = quiz.querySelector(".q");
      var opts = quiz.querySelector(".opts");
      if (q && opts) {
        q.id = q.id || "q-" + Math.random().toString(36).slice(2, 9);
        opts.setAttribute("role", "group");
        opts.setAttribute("aria-labelledby", q.id);
      }
      var exp = quiz.querySelector(".explain");
      if (exp) exp.setAttribute("aria-live", "polite");
      quiz.querySelectorAll("button.opt").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (quiz.classList.contains("answered")) return;
          quiz.classList.add("answered");
          quiz.querySelectorAll("button.opt").forEach(function (b) {
            b.disabled = true;
            if (b.getAttribute("data-opt") === answer) b.classList.add("correct");
          });
          if (btn.getAttribute("data-opt") !== answer) btn.classList.add("wrong");
          btn.setAttribute("aria-pressed", "true");
          var ex = quiz.querySelector(".explain");
          if (ex) ex.insertAdjacentHTML("afterbegin", btn.getAttribute("data-opt") === answer ? "<b>Correct.</b> " : "<b>Not quite.</b> ");
        });
      });
    });
  }

  /* ---------- Clipboard (with fallback for non-secure contexts) ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  window.InfraSimCopy = copyText;

  /* ---------- Code blocks ---------- */
  function wireCode(scope) {
    (scope || document).querySelectorAll("pre > code").forEach(function (code) {
      if (code.parentElement.querySelector(".copy-btn")) return;
      if (window.hljs) { try { window.hljs.highlightElement(code); } catch (e) { /* ignore */ } }
      var pre = code.parentElement;
      var btn = el("button", { "class": "copy-btn", type: "button" }, "Copy");
      btn.addEventListener("click", function () {
        var text = code.innerText;
        var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1400); };
        copyText(text).then(done, function () { btn.textContent = "Copy failed"; });
      });
      pre.appendChild(btn);
    });
  }

  /* ---------- Heading anchors ---------- */
  function addAnchors() {
    var hashTarget = location.hash ? location.hash.slice(1) : "";
    var existedBefore = !!(hashTarget && document.getElementById(hashTarget));
    var used = {};
    document.querySelectorAll("article h2, article h3").forEach(function (h) {
      if (h.id) { used[h.id] = true; return; }
      var base = h.textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
      if (!/^[a-z]/.test(base)) base = "s-" + base;   // same rule as build.py: ids start with a letter
      var id = base, n = 2;
      while (used[id] || document.getElementById(id)) id = base + "-" + n++;   // keep ids unique
      used[id] = true;
      h.id = id;
    });
    // Lesson headings get ids at build time, so the browser already jumped to the hash.
    // Only scroll when the target id was created here (e.g. on the home page).
    if (hashTarget && !existedBefore) {
      var target = document.getElementById(hashTarget);
      if (target) target.scrollIntoView({ behavior: "auto" });
    }
  }

  window.InfraSimCourse = {
    decorateCode: wireCode,
    lessons: LESSONS,
    lesson: LESSONS.filter(function (l) { return l.id === currentId; })[0] || null,
    levels: LEVELS,
    version: VERSION,
    root: root
  };

  buildTopbar();
  addAnchors();
  buildSidebar();
  wireSidebarResize();
  decorateLesson();
  buildHome();
  updateProgressPill();
  wireQuizzes();
  wireCode();
  document.addEventListener("click", function (e) {
    if (body.classList.contains("nav-open") && !e.target.closest("#sidebar") && !e.target.closest("#menu-btn")) body.classList.remove("nav-open");
  });
})();
