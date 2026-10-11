/* infra-sim — scenario library and free-play sandbox page. */
(function () {
  "use strict";
  var S = window.InfraSim, UI = window.InfraSimUI, course = window.InfraSimCourse || {};
  if (!S || !UI) return;
  var lib = document.getElementById("library"), stage = document.getElementById("stage"), filters = document.getElementById("lib-filters");
  var ORDER = ["docker", "compose", "kubernetes", "helm", "argocd", "mixed"], state = { tech: "all", kind: "all" }, current = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var labs = Object.keys(S.labs).map(function (id) { return S.labs[id]; });
  var lessons = (course.lessons || []).reduce(function (m, l) { m[l.id] = l; return m; }, {});

  function paintFilters() {
    var techs = [["all", "All tools"]].concat(ORDER.filter(function (t) { return labs.some(function (l) { return l.tech === t; }); }).map(function (t) { return [t, UI.TECH[t]]; }));
    var kinds = [["all", "All scenarios"], ["fix", "🔧 Fix-it only"], ["guided", "🧪 Hands-on only"]];
    filters.innerHTML = techs.map(function (t) { return '<button type="button" data-tech="' + t[0] + '" aria-pressed="' + (state.tech === t[0]) + '">' + t[1] + "</button>"; }).join("") +
      kinds.map(function (k) { return '<button type="button" data-kind="' + k[0] + '" aria-pressed="' + (state.kind === k[0]) + '">' + k[1] + "</button>"; }).join("");
  }
  function paintLibrary() {
    var done = UI.completed(), html = "";
    ORDER.forEach(function (tech) {
      if (state.tech !== "all" && state.tech !== tech) return;
      var list = labs.filter(function (l) { return l.tech === tech && (state.kind === "all" || (state.kind === "fix") === !!l.fix); });
      if (!list.length) return;
      list.sort(function (a, b) { return a.lesson - b.lesson || (a.fix ? 1 : 0) - (b.fix ? 1 : 0) || a.level - b.level; });
      html += "<h2>" + UI.TECH[tech] + ' <small style="font-weight:400;color:var(--muted);font-size:.8em">' + list.filter(function (l) { return done.indexOf(l.id) >= 0; }).length + " of " + list.length + ' solved</small></h2><div class="lib-grid">';
      list.forEach(function (l) {
        html += '<button type="button" class="lib-card' + (done.indexOf(l.id) >= 0 ? " done" : "") + '" data-id="' + l.id + '"' + (current === l.id ? ' aria-current="true"' : "") + '><span class="k">' + (l.fix ? "🔧 Fix-it" : "🧪 Hands-on") + " · " + UI.LEVELS[l.level || 1] + " · Lesson " + l.lesson + '</span><span class="t">' + l.title + "</span></button>";
      });
      html += "</div>";
    });
    lib.innerHTML = html || '<p class="sim-note">No scenario matches these filters.</p>';
  }
  function open(id, scroll) {
    var def = S.labs[id];
    if (!def) return;
    current = id;
    var lesson = lessons[def.lesson];
    stage.innerHTML = '<section class="lab" data-lab="' + esc(id) + '"></section>' + (lesson ? '<p class="sim-note">This scenario belongs to <a href="lessons/' + lesson.slug + '.html">Lesson ' + lesson.id + ": " + esc(lesson.title) + "</a>, which explains the ideas behind it.</p>" : "");
    UI.mount(stage);
    paintLibrary();
    try { history.replaceState(null, "", "#lab=" + id); } catch (e) { /* file:// */ }
    if (scroll) document.getElementById("sandbox").scrollIntoView();
  }
  function free() {
    current = null;
    stage.innerHTML = '<div class="lab-term"><div></div></div><p class="sim-note">An empty machine with Docker, a 3-node Kubernetes cluster, Helm and Argo CD. Type <code>help</code> to see what the shell can do. Reload the page to start over.</p>';
    var term = new UI.Terminal(stage.querySelector(".lab-term > div"), { title: "sandbox — free play" });
    term.print("Empty sandbox. Try:  docker run hello-world   ·   kubectl get nodes   ·   helm repo add shop https://charts.shop.example   ·   argocd app list\n\n", "term-info");
    term.boot(UI.newSim(term));
    paintLibrary();
    try { history.replaceState(null, "", "#free"); } catch (e) { /* file:// */ }
    term.input.focus({ preventScroll: true });
  }
  filters.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-tech")) state.tech = b.getAttribute("data-tech"); else state.kind = b.getAttribute("data-kind");
    paintFilters(); paintLibrary();
  });
  lib.addEventListener("click", function (e) { var b = e.target.closest(".lib-card"); if (b) open(b.getAttribute("data-id"), true); });
  stage.addEventListener("click", function (e) { if (e.target.id === "free-btn") free(); });
  document.addEventListener("infrasim:lab-done", paintLibrary);
  paintFilters(); paintLibrary();
  var m = /^#lab=([\w-]+)/.exec(location.hash);
  if (m) open(m[1], false); else if (location.hash === "#free") free();
})();
