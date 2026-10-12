// The logic behind the GitHub Actions lab. Pure JavaScript with no DOM, so the same file runs in the page and in the tests.
// Everything here follows what docs.github.com documents: filter patterns, expressions, matrices, needs and if.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- filter patterns (branches, tags, paths)
  // "Filter pattern cheat sheet": * is anything but /, ** is anything, ? is zero or one of the previous character,
  // + is one or more, [] is a class, a leading ! negates, and \ escapes a special character.
  function globToRegExp(p) {
    let out = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '\\') { out += escapeRe(p[++i] || ''); continue; }
      if (c === '*') {
        if (p[i + 1] === '*') { if (p[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i++; } }   // **/ is zero or more directories
        else out += '[^/]*';
        continue;
      }
      if (c === '?' || c === '+') { out += c; continue; }
      if (c === '[') {
        const end = p.indexOf(']', i + 1);
        if (end > 0) { out += '[' + p.slice(i + 1, end).replace(/[^\w\-]/g, '') + ']'; i = end; continue; }
      }
      out += escapeRe(c);
    }
    return new RegExp('^' + out + '$');
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }
  // Patterns are checked in order: a matching ! pattern after a positive match excludes, a positive one after that includes again.
  function matchFilter(patterns, name) {
    let matched = false;
    for (const pat of patterns) {
      if (typeof pat !== 'string') continue;
      if (pat[0] === '!') { if (matched && globToRegExp(pat.slice(1)).test(name)) matched = false; }
      else if (globToRegExp(pat).test(name)) matched = true;
    }
    return matched;
  }

  // ---------------------------------------------------------------- expressions
  class Unknown { constructor(why) { this.why = why || 'a value only known while the workflow runs'; } }
  const isUnknown = (v) => v instanceof Unknown;
  const typeOf = (v) => (v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : typeof v);

  function toNumber(v) {
    switch (typeOf(v)) {
      case 'null': return 0;
      case 'boolean': return v ? 1 : 0;
      case 'number': return v;
      case 'string': { const t = v.trim(); return t === '' ? 0 : (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN); }
      default: return NaN;
    }
  }
  function toStr(v) {
    switch (typeOf(v)) {
      case 'null': return '';
      case 'boolean': return v ? 'true' : 'false';
      case 'number': return String(v);
      case 'string': return v;
      default: return '';
    }
  }
  function truthy(v) { return !(v === false || v === 0 || v === '' || v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))); }
  function looseEquals(a, b) {
    const ta = typeOf(a), tb = typeOf(b);
    if (ta === tb) {
      if (ta === 'string') return a.toLowerCase() === b.toLowerCase();
      if (ta === 'array' || ta === 'object') return a === b;
      if (ta === 'null') return true;
      return a === b;
    }
    const x = toNumber(a), y = toNumber(b);
    return !Number.isNaN(x) && !Number.isNaN(y) && x === y;
  }

  function tokenize(src) {
    const t = [];
    let i = 0;
    const isIdStart = (c) => /[A-Za-z_]/.test(c), isId = (c) => /[A-Za-z0-9_\-]/.test(c);
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "'") {
        let s = ''; i++;
        for (;;) {
          if (i >= src.length) throw new Error('unterminated string, strings need a closing single quote');
          if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
          s += src[i++];
        }
        t.push({ k: 'str', v: s }); continue;
      }
      if (c === '"') throw new Error('strings must use single quotes, not double quotes');
      const num = /^(?:0x[0-9a-fA-F]+|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(src.slice(i));
      if (num && (/[\d.]/.test(c) || (c === '-' && /[\d.]/.test(src[i + 1] || '')))) { t.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
      if (isIdStart(c)) { let j = i + 1; while (j < src.length && isId(src[j])) j++; t.push({ k: 'id', v: src.slice(i, j) }); i = j; continue; }
      const two = src.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
      if ('<>!()[].,*'.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
      throw new Error(`unexpected character "${c}"`);
    }
    return t;
  }

  function parseExpr(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
    function expect(v) { if (!isOp(v)) throw new Error(`expected "${v}"`); p++; }
    function or() { let l = and(); while (isOp('||')) { p++; l = { t: 'or', l, r: and() }; } return l; }
    function and() { let l = eq(); while (isOp('&&')) { p++; l = { t: 'and', l, r: eq() }; } return l; }
    function eq() { let l = rel(); while (isOp('==') || isOp('!=')) { const op = next().v; l = { t: 'bin', op, l, r: rel() }; } return l; }
    function rel() { let l = unary(); while (isOp('<') || isOp('<=') || isOp('>') || isOp('>=')) { const op = next().v; l = { t: 'bin', op, l, r: unary() }; } return l; }
    function unary() { if (isOp('!')) { p++; return { t: 'not', e: unary() }; } return postfix(); }
    function postfix() {
      let e = primary();
      for (;;) {
        if (isOp('.')) {
          p++;
          if (isOp('*')) { p++; e = { t: 'filter', e }; continue; }
          const id = next();
          if (!id || id.k !== 'id') throw new Error('expected a property name after "."');
          e = { t: 'prop', e, name: id.v };
        } else if (isOp('[')) { p++; const idx = or(); expect(']'); e = { t: 'index', e, idx }; }
        else break;
      }
      return e;
    }
    function primary() {
      const tk = next();
      if (!tk) throw new Error('the expression ends too early');
      if (tk.k === 'num' || tk.k === 'str') return { t: 'lit', v: tk.v };
      if (tk.k === 'op' && tk.v === '(') { const e = or(); expect(')'); return e; }
      if (tk.k === 'id') {
        if (tk.v === 'true') return { t: 'lit', v: true };
        if (tk.v === 'false') return { t: 'lit', v: false };
        if (tk.v === 'null') return { t: 'lit', v: null };
        if (isOp('(')) {
          p++; const args = [];
          if (!isOp(')')) { for (;;) { args.push(or()); if (isOp(',')) { p++; continue; } break; } }
          expect(')');
          return { t: 'call', name: tk.v, args };
        }
        return { t: 'ctx', name: tk.v };
      }
      throw new Error(`unexpected "${tk.v}"`);
    }
    const ast = or();
    if (p < toks.length) throw new Error(`unexpected "${toks[p].v}"`);
    return ast;
  }

  function getProp(obj, name) {
    if (isUnknown(obj)) return obj;
    if (obj === null || typeof obj !== 'object') return null;
    if (name in obj) return obj[name];
    const k = Object.keys(obj).find((x) => x.toLowerCase() === String(name).toLowerCase());
    return k === undefined ? null : obj[k];
  }

  function evalAst(n, ctx) {
    switch (n.t) {
      case 'lit': return n.v;
      case 'ctx': return getProp(ctx, n.name);
      case 'prop': {
        const base = evalAst(n.e, ctx);
        if (containsFilter(n.e)) return isUnknown(base) ? base : (Array.isArray(base) ? base : []).map((x) => getProp(x, n.name));
        return getProp(base, n.name);
      }
      case 'index': { const o = evalAst(n.e, ctx), i = evalAst(n.idx, ctx); if (isUnknown(o)) return o; if (isUnknown(i)) return i; return Array.isArray(o) ? (typeof i === 'number' ? (o[i] === undefined ? null : o[i]) : null) : getProp(o, toStr(i)); }
      case 'filter': {
        const o = evalAst(n.e, ctx);
        if (isUnknown(o)) return o;
        return Array.isArray(o) ? o.slice() : (o && typeof o === 'object' ? Object.values(o) : []);
      }
      case 'not': { const v = evalAst(n.e, ctx); return isUnknown(v) ? v : !truthy(v); }
      case 'and': { const l = evalAst(n.l, ctx); if (isUnknown(l)) return l; if (!truthy(l)) return l; return evalAst(n.r, ctx); }
      case 'or': { const l = evalAst(n.l, ctx); if (!isUnknown(l) && truthy(l)) return l; const r = evalAst(n.r, ctx); return isUnknown(l) ? (isUnknown(r) ? l : (truthy(r) ? r : l)) : r; }
      case 'bin': {
        const l = evalAst(n.l, ctx), r = evalAst(n.r, ctx);
        if (isUnknown(l)) return l; if (isUnknown(r)) return r;
        if (n.op === '==') return looseEquals(l, r);
        if (n.op === '!=') return !looseEquals(l, r);
        if (typeOf(l) === 'string' && typeOf(r) === 'string') {
          const a = l.toLowerCase(), b = r.toLowerCase();
          return n.op === '<' ? a < b : n.op === '<=' ? a <= b : n.op === '>' ? a > b : a >= b;
        }
        const x = toNumber(l), y = toNumber(r);
        if (Number.isNaN(x) || Number.isNaN(y)) return false;
        return n.op === '<' ? x < y : n.op === '<=' ? x <= y : n.op === '>' ? x > y : x >= y;
      }
      case 'call': return callFn(n, ctx);
      default: throw new Error('bad expression');
    }
  }
  function containsFilter(n) { return n && (n.t === 'filter' || (n.e && containsFilter(n.e))); }

  function callFn(n, ctx) {
    const name = n.name.toLowerCase();
    const status = ctx && ctx.__status ? ctx.__status : { success: true, failure: false, cancelled: false };
    if (name === 'success') return status.success;
    if (name === 'always') return true;
    if (name === 'cancelled') return status.cancelled;
    if (name === 'failure') return status.failure;
    const a = n.args.map((x) => evalNode(x, ctx));
    if (a.some(isUnknown) && name !== 'case') return a.find(isUnknown);
    switch (name) {
      case 'contains': {
        if (a.length !== 2) throw new Error('contains() takes two arguments');
        if (Array.isArray(a[0])) return a[0].some((x) => looseEquals(x, a[1]));
        return toStr(a[0]).toLowerCase().includes(toStr(a[1]).toLowerCase());
      }
      case 'startswith': if (a.length !== 2) throw new Error('startsWith() takes two arguments'); return toStr(a[0]).toLowerCase().startsWith(toStr(a[1]).toLowerCase());
      case 'endswith': if (a.length !== 2) throw new Error('endsWith() takes two arguments'); return toStr(a[0]).toLowerCase().endsWith(toStr(a[1]).toLowerCase());
      case 'format': {
        if (a.length < 2) throw new Error('format() needs a string and at least one value');
        return toStr(a[0]).replace(/\{\{|\}\}|\{(\d+)\}/g, (m, d) => (m === '{{' ? '{' : m === '}}' ? '}' : toStr(a[Number(d) + 1])));
      }
      case 'join': {
        const sep = a.length > 1 ? toStr(a[1]) : ',';
        return (Array.isArray(a[0]) ? a[0] : [a[0]]).map(toStr).join(sep);
      }
      case 'tojson': return JSON.stringify(a[0], null, 2);
      case 'fromjson': { try { return JSON.parse(toStr(a[0])); } catch (e) { throw new Error('fromJSON() could not read that as JSON'); } }
      case 'hashfiles': return new Unknown('hashFiles() reads the files on the runner');
      case 'case': {
        if (a.length < 3 || a.length % 2 === 0) throw new Error('case() takes pairs of condition and value, then a default');
        for (let i = 0; i + 1 < a.length; i += 2) { if (isUnknown(a[i])) return a[i]; if (truthy(a[i])) return a[i + 1]; }
        return a[a.length - 1];
      }
      default: throw new Error(`unknown function ${n.name}()`);
    }
  }
  const evalNode = evalAst;

  // evaluate("github.ref == 'refs/heads/main'", ctx) -> value (or an Unknown)
  function evaluate(src, ctx) {
    const ast = parseExpr(src);
    return evalNode(ast, ctx || {});
  }
  // An if: condition. A bare expression is evaluated; ${{ expr }} on its own is the same; anything else is a plain string.
  function evalCondition(src, ctx) {
    if (typeof src === 'boolean') return src;
    if (typeof src !== 'string') return true;
    const s = src.trim();
    const m = /^\$\{\{([\s\S]*)\}\}$/.exec(s);
    if (m && !/\$\{\{/.test(m[1])) return finish(evaluate(m[1], ctx));
    if (/\$\{\{/.test(s)) return s.length > 0;   // mixed text and ${{ }} makes a non-empty string: always true
    return finish(evaluate(s, ctx));
    function finish(v) { return isUnknown(v) ? v : truthy(v); }
  }
  // Replace every ${{ expr }} in a string (for names, groups and values).
  function interpolate(str, ctx) {
    let unknown = null;
    const out = String(str).replace(/\$\{\{([\s\S]*?)\}\}/g, (m, e) => {
      let v; try { v = evaluate(e, ctx); } catch (err) { return m; }
      if (isUnknown(v)) { unknown = v; return '\u2063'; }
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : toStr(v);
    });
    return unknown ? new Unknown(unknown.why) : out;
  }

  // ---------------------------------------------------------------- reading a workflow
  function onOf(doc) {
    const on = doc && (doc.on !== undefined ? doc.on : doc[true]);
    if (on === undefined || on === null) return {};
    if (typeof on === 'string') return { [on]: {} };
    if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, {}]));
    return Object.fromEntries(Object.entries(on).map(([k, v]) => [k, v && typeof v === 'object' ? v : {}]));
  }
  const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

  // Does this event start the workflow? ev = { name, ref, base_ref, action, paths }
  function eventMatches(doc, ev) {
    const on = onOf(doc);
    const cfg = on[ev.name];
    if (cfg === undefined) return { runs: false, reason: `the workflow does not listen for ${ev.name}` };
    const cfgIs = (k) => cfg[k] !== undefined;
    const types = asList(cfg.types);
    const defaultTypes = { pull_request: ['opened', 'synchronize', 'reopened'], pull_request_target: ['opened', 'synchronize', 'reopened'] };
    if (ev.action || types.length) {
      const act = ev.action || (defaultTypes[ev.name] ? 'synchronize' : null);
      const allowed = types.length ? types : defaultTypes[ev.name];
      if (act && allowed && !allowed.includes(act)) return { runs: false, reason: `${ev.name} activity "${act}" is not in types (${allowed.join(', ')})` };
    }
    if (ev.name === 'push') {
      const isTag = /^refs\/tags\//.test(ev.ref || ''), isBranch = /^refs\/heads\//.test(ev.ref || '');
      const name = (ev.ref || '').replace(/^refs\/(heads|tags)\//, '');
      const hasB = cfgIs('branches') || cfgIs('branches-ignore'), hasT = cfgIs('tags') || cfgIs('tags-ignore');
      if (isBranch && hasT && !hasB) return { runs: false, reason: 'only tags are listed, and this push is to a branch' };
      if (isTag && hasB && !hasT) return { runs: false, reason: 'only branches are listed, and this push is a tag' };
      if (isBranch && hasB) {
        if (cfgIs('branches') && !matchFilter(asList(cfg.branches), name)) return { runs: false, reason: `branch "${name}" does not match branches: ${asList(cfg.branches).join(', ')}` };
        if (cfgIs('branches-ignore') && matchFilter(asList(cfg['branches-ignore']), name)) return { runs: false, reason: `branch "${name}" is in branches-ignore` };
      }
      if (isTag && hasT) {
        if (cfgIs('tags') && !matchFilter(asList(cfg.tags), name)) return { runs: false, reason: `tag "${name}" does not match tags: ${asList(cfg.tags).join(', ')}` };
        if (cfgIs('tags-ignore') && matchFilter(asList(cfg['tags-ignore']), name)) return { runs: false, reason: `tag "${name}" is in tags-ignore` };
      }
      if (isBranch) { const pr = pathsRun(cfg, ev); if (!pr.runs) return pr; }
    } else if (ev.name === 'pull_request' || ev.name === 'pull_request_target') {
      const base = ev.base_ref || 'main';
      if (cfgIs('branches') && !matchFilter(asList(cfg.branches), base)) return { runs: false, reason: `the target branch "${base}" does not match branches: ${asList(cfg.branches).join(', ')}` };
      if (cfgIs('branches-ignore') && matchFilter(asList(cfg['branches-ignore']), base)) return { runs: false, reason: `the target branch "${base}" is in branches-ignore` };
      const pr = pathsRun(cfg, ev); if (!pr.runs) return pr;
    }
    return { runs: true, reason: `${ev.name}${ev.ref ? ' on ' + ev.ref.replace(/^refs\/(heads|tags)\//, '') : ''} starts the workflow` };
  }
  function pathsRun(cfg, ev) {
    if (cfg.paths === undefined && cfg['paths-ignore'] === undefined) return { runs: true };
    const changed = ev.paths || [];
    if (!changed.length) return { runs: false, reason: 'no changed files to compare with the paths filter' };
    if (cfg.paths !== undefined) {
      const pats = asList(cfg.paths);
      return changed.some((f) => matchFilter(pats, f)) ? { runs: true } : { runs: false, reason: `no changed file matches paths: ${pats.join(', ')}` };
    }
    const ign = asList(cfg['paths-ignore']);
    return changed.every((f) => matchFilter(ign, f)) ? { runs: false, reason: 'every changed file is in paths-ignore' } : { runs: true };
  }

  // ---------------------------------------------------------------- matrix
  function matrixCombos(matrix) {
    if (matrix === undefined || matrix === null) return null;
    if (typeof matrix === 'string') return { unknown: true, why: 'the matrix comes from an expression' };
    const include = matrix.include, exclude = matrix.exclude;
    const keys = Object.keys(matrix).filter((k) => k !== 'include' && k !== 'exclude');
    if (keys.some((k) => typeof matrix[k] === 'string' && /\$\{\{/.test(matrix[k]))) return { unknown: true, why: 'a matrix value comes from an expression' };
    let combos = [{}];
    for (const k of keys) {
      const vals = asList(matrix[k]);
      combos = combos.flatMap((c) => vals.map((v) => Object.assign({}, c, { [k]: v })));
    }
    if (!keys.length) combos = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (exclude) combos = combos.filter((c) => !asList(exclude).some((ex) => Object.entries(ex).every(([k, v]) => same(c[k], v))));
    if (include) {
      const original = combos.map((c) => Object.assign({}, c));
      const extra = [];
      for (const inc of asList(include)) {
        let added = false;
        original.forEach((o, idx) => {
          const clash = Object.keys(inc).some((k) => k in o && !same(o[k], inc[k]));
          if (!clash) { Object.assign(combos[idx], inc); added = true; }
        });
        if (!added) extra.push(Object.assign({}, inc));
      }
      combos = combos.concat(extra);
    }
    return combos;
  }

  // ---------------------------------------------------------------- the run preview
  // ev = { name, ref, base_ref, action, paths, inputs, actor }; opts = { vars, repository, failing: ['jobId'] }
  function simulate(doc, ev, opts) {
    opts = opts || {};
    const res = { event: eventMatches(doc, ev), jobs: [], levels: [], problems: [] };
    const jobs = doc && doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
    const ids = Object.keys(jobs);
    const needsOf = (id) => asList(jobs[id] && jobs[id].needs);
    const level = {}, state = {};
    const visiting = new Set();
    function depth(id) {
      if (level[id] !== undefined) return level[id];
      if (visiting.has(id)) { res.problems.push(`jobs ${id} and its needs form a loop`); return 0; }
      visiting.add(id);
      level[id] = needsOf(id).filter((n) => jobs[n]).reduce((m, n) => Math.max(m, depth(n) + 1), 0);
      visiting.delete(id);
      return level[id];
    }
    ids.forEach(depth);
    const order = ids.slice().sort((a, b) => level[a] - level[b]);
    const ref = ev.ref || '';
    const github = {
      event_name: ev.name, ref, ref_name: ref.replace(/^refs\/(heads|tags)\//, ''), ref_type: /^refs\/tags\//.test(ref) ? 'tag' : 'branch',
      base_ref: ev.base_ref || '', head_ref: ev.head_ref || '', sha: '3d3c42e…', repository: opts.repository || 'octo-org/todo', actor: ev.actor || 'octocat',
      ref_protected: false, event: Object.assign({ action: ev.action || null, inputs: ev.inputs || null }, ev.eventExtra || {}),
    };
    const baseCtx = { github, vars: opts.vars || new Unknown('repository variables are set in the repository settings'), secrets: new Unknown('secrets are set in the repository settings'), inputs: ev.inputs || {}, env: literalEnv(doc.env), runner: new Unknown('the runner is chosen when the job starts'), job: new Unknown(), steps: new Unknown('step results exist only while the job runs'), matrix: new Unknown('matrix values are known after the matrix is built') };
    for (const id of order) {
      const j = jobs[id] || {};
      const needs = needsOf(id);
      const ctx = Object.assign({}, baseCtx, {
        needs: Object.fromEntries(needs.map((n) => [n, { result: state[n] ? state[n].result : 'success', outputs: new Unknown('job outputs are known when the job finishes') }])),
      });
      const failedAncestor = needs.some((n) => state[n] && (state[n].result === 'failure'));
      const skippedAncestor = needs.some((n) => state[n] && state[n].result === 'skipped');
      ctx.__status = { success: !failedAncestor && !skippedAncestor, failure: failedAncestor, cancelled: false };
      let status = 'run', reason = needs.length ? `runs after ${needs.join(', ')}` : 'starts right away', result = 'success';
      if (!res.event.runs) { status = 'skip'; reason = 'the workflow does not start for this event'; result = 'skipped'; }
      else {
        const hasStatusFn = typeof j.if === 'string' && /\b(always|success|failure|cancelled)\s*\(/i.test(j.if);
        if (!hasStatusFn && (failedAncestor || skippedAncestor)) { status = 'skip'; result = 'skipped'; reason = `a job it needs ${failedAncestor ? 'failed' : 'was skipped'}, so it is skipped too`; }
        else if (j.if !== undefined) {
          let v;
          try { v = evalCondition(j.if, ctx); } catch (e) { v = new Unknown('the condition could not be evaluated: ' + e.message); }
          if (isUnknown(v)) { status = 'unknown'; reason = `its condition depends on ${v.why}`; }
          else if (!v) { status = 'skip'; result = 'skipped'; reason = `the condition is false: ${String(j.if).trim()}`; }
          else reason = `the condition is true${needs.length ? ' and ' + reason : ''}`;
        }
        if (status === 'run' && opts.failing && opts.failing.includes(id)) result = 'failure';
      }
      state[id] = { result };
      const combos = matrixCombos(j.strategy && j.strategy.matrix);
      const env = j.environment;
      res.jobs.push({
        id, name: j.name && typeof j.name === 'string' ? j.name : id, needs, level: level[id], status, result, reason,
        matrix: combos && !combos.unknown ? combos : null, matrixUnknown: combos && combos.unknown ? combos.why : null,
        environment: env ? (typeof env === 'string' ? env : env.name || null) : null,
        runsOn: j['runs-on'] !== undefined ? (typeof j['runs-on'] === 'string' ? j['runs-on'] : JSON.stringify(j['runs-on'])) : null,
        uses: typeof j.uses === 'string' ? j.uses : null,
        concurrency: j.concurrency ? (typeof j.concurrency === 'string' ? j.concurrency : j.concurrency.group) : null,
      });
    }
    const maxLevel = res.jobs.reduce((m, j) => Math.max(m, j.level), -1);
    for (let l = 0; l <= maxLevel; l++) res.levels.push(res.jobs.filter((j) => j.level === l).map((j) => j.id));
    return res;
  }
  function literalEnv(env) {
    if (!env || typeof env !== 'object') return {};
    return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, typeof v === 'string' && /\$\{\{/.test(v) ? new Unknown() : v]));
  }

  // ---------------------------------------------------------------- reading steps and actions (for the checks)
  function jobsOf(doc) { return doc && doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {}; }
  function stepsOf(job) { return job && Array.isArray(job.steps) ? job.steps : []; }
  function allSteps(doc) { return Object.entries(jobsOf(doc)).flatMap(([id, j]) => stepsOf(j).map((s) => Object.assign({ __job: id }, s))); }
  // 'actions/checkout@v7' -> { repo: 'actions/checkout', path: '', ref: 'v7' }
  function parseUses(u) {
    if (typeof u !== 'string') return null;
    if (u.startsWith('./') || u.startsWith('docker://')) return { local: true, raw: u };
    const at = u.lastIndexOf('@');
    const name = at > 0 ? u.slice(0, at) : u, ref = at > 0 ? u.slice(at + 1) : '';
    const parts = name.split('/');
    return { repo: parts.slice(0, 2).join('/'), path: parts.slice(2).join('/'), ref, raw: u };
  }
  const isSha = (ref) => /^[0-9a-f]{40}$/.test(ref || '');
  function usesList(doc) {
    const out = [];
    for (const [id, j] of Object.entries(jobsOf(doc))) {
      if (typeof j.uses === 'string') out.push(Object.assign(parseUses(j.uses), { job: id, kind: 'workflow' }));
      for (const s of stepsOf(j)) if (typeof s.uses === 'string') out.push(Object.assign(parseUses(s.uses), { job: id, step: s, kind: 'step' }));
    }
    return out;
  }

  // ---------------------------------------------------------------- the command judge (gh and git)
  // Splits a line the way a shell would: quotes group words, a backslash before a newline continues the line.
  function shellSplit(line) {
    const out = []; let cur = '', q = null, has = false;
    const s = line.replace(/\\\r?\n/g, ' ');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && /["\\$`]/.test(s[i + 1] || '')) cur += s[++i]; else cur += c; continue; }
      if (c === '"' || c === "'") { q = c; has = true; continue; }
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
      if (/\s/.test(c)) { if (cur || has) { out.push(cur); cur = ''; has = false; } continue; }
      if ((c === '&' && s[i + 1] === '&') || c === ';' || c === '|') {
        if (cur || has) { out.push(cur); cur = ''; has = false; }
        if (c === '&') i++;
        out.push({ sep: c === '&' ? '&&' : c }); continue;
      }
      cur += c; has = true;
    }
    if (q) return { error: 'a quote is not closed' };
    if (cur || has) out.push(cur);
    return { words: out };
  }
  function splitCommands(line) {
    const sp = shellSplit(line);
    if (sp.error) return sp;
    const cmds = [[]];
    for (const w of sp.words) { if (typeof w === 'object') cmds.push([]); else cmds[cmds.length - 1].push(w); }
    return { commands: cmds.filter((c) => c.length) };
  }
  // spec = { cmd: ['gh','workflow','run'], positionals: [ 'deploy.yml' | /re/ | fn ], flags: { '--ref': { alias: ['-r'], value: 'main'|/re/|fn|true|false, required: true, repeat: true } }, note }
  // Judge one command's words against a spec. Returns { ok, problems: [html], tokens: [{t, why}] }.
  function judgeCommand(words, spec) {
    const problems = [], tokens = [];
    const cmd = spec.cmd;
    for (let i = 0; i < cmd.length; i++) {
      if (words[i] !== cmd[i]) {
        const got = words.slice(0, cmd.length).join(' ');
        return { ok: false, problems: [`This should start with <code>${cmd.join(' ')}</code>${got ? `, not <code>${escHtml(got)}</code>` : ''}.`], tokens };
      }
    }
    tokens.push({ t: cmd.join(' '), why: spec.what || 'the command' });
    const flagDefs = spec.flags || {};
    const byName = {};
    for (const [name, def] of Object.entries(flagDefs)) { byName[name] = name; for (const a of def.alias || []) byName[a] = name; }
    const seen = {}, pos = [];
    const rest = words.slice(cmd.length);
    for (let i = 0; i < rest.length; i++) {
      let w = rest[i], val = null, hasVal = false;
      if (/^--?[A-Za-z]/.test(w)) {
        const eq = w.indexOf('=');
        if (w.startsWith('--') && eq > 0) { val = w.slice(eq + 1); hasVal = true; w = w.slice(0, eq); }
        let canon = byName[w];
        // -fkey=value: a short flag with its value attached
        if (!canon && /^-[A-Za-z]./.test(w) && !w.startsWith('--') && byName[w.slice(0, 2)] && flagDefs[byName[w.slice(0, 2)]].value !== false) { val = w.slice(2); hasVal = true; w = w.slice(0, 2); canon = byName[w]; }
        if (!canon) {
          const names = Object.keys(byName);
          const near = names.filter((n) => n.startsWith('--') === w.startsWith('--')).sort((a, b) => lev(a, w) - lev(b, w))[0];
          problems.push(`<code>${escHtml(w)}</code> is not a flag of <code>${cmd.join(' ')}</code>${near && lev(near, w) <= 4 ? `. Did you mean <code>${near}</code>?` : '.'}`);
          continue;
        }
        const def = flagDefs[canon];
        const wantsValue = def.value !== false;
        if (wantsValue && !hasVal) { val = rest[++i]; hasVal = val !== undefined; if (!hasVal) { problems.push(`<code>${w}</code> needs a value after it.`); continue; } }
        (seen[canon] = seen[canon] || []).push(val);
        tokens.push({ t: wantsValue ? `${w} ${shQuote(val)}` : w, why: def.what || canon });
      } else { pos.push(w); }
    }
    const posSpec = spec.positionals || [];
    posSpec.forEach((p, i) => {
      const got = pos[i];
      if (got === undefined) { problems.push(`Missing ${p.label || 'an argument'}${p.hint ? ': ' + p.hint : ''}.`); return; }
      if (!testVal(p.match, got)) problems.push(p.bad ? p.bad : `<code>${escHtml(got)}</code> is not what this command needs here${p.hint ? ': ' + p.hint : ''}.`);
      else tokens.splice(1 + i, 0, { t: shQuote(got), why: p.what || p.label || 'argument' });
    });
    if (pos.length > posSpec.length) problems.push(`Too many arguments: <code>${escHtml(pos.slice(posSpec.length).join(' '))}</code> is not needed.`);
    for (const [name, def] of Object.entries(flagDefs)) {
      const got = seen[name] || [];
      if (def.required && !got.length) problems.push(def.missing || `Missing <code>${name}</code>${def.hint ? ': ' + def.hint : ''}.`);
      if (got.length > 1 && !def.repeat) problems.push(`<code>${name}</code> appears more than once, and only the last would be used.`);
      if (def.forbidden && got.length) problems.push(def.forbidden);
      for (const g of got) if (def.value !== false && def.value !== true && def.value !== undefined && !testVal(def.value, g)) problems.push(def.bad ? def.bad(g) : `<code>${name} ${escHtml(g)}</code> is not right here${def.hint ? ': ' + def.hint : ''}.`);
      if (def.each && got.length) { for (const need of def.each) if (!got.some((g) => testVal(need.match, g))) problems.push(need.missing); }
    }
    if (spec.check) problems.push(...spec.check({ pos, seen }));
    return { ok: problems.length === 0, problems, tokens };
  }
  function testVal(m, v) { return m === undefined || m === true ? true : typeof m === 'string' ? v === m : m instanceof RegExp ? m.test(v) : typeof m === 'function' ? m(v) : false; }
  function shQuote(s) { return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s}'`; }
  function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  // specs: one spec, or an array of specs for a line like "git tag v1 && git push origin v1"
  function judgeLine(line, specs) {
    specs = Array.isArray(specs) ? specs : [specs];
    const sp = splitCommands(line);
    if (sp.error) return { ok: false, problems: [sp.error], tokens: [] };
    if (!sp.commands.length) return { ok: false, problems: [], tokens: [], empty: true };
    const problems = [], tokens = [];
    if (sp.commands.length < specs.length) problems.push(`This takes ${specs.length} commands joined with <code>&amp;&amp;</code>; you have ${sp.commands.length}.`);
    if (sp.commands.length > specs.length) problems.push(`Only ${specs.length} command${specs.length > 1 ? 's are' : ' is'} needed here.`);
    specs.forEach((spec, i) => {
      if (!sp.commands[i]) return;
      const r = judgeCommand(sp.commands[i], spec);
      problems.push(...r.problems); tokens.push(...r.tokens);
    });
    return { ok: problems.length === 0, problems, tokens };
  }

  return {
    globToRegExp, matchFilter,
    Unknown, isUnknown, evaluate, evalCondition, interpolate, parseExpr, looseEquals, toNumber, truthy,
    onOf, eventMatches, matrixCombos, simulate,
    jobsOf, stepsOf, allSteps, parseUses, isSha, usesList, asList,
    shellSplit, splitCommands, judgeCommand, judgeLine, escHtml,
  };
});
