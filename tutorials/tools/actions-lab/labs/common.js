// Helpers shared by every lab: reading a parsed workflow, and the mistakes that are checked in every lab.
(function () {
  'use strict';
  var GA = window.GA;
  GA.labs = GA.labs || {};
  GA.cmds = GA.cmds || {};
  GA.drills = GA.drills || {};
  GA.sets = GA.sets || {};
  var H = GA.h = {};
  H.jobs = GA.jobsOf; H.steps = GA.stepsOf; H.all = GA.allSteps; H.on = GA.onOf; H.list = GA.asList;
  H.uses = function (d, repo) { return GA.usesList(d).filter(function (u) { return u.repo + (u.path ? '/' + u.path : '') === repo; }); };
  H.stepUses = function (d, repo) { return H.all(d).filter(function (s) { var u = GA.parseUses(s.uses); return u && u.repo + (u.path ? '/' + u.path : '') === repo; }); };
  H.runs = function (d) { return H.all(d).filter(function (s) { return typeof s.run === 'string'; }).map(function (s) { return s.run; }); };
  H.runText = function (d) { return H.runs(d).join('\n'); };
  H.major = function (ref) { var m = /^v?(\d+)/.exec(ref || ''); return m ? Number(m[1]) : null; };
  // The version the lessons use for an action: the moving major tag (v7) or the exact tag, read from GitHub when the lab was built.
  H.meta = function (repo) { return (GA.actions || {})[repo] || null; };
  H.isCurrent = function (u) {
    var m = H.meta(u.repo + (u.path ? '/' + u.path : '')); if (!m) return true;
    if (GA.isSha(u.ref)) return true;
    if (/^v\d+$/.test(m.use)) return H.major(u.ref) === H.major(m.use);
    return u.ref === m.use;
  };
  H.lineOf = function (text, re) { var ls = text.split('\n'); for (var i = 0; i < ls.length; i++) if (re.test(ls[i])) return i + 1; return 0; };
  H.job = function (d, id) { return H.jobs(d)[id] || null; };
  H.hasStepUses = function (d, repo, pred) { return H.stepUses(d, repo).some(function (s) { return !pred || pred(s, GA.parseUses(s.uses)); }); };
  H.perm = function (obj) { return obj && typeof obj === 'object' ? obj : {}; };
  H.evalIf = function (src, ctx) { try { var v = GA.evalCondition(src, ctx); return GA.isUnknown(v) ? null : v; } catch (e) { return null; } };
  H.gh = function (event, ref, extra) { return Object.assign({ github: Object.assign({ event_name: event, ref: ref, ref_name: (ref || '').replace(/^refs\/(heads|tags)\//, ''), event: {} }, extra || {}) }, {}); };
  H.runs_on = function (j) { return j && j['runs-on']; };
  H.text = function (v) { return typeof v === 'string' ? v : JSON.stringify(v); };

  // Mistakes that are worth flagging in any lab. Each returns { msg, line } or nothing.
  GA.globalTraps = function (doc, text) {
    var out = [];
    GA.usesList(doc).forEach(function (u) {
      if (u.local || !u.repo) return;
      var full = u.repo + (u.path ? '/' + u.path : '');
      var meta = H.meta(full);
      var line = H.lineOf(text, new RegExp('uses:\\s*[\'"]?' + full.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '@'));
      if (/^(latest|main|master|dev|develop)$/i.test(u.ref)) out.push({ line: line, msg: '<code>' + u.raw + '</code> follows a branch, so the code you run can change under you at any time. Pin an action to a version tag (and, for third-party actions, to a full commit SHA).' });
      else if (!u.ref && u.kind === 'step') out.push({ line: line, msg: '<code>' + u.raw + '</code> has no version. Write <code>' + full + '@' + (meta ? meta.use : 'v1') + '</code>.' });
      else if (meta && !H.isCurrent(u)) out.push({ line: line, msg: '<code>' + u.raw + '</code> is several versions behind. The lessons use <code>' + full + '@' + meta.use + '</code> (read from the action\'s repository on GitHub).' });
      if (meta && u.step && u.step.with && typeof u.step.with === 'object') {
        Object.keys(u.step.with).forEach(function (k) {
          if (meta.inputs[k] === undefined) {
            var near = Object.keys(meta.inputs).sort(function (a, b) { return lev(a, k) - lev(b, k); })[0];
            out.push({ line: H.lineOf(text, new RegExp('^\\s*' + k.replace(/[-]/g, '\\-') + '\\s*:')), msg: 'The action <code>' + full + '</code> has no input called <code>' + k + '</code>' + (near && lev(near, k) <= 4 ? '. Did you mean <code>' + near + '</code>?' : '.'), action: true });
          }
        });
        Object.keys(meta.inputs).forEach(function (k) {
          if (meta.inputs[k].required && meta.inputs[k].default === null && !(k in u.step.with)) out.push({ line: line, msg: 'The action <code>' + full + '</code> needs the input <code>' + k + '</code> under <code>with:</code>.', action: true });
        });
      } else if (meta && u.step) {
        Object.keys(meta.inputs).forEach(function (k) {
          if (meta.inputs[k].required && meta.inputs[k].default === null) out.push({ line: line, msg: 'The action <code>' + full + '</code> needs the input <code>' + k + '</code> under <code>with:</code>.', action: true });
        });
      }
    });
    return out;
  };
  function lev(a, b) { var d = []; for (var i = 0; i <= a.length; i++) { d[i] = [i]; } for (var j = 1; j <= b.length; j++) d[0][j] = j; for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }

  GA.freeStarter = 'name: Try it\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: echo "Hello"\n';
  // A lab spec is { id, tag, title, level, task, starter, solution, checks, traps, hints, explain, scenario, preview, lint }.
  GA.lab = function (spec) { GA.labs[spec.id] = spec; return spec; };
  // Small builders so the specs stay short.
  GA.dl = function (pairs) { return '<dl>' + pairs.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>'; };
})();
