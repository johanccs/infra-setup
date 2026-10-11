/* infra-sim — a subset of Go text/template with the Sprig/Helm functions charts use most.
   Used by `helm template/install/upgrade` and by `docker inspect --format`. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util;
  var YAML = g.jsyaml || (typeof require === "function" ? require("js-yaml") : null);
  S.YAML = YAML;
  S.yamlDump = function (o, sort) {
    if (o === undefined || o === null) return "null\n";
    return YAML.dump(o, { noArrayIndent: true, lineWidth: -1, sortKeys: !!sort, noRefs: true, quotingType: '"' });
  };

  function TemplateError(msg, line, col) { this.msg = msg; this.line = line; this.col = col; }
  S.TemplateError = TemplateError;

  /* ---------- lexer: text and {{ actions }} ---------- */
  function lex(src) {
    var out = [], i = 0, line = 1;
    while (i < src.length) {
      var open = src.indexOf("{{", i);
      if (open < 0) { out.push({ t: "text", v: src.slice(i) }); break; }
      var text = src.slice(i, open);
      var trimL = src[open + 2] === "-" && /\s/.test(src[open + 3] || "");
      if (trimL) text = text.replace(/\s+$/, "");
      if (text) out.push({ t: "text", v: text });
      line += (src.slice(i, open).match(/\n/g) || []).length;
      var col = open - src.lastIndexOf("\n", open - 1);
      var close, bodyStart = open + (trimL ? 3 : 2);
      if (/^\s*\/\*/.test(src.slice(bodyStart))) { close = src.indexOf("*/", bodyStart); close = close < 0 ? -1 : src.indexOf("}}", close); }
      else {
        close = -1;
        for (var k = bodyStart, q = null; k < src.length; k++) {
          var c = src[k];
          if (q) { if (c === "\\" && q === '"') k++; else if (c === q) q = null; }
          else if (c === '"' || c === "`") q = c;
          else if (c === "}" && src[k + 1] === "}") { close = k; break; }
        }
      }
      if (close < 0) throw new TemplateError("unclosed action", line, col);
      var body = src.slice(bodyStart, close), trimR = /\s-$/.test(body);
      if (trimR) body = body.slice(0, -1);
      out.push({ t: "act", v: body.trim(), line: line, col: col + (trimL ? 4 : 3) });
      line += (src.slice(open, close).match(/\n/g) || []).length;
      i = close + 2;
      if (trimR) { var m = /^\s+/.exec(src.slice(i)); if (m) { line += (m[0].match(/\n/g) || []).length; i += m[0].length; } }
    }
    return out;
  }

  /* ---------- expression tokens ---------- */
  function exprTokens(s, node) {
    var toks = [], i = 0, m;
    while (i < s.length) {
      var rest = s.slice(i);
      if ((m = /^\s+/.exec(rest))) { i += m[0].length; toks.push({ sp: 1 }); continue; }
      if ((m = /^"((?:[^"\\]|\\.)*)"/.exec(rest))) { toks.push({ t: "str", v: m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\(["\\])/g, "$1") }); i += m[0].length; continue; }
      if ((m = /^`([^`]*)`/.exec(rest))) { toks.push({ t: "str", v: m[1] }); i += m[0].length; continue; }
      if ((m = /^'(.)'/.exec(rest))) { toks.push({ t: "num", v: m[1].charCodeAt(0) }); i += m[0].length; continue; }
      if ((m = /^-?\d+(\.\d+)?/.exec(rest))) { toks.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^:=|^=/.exec(rest))) { toks.push({ t: "assign", v: m[0] }); i += m[0].length; continue; }
      if ((m = /^[|(),]/.exec(rest))) { toks.push({ t: m[0] }); i += 1; continue; }
      if ((m = /^\$[\w]*/.exec(rest))) { toks.push({ t: "var", v: m[0] }); i += m[0].length; continue; }
      if ((m = /^(\.[A-Za-z_][\w-]*)+/.exec(rest))) { toks.push({ t: "field", v: m[0].slice(1).split(".") }); i += m[0].length; continue; }
      if (rest[0] === ".") { toks.push({ t: "dot" }); i += 1; continue; }
      if ((m = /^[A-Za-z_]\w*/.exec(rest))) { toks.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
      throw new TemplateError("unexpected \"" + rest[0] + "\" in operand", node.line, node.col);
    }
    // merge: a field directly after ")" or a variable (no space) is a chained access
    var out = [];
    for (var k = 0; k < toks.length; k++) {
      var t = toks[k], prev = toks[k - 1];
      if (t.sp) continue;
      if (t.t === "field" && prev && !prev.sp && (prev.t === ")" || prev.t === "var")) { out.push({ t: "chain", v: t.v }); continue; }
      out.push(t);
    }
    return out;
  }

  /* ---------- parser ---------- */
  function parseExpr(s, node) {
    var toks = exprTokens(s, node), pos = 0;
    function peek() { return toks[pos]; }
    function pipeline() {
      var decl = null;
      if (toks[pos] && toks[pos].t === "var" && toks[pos + 1] && toks[pos + 1].t === "assign") { decl = { name: toks[pos].v, define: toks[pos + 1].v === ":=" }; pos += 2; }
      var cmds = [command()];
      while (peek() && peek().t === "|") { pos++; cmds.push(command()); }
      return { cmds: cmds, decl: decl };
    }
    function command() {
      var parts = [];
      while (peek() && peek().t !== "|" && peek().t !== ")") parts.push(operand());
      if (!parts.length) throw new TemplateError("missing value for command", node.line, node.col);
      return parts;
    }
    function operand() {
      var t = toks[pos++], n;
      if (t.t === "(") { var p = pipeline(); if (!peek() || peek().t !== ")") throw new TemplateError("unclosed left paren", node.line, node.col); pos++; n = { k: "pipe", p: p }; }
      else if (t.t === "str" || t.t === "num") n = { k: "lit", v: t.v };
      else if (t.t === "dot") n = { k: "field", path: [] };
      else if (t.t === "field") n = { k: "field", path: t.v };
      else if (t.t === "var") n = { k: "var", name: t.v, path: [] };
      else if (t.t === "id") {
        if (t.v === "true" || t.v === "false") n = { k: "lit", v: t.v === "true" };
        else if (t.v === "nil") n = { k: "lit", v: null };
        else n = { k: "fn", name: t.v };
      } else throw new TemplateError("unexpected \"" + (t.t === "assign" ? t.v : t.t) + "\" in operand", node.line, node.col);
      while (peek() && peek().t === "chain") { n = { k: "chain", base: n, path: toks[pos++].v }; }
      return n;
    }
    var p = pipeline();
    if (pos < toks.length) throw new TemplateError("unexpected \"" + (toks[pos].t === "id" ? toks[pos].v : toks[pos].t) + "\" in operand", node.line, node.col);
    return p;
  }

  function parse(src, name, defines) {
    var toks = lex(src), pos = 0;
    function block(stop) {
      var nodes = [];
      while (pos < toks.length) {
        var t = toks[pos];
        if (t.t === "text") { nodes.push(t); pos++; continue; }
        var m = /^(\w+)\b\s*([\s\S]*)$/.exec(t.v) || [], kw = m[1], rest = m[2] || "";
        if (/^\/\*/.test(t.v)) { pos++; continue; }
        if (kw === "end" || kw === "else") { if (!stop) throw new TemplateError("unexpected {{" + kw + "}}", t.line, t.col); return nodes; }
        pos++;
        if (kw === "if" || kw === "with" || kw === "range") {
          var n = { t: kw, line: t.line, col: t.col, vars: null };
          if (kw === "range") {
            var rm = /^(\$\w+)\s*(?:,\s*(\$\w+)\s*)?:=\s*([\s\S]+)$/.exec(rest);
            if (rm) { n.vars = rm[2] ? [rm[1], rm[2]] : [null, rm[1]]; rest = rm[3]; }
          }
          n.expr = parseExpr(rest, t);
          n.body = block(true); n.alt = null;
          var cur = n;
          while (toks[pos] && /^else\b/.test(toks[pos].v)) {
            var et = toks[pos++], er = et.v.replace(/^else\s*/, "");
            if (/^if\b/.test(er)) { var e2 = { t: "if", line: et.line, col: et.col, expr: parseExpr(er.replace(/^if\s*/, ""), et), body: block(true), alt: null }; cur.alt = [e2]; cur = e2; }
            else if (/^with\b/.test(er)) { var e3 = { t: "with", line: et.line, col: et.col, expr: parseExpr(er.replace(/^with\s*/, ""), et), body: block(true), alt: null }; cur.alt = [e3]; cur = e3; }
            else { cur.alt = block(true); break; }
          }
          if (!toks[pos] || !/^end\b/.test(toks[pos].v)) throw new TemplateError("unexpected EOF", t.line, t.col);
          pos++;
          nodes.push(n);
        } else if (kw === "define" || kw === "block") {
          var dm = /^"([^"]+)"/.exec(rest);
          if (!dm) throw new TemplateError("missing name in define", t.line, t.col);
          var body = block(true);
          if (!toks[pos] || !/^end\b/.test(toks[pos].v)) throw new TemplateError("unexpected EOF", t.line, t.col);
          pos++;
          defines[dm[1]] = { body: body, file: name };
        } else if (kw === "template") {
          var tm = /^"([^"]+)"\s*([\s\S]*)$/.exec(rest);
          if (!tm) throw new TemplateError("missing name in template clause", t.line, t.col);
          nodes.push({ t: "tpl", name: tm[1], expr: tm[2].trim() ? parseExpr(tm[2], t) : null, line: t.line, col: t.col });
        } else nodes.push({ t: "act", expr: parseExpr(t.v, t), line: t.line, col: t.col, src: t.v });
      }
      if (stop) { var lt = toks[toks.length - 1] || { line: 1, col: 1 }; throw new TemplateError("unexpected EOF", lt.line || 1, lt.col || 1); }
      return nodes;
    }
    return block(false);
  }

  /* ---------- runtime ---------- */
  function empty(v) { return v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length); }
  function str(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return Array.isArray(v) ? "[" + v.map(str).join(" ") + "]" : "map[" + Object.keys(v).sort().map(function (k) { return k + ":" + str(v[k]); }).join(" ") + "]";
    return String(v);
  }
  function printf(fmt) {
    var args = Array.prototype.slice.call(arguments, 1), i = 0;
    return String(fmt).replace(/%(-?\d*)(?:\.(\d+))?([sdvqftT%])/g, function (_, w, prec, c) {
      if (c === "%") return "%";
      var a = args[i++], r = c === "q" ? JSON.stringify(str(a)) : c === "d" ? String(Math.trunc(Number(a))) : c === "f" ? Number(a).toFixed(prec ? +prec : 6) : c === "t" ? String(!!a) : str(a);
      if (w) { var n = Math.abs(+w); r = +w < 0 ? r.padEnd(n) : r.padStart(n); }
      return r;
    });
  }
  function indent(n, s) { var pad = " ".repeat(n); return str(s).split("\n").map(function (l) { return l ? pad + l : l; }).join("\n"); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  var FUNCS = {
    "default": function (d, v) { return empty(v) ? d : v; },
    quote: function () { return Array.prototype.map.call(arguments, function (v) { return JSON.stringify(str(v)); }).join(" "); },
    squote: function (v) { return "'" + str(v) + "'"; },
    upper: function (v) { return str(v).toUpperCase(); }, lower: function (v) { return str(v).toLowerCase(); },
    title: function (v) { return str(v).replace(/\b\w/g, function (c) { return c.toUpperCase(); }); },
    trim: function (v) { return str(v).trim(); },
    trimSuffix: function (s, v) { v = str(v); return s && v.slice(-s.length) === s ? v.slice(0, -s.length) : v; },
    trimPrefix: function (s, v) { v = str(v); return v.indexOf(s) === 0 ? v.slice(s.length) : v; },
    trunc: function (n, v) { v = str(v); return n >= 0 ? v.slice(0, n) : v.slice(n); },
    replace: function (a, b, v) { return str(v).split(a).join(b); },
    contains: function (sub, v) { return str(v).indexOf(sub) >= 0; },
    hasPrefix: function (p, v) { return str(v).indexOf(p) === 0; },
    hasSuffix: function (p, v) { v = str(v); return v.slice(-p.length) === p; },
    indent: indent, nindent: function (n, s) { return "\n" + indent(n, s); },
    toYaml: function (v) { return v === undefined || v === null ? "null" : typeof v === "string" ? S.yamlDump(v).replace(/\n$/, "") : S.yamlDump(v, true).replace(/\n$/, ""); },
    toJson: function (v) { return JSON.stringify(v === undefined ? null : v); },
    json: function (v) { return JSON.stringify(v === undefined ? null : v); },
    toString: str, toStrings: function (l) { return (l || []).map(str); },
    b64enc: function (v) { return U.b64e(str(v)); }, b64dec: function (v) { return U.b64d(str(v)); },
    printf: printf, print: function () { return Array.prototype.map.call(arguments, str).join(""); }, println: function () { return Array.prototype.map.call(arguments, str).join(" ") + "\n"; },
    eq: function (a) { for (var i = 1; i < arguments.length; i++) if (arguments[i] === a) return true; return false; },
    ne: function (a, b) { return a !== b; }, lt: function (a, b) { return a < b; }, le: function (a, b) { return a <= b; }, gt: function (a, b) { return a > b; }, ge: function (a, b) { return a >= b; },
    and: function () { var v; for (var i = 0; i < arguments.length; i++) { v = arguments[i]; if (empty(v)) return v; } return v; },
    or: function () { var v; for (var i = 0; i < arguments.length; i++) { v = arguments[i]; if (!empty(v)) return v; } return v; },
    not: function (v) { return empty(v); }, empty: empty,
    coalesce: function () { for (var i = 0; i < arguments.length; i++) if (!empty(arguments[i])) return arguments[i]; return null; },
    ternary: function (a, b, c) { return c ? a : b; },
    list: function () { return Array.prototype.slice.call(arguments); },
    dict: function () { var o = {}; for (var i = 0; i + 1 < arguments.length; i += 2) o[arguments[i]] = arguments[i + 1]; return o; },
    get: function (m, k) { return m && m[k] != null ? m[k] : ""; },
    set: function (m, k, v) { m[k] = v; return m; },
    hasKey: function (m, k) { return !!m && Object.prototype.hasOwnProperty.call(m, k); },
    keys: function (m) { return Object.keys(m || {}); }, values: function (m) { return Object.keys(m || {}).map(function (k) { return m[k]; }); },
    merge: function (dst) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i] || {}; Object.keys(s).forEach(function (k) { if (dst[k] === undefined) dst[k] = s[k]; }); } return dst; },
    len: function (v) { return v == null ? 0 : typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : v.length; },
    index: function (v) { for (var i = 1; i < arguments.length; i++) { if (v == null) return null; v = v[arguments[i]]; } return v === undefined ? null : v; },
    first: function (l) { return l && l.length ? l[0] : null; }, last: function (l) { return l && l.length ? l[l.length - 1] : null; },
    has: function (x, l) { return (l || []).indexOf(x) >= 0; }, uniq: function (l) { return (l || []).filter(function (x, i) { return l.indexOf(x) === i; }); },
    sortAlpha: function (l) { return (l || []).map(str).sort(); },
    join: function (sep, l) { return (l || []).map(str).join(sep); },
    splitList: function (sep, s) { return str(s).split(sep); },
    until: function (n) { var o = []; for (var i = 0; i < n; i++) o.push(i); return o; },
    int: function (v) { return parseInt(v, 10) || 0; }, int64: function (v) { return parseInt(v, 10) || 0; }, float64: function (v) { return parseFloat(v) || 0; },
    add: function () { return Array.prototype.reduce.call(arguments, function (a, b) { return Number(a) + Number(b); }, 0); },
    add1: function (a) { return Number(a) + 1; }, sub: function (a, b) { return a - b; }, mul: function () { return Array.prototype.reduce.call(arguments, function (a, b) { return a * b; }, 1); },
    div: function (a, b) { return Math.trunc(a / b); }, mod: function (a, b) { return a % b; }, max: Math.max, min: Math.min,
    kindIs: function (k, v) { var t = v == null ? "invalid" : Array.isArray(v) ? "slice" : typeof v === "object" ? "map" : typeof v === "string" ? "string" : typeof v === "boolean" ? "bool" : Number.isInteger(v) ? "int" : "float64"; return t === k || (k === "int64" && t === "int"); },
    typeOf: function (v) { return v == null ? "<nil>" : Array.isArray(v) ? "[]interface {}" : typeof v === "object" ? "map[string]interface {}" : typeof v === "string" ? "string" : typeof v === "boolean" ? "bool" : Number.isInteger(v) ? "int" : "float64"; },
    sha256sum: function (v) { return S.hex(str(v), 64); },
    semverCompare: function (c, v) {
      var m = /^\s*(>=|<=|>|<|=|\^|~)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(c), w = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(str(v));
      if (!m || !w) return false;
      var d = cmp(+w[1], +m[2]) || cmp(+(w[2] || 0), +(m[3] || 0)) || cmp(+(w[3] || 0), +(m[4] || 0));
      return m[1] === ">=" ? d >= 0 : m[1] === ">" ? d > 0 : m[1] === "<=" ? d <= 0 : m[1] === "<" ? d < 0 : m[1] === "^" || m[1] === "~" ? d >= 0 && +w[1] === +m[2] : d === 0;
    },
    lookup: function () { return {}; },
    now: function () { return new Date(); },
    fromYaml: function (s) { try { return YAML.load(str(s)) || {}; } catch (e) { return { Error: e.message }; } },
    toToml: function (v) { return JSON.stringify(v); },
    regexMatch: function (re, s) { return new RegExp(re).test(str(s)); },
    snakecase: function (s) { return str(s).replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_").toLowerCase(); },
    kebabcase: function (s) { return str(s).replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase(); },
    randAlphaNum: function (n) { return S.hex("rand" + n, n); }
  };

  /* Render `entry` (a parsed node list). ctx: { defines, funcs, file } */
  function Engine(opts) { this.defines = {}; this.funcs = Object.assign({}, FUNCS, opts && opts.funcs); this.trees = {}; }
  Engine.prototype.add = function (name, src) { this.trees[name] = parse(src, name, this.defines); };
  Engine.prototype.render = function (name, data) { return this.exec(this.trees[name], data, [{ "$": data }], name); };
  Engine.prototype.exec = function (nodes, dot, scopes, file) {
    var out = "", self = this;
    function lookupVar(n, node) { for (var i = scopes.length - 1; i >= 0; i--) if (Object.prototype.hasOwnProperty.call(scopes[i], n)) return scopes[i][n]; throw new TemplateError("undefined variable \"" + n + "\"", node.line, node.col); }
    function setVar(n, v, define) {
      if (define) { scopes[scopes.length - 1][n] = v; return; }
      for (var i = scopes.length - 1; i >= 0; i--) if (Object.prototype.hasOwnProperty.call(scopes[i], n)) { scopes[i][n] = v; return; }
      scopes[scopes.length - 1][n] = v;
    }
    function walk(base, path, node, label) {
      var v = base;
      for (var i = 0; i < path.length; i++) {
        if (v === null || v === undefined) { var e = new TemplateError("nil pointer evaluating interface {}." + path[i], node.line, node.col); e.at = label; throw e; }
        if (typeof v !== "object") { var e2 = new TemplateError("can't evaluate field " + path[i] + " in type " + FUNCS.typeOf(v), node.line, node.col); e2.at = label; throw e2; }
        v = v[path[i]];
      }
      return v === undefined ? null : v;
    }
    function operand(o, node) {
      if (o.k === "lit") return o.v;
      if (o.k === "field") return walk(dot, o.path, node, "." + o.path.join("."));
      if (o.k === "var") return lookupVar(o.name, node);
      if (o.k === "pipe") return pipeline(o.p, node);
      if (o.k === "chain") return walk(operand(o.base, node), o.path, node, (o.base.k === "var" ? o.base.name : "") + "." + o.path.join("."));
      if (o.k === "fn") return call(o.name, [], node);
      return null;
    }
    function call(name, args, node) {
      if (name === "include") {
        var d = self.defines[args[0]];
        if (!d) { var e = new TemplateError("error calling include: template: no template \"" + args[0] + "\" associated with template \"gotpl\"", node.line, node.col); e.at = "include \"" + args[0] + "\" ."; throw e; }
        return self.exec(d.body, args[1], [{ "$": args[1] }], d.file);
      }
      if (name === "tpl") { var eng = new Engine({ funcs: self.funcs }); eng.defines = self.defines; eng.add("tpl", str(args[0])); return eng.render("tpl", args[1]); }
      if (name === "required") { if (empty(args[1])) { var e3 = new TemplateError("error calling required: " + args[0], node.line, node.col); e3.at = "required"; throw e3; } return args[1]; }
      if (name === "fail") { var e4 = new TemplateError("error calling fail: " + args[0], node.line, node.col); e4.at = "fail"; throw e4; }
      var fn = self.funcs[name];
      if (!fn) throw new TemplateError("function \"" + name + "\" not defined", node.line, node.col);
      try { return fn.apply(null, args); }
      catch (err) { if (err instanceof TemplateError) throw err; var e5 = new TemplateError("error calling " + name + ": " + err.message, node.line, node.col); e5.at = name; throw e5; }
    }
    function pipeline(p, node) {
      var v, has = false;
      p.cmds.forEach(function (cmd) {
        var head = cmd[0];
        if (head.k === "fn") {
          var args = cmd.slice(1).map(function (o) { return operand(o, node); });
          if (has) args.push(v);
          v = call(head.name, args, node);
        } else {
          if (cmd.length > 1) throw new TemplateError("can't give argument to non-function " + (head.k === "field" ? "." + head.path.join(".") : "value"), node.line, node.col);
          v = operand(head, node);
        }
        has = true;
      });
      if (p.decl) { setVar(p.decl.name, v, p.decl.define); return ""; }
      return v;
    }
    function fail(e, node) { if (e instanceof TemplateError && !e.file) { e.file = file; if (!e.at && node.src) e.at = node.src; } throw e; }
    nodes.forEach(function (n) {
      try {
        if (n.t === "text") out += n.v;
        else if (n.t === "act") { var v = pipeline(n.expr, n); if (!n.expr.decl) out += v === null || v === undefined ? (n.expr.cmds.length === 1 && n.expr.cmds[0][0].k !== "fn" ? "" : "") : str(v); }
        else if (n.t === "if") { scopes.push({}); out += self.exec(!empty(pipeline(n.expr, n)) ? n.body : n.alt || [], dot, scopes, file); scopes.pop(); }
        else if (n.t === "with") { var w = pipeline(n.expr, n); scopes.push({}); out += empty(w) ? self.exec(n.alt || [], dot, scopes, file) : self.exec(n.body, w, scopes, file); scopes.pop(); }
        else if (n.t === "range") {
          var coll = pipeline(n.expr, n), keys = coll == null ? [] : Array.isArray(coll) ? coll.map(function (_, i) { return i; }) : typeof coll === "number" ? FUNCS.until(coll) : Object.keys(coll).sort();
          if (typeof coll === "number") coll = keys;
          if (!keys.length) out += self.exec(n.alt || [], dot, scopes, file);
          keys.forEach(function (k) {
            var sc = {}; if (n.vars) { if (n.vars[0]) sc[n.vars[0]] = k; sc[n.vars[1]] = coll[k]; }
            scopes.push(sc); out += self.exec(n.body, coll[k], scopes, file); scopes.pop();
          });
        }
        else if (n.t === "tpl") {
          var d = self.defines[n.name];
          if (!d) throw new TemplateError("template \"" + n.name + "\" not defined", n.line, n.col);
          var arg = n.expr ? pipeline(n.expr, n) : null;
          out += self.exec(d.body, arg, [{ "$": arg }], d.file);
        }
      } catch (e) { fail(e, n); }
    });
    return out;
  };
  S.Template = Engine;
  S.tmplStr = str;
})(typeof window !== "undefined" ? window : globalThis);
