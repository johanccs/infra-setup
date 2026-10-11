/* infra-sim — simulator core: clock, virtual file system, shell, networking.
   Everything here is plain JavaScript with no DOM access, so it also runs under Node for the tests. */
(function (g) {
  "use strict";
  var S = g.InfraSim = g.InfraSim || {};
  S.commands = {};      // host commands: name -> async (argv, io, sim) => exit code
  S.resolvers = [];     // network resolvers contributed by docker.js / k8s.js
  S.inits = [];         // per-simulator initialisers
  S.tickers = [];       // run once per simulated second

  /* ---------- errors ---------- */
  function CmdError(message, code) { this.message = message; this.code = code == null ? 1 : code; }
  function NetError(kind, detail) { this.kind = kind; this.detail = detail || ""; }
  S.CmdError = CmdError; S.NetError = NetError;

  /* ---------- utilities ---------- */
  var U = S.util = {};
  U.rng = function (seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };
  U.hash = function (str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  U.clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };
  U.table = function (rows, gap) {
    gap = gap == null ? 3 : gap;
    var w = [];
    rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); }); });
    return rows.map(function (r) {
      return r.map(function (c, i) { c = String(c); return i === r.length - 1 ? c : c + " ".repeat(w[i] - c.length + gap); }).join("").replace(/\s+$/, "");
    }).join("\n");
  };
  // kubectl-style short duration (same rules as k8s.io/apimachinery duration.HumanDuration)
  U.age = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (s < 120) return s + "s";
    if (m < 10) return m + "m" + (s % 60 ? (s % 60) + "s" : "");
    if (m < 180) return m + "m";
    if (h < 8) return h + "h" + (m % 60 ? (m % 60) + "m" : "");
    if (h < 48) return h + "h";
    if (d < 8) return d + "d" + (h % 24 ? (h % 24) + "h" : "");
    return d + "d";
  };
  // docker-style "3 minutes" (units.HumanDuration)
  U.human = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 1) return "Less than a second";
    if (s === 1) return "1 second";
    if (s < 60) return s + " seconds";
    var m = Math.floor(s / 60);
    if (m === 1) return "About a minute";
    if (m < 60) return m + " minutes";
    var h = Math.round(s / 3600);
    if (h === 1) return "About an hour";
    if (h < 48) return h + " hours";
    if (h < 24 * 7 * 2) return Math.floor(h / 24) + " days";
    if (h < 24 * 30 * 2) return Math.floor(h / 24 / 7) + " weeks";
    if (h < 24 * 365 * 2) return Math.floor(h / 24 / 30) + " months";
    return Math.floor(h / 24 / 365) + " years";
  };
  U.b64e = function (s) { return typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64"); };
  U.b64d = function (s) {
    if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error("invalid input");
    return typeof atob === "function" ? decodeURIComponent(escape(atob(s.replace(/\s+/g, "")))) : Buffer.from(s, "base64").toString("utf8");
  };
  U.size = function (bytes) {   // docker-style sizes
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2).replace(/\.?0+$/, "") + "GB";
    if (bytes >= 1e6) { var v = bytes / 1e6; return (v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")) + "MB"; }
    if (bytes >= 1e3) { var k = bytes / 1e3; return (k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")) + "kB"; }
    return bytes + "B";
  };
  /* Flag parser. spec: { bool: "a all q", str: "n namespace o", multi: "e p", alias: {n:"namespace"}, stop: true }
     Returns { _: positionals, rest: args after "--" (or null), <flag>: value }. */
  U.flags = function (argv, spec, tool) {
    var bool = {}, str = {}, multi = {}, alias = spec.alias || {};
    (spec.bool || "").split(/\s+/).filter(Boolean).forEach(function (k) { bool[k] = 1; });
    (spec.str || "").split(/\s+/).filter(Boolean).forEach(function (k) { str[k] = 1; });
    (spec.multi || "").split(/\s+/).filter(Boolean).forEach(function (k) { multi[k] = 1; str[k] = 1; });
    var out = { _: [], rest: null };
    function name(k) { return alias[k] || k; }
    function set(k, v) { var n = name(k); if (multi[k] || multi[n]) (out[n] = out[n] || []).push(v); else out[n] = v; }
    function unknown(f) { throw new CmdError((spec.unknown || function (x) { return "unknown flag: " + x; })(f), spec.code || 1); }
    for (var i = 0; i < argv.length; i++) {
      var a = argv[i];
      if (a === "--") { out.rest = argv.slice(i + 1); break; }
      if (a.indexOf("--") === 0 && a.length > 2) {
        var eq = a.indexOf("="), k = eq < 0 ? a.slice(2) : a.slice(2, eq);
        if (str[k]) { if (eq >= 0) set(k, a.slice(eq + 1)); else { if (i + 1 >= argv.length) throw new CmdError("flag needs an argument: --" + k); set(k, argv[++i]); } }
        else if (bool[k]) set(k, eq < 0 ? true : a.slice(eq + 1) !== "false");
        else unknown("--" + k);
      } else if (a[0] === "-" && a.length > 1 && !/^-\d/.test(a)) {
        if (a === "-" ) { out._.push(a); continue; }
        for (var j = 1; j < a.length; j++) {
          var c = a[j];
          if (str[c]) {
            var rest = a.slice(j + 1);
            if (rest[0] === "=") rest = rest.slice(1);
            if (rest) set(c, rest); else { if (i + 1 >= argv.length) throw new CmdError("flag needs an argument: '" + c + "' in -" + c); set(c, argv[++i]); }
            break;
          } else if (bool[c]) set(c, true);
          else unknown("unknown shorthand flag: '" + c + "' in " + a);
        }
      } else {
        out._.push(a);
        if (spec.stop) { out._ = out._.concat(argv.slice(i + 1)); break; }
      }
    }
    return out;
  };

  /* ---------- virtual file systems ---------- */
  function norm(path, cwd) {
    if (path[0] !== "/") path = (cwd || "/") + "/" + path;
    var out = [];
    path.split("/").forEach(function (p) { if (p === "" || p === ".") return; if (p === "..") out.pop(); else out.push(p); });
    return "/" + out.join("/");
  }
  U.norm = norm;
  U.basename = function (p) { return p.replace(/\/+$/, "").split("/").pop(); };
  U.dirname = function (p) { var d = p.replace(/\/+$/, "").split("/").slice(0, -1).join("/"); return d || "/"; };

  function MemFs(files) {
    this.files = new Map(); this.dirs = new Set(["/"]);
    var self = this;
    Object.keys(files || {}).forEach(function (p) { self.write(p, files[p]); });
  }
  MemFs.prototype = {
    read: function (p) { return this.files.has(p) ? this.files.get(p) : null; },
    write: function (p, c) { this.mkdirp(U.dirname(p)); this.files.set(p, c); },
    isFile: function (p) { return this.files.has(p); },
    isDir: function (p) { return this.dirs.has(p); },
    exists: function (p) { return this.isFile(p) || this.isDir(p); },
    mkdirp: function (p) { var parts = p.split("/").filter(Boolean), cur = ""; this.dirs.add("/"); for (var i = 0; i < parts.length; i++) { cur += "/" + parts[i]; this.dirs.add(cur); } },
    list: function (dir) {
      var pre = dir === "/" ? "/" : dir + "/", names = new Set();
      this.files.forEach(function (_, p) { if (p.indexOf(pre) === 0) names.add(p.slice(pre.length).split("/")[0]); });
      this.dirs.forEach(function (p) { if (p !== dir && p.indexOf(pre) === 0) names.add(p.slice(pre.length).split("/")[0]); });
      return Array.from(names).sort();
    },
    rm: function (p) {
      var pre = p + "/", self = this;
      this.files.delete(p); this.dirs.delete(p);
      Array.from(this.files.keys()).forEach(function (k) { if (k.indexOf(pre) === 0) self.files.delete(k); });
      Array.from(this.dirs).forEach(function (k) { if (k.indexOf(pre) === 0) self.dirs.delete(k); });
    },
    walk: function (dir) {   // all files under dir as [relative path, content]
      var pre = dir === "/" ? "/" : dir + "/", out = [];
      this.files.forEach(function (c, p) { if (p.indexOf(pre) === 0) out.push([p.slice(pre.length), c]); });
      return out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    }
  };
  S.MemFs = MemFs;

  /* A container's file system: read-only image files + a writable layer + mounts (volumes, ConfigMaps...).
     mounts: [{ path, store: MemFs | () => MemFs, readOnly }] — a mounted store is rooted at "/". */
  var ROOT_DIRS = ["bin", "dev", "etc", "home", "lib", "media", "mnt", "opt", "proc", "root", "run", "sbin", "srv", "sys", "tmp", "usr", "var"];
  function ProcFs(imageFiles, mounts) {
    this.image = imageFiles || {};
    this.bare = !Object.keys(this.image).length;
    this.layer = new MemFs();
    this.gone = new Set();
    this.mounts = (mounts || []).slice().sort(function (a, b) { return b.path.length - a.path.length; });
  }
  ProcFs.prototype = {
    _m: function (p) {
      for (var i = 0; i < this.mounts.length; i++) {
        var m = this.mounts[i];
        if (p === m.path || p.indexOf(m.path === "/" ? "/" : m.path + "/") === 0) {
          return { m: m, store: typeof m.store === "function" ? m.store() : m.store, rel: p === m.path ? "/" : p.slice(m.path.length) || "/" };
        }
      }
      return null;
    },
    read: function (p) {
      var x = this._m(p); if (x) return x.store.read(x.rel);
      if (this.layer.isFile(p)) return this.layer.read(p);
      if (this.gone.has(p)) return null;
      return Object.prototype.hasOwnProperty.call(this.image, p) ? this.image[p] : null;
    },
    write: function (p, c) {
      var x = this._m(p);
      if (x) { if (x.m.readOnly) throw new CmdError("Read-only file system"); x.store.write(x.rel, c); return; }
      this.gone.delete(p); this.layer.write(p, c);
    },
    isFile: function (p) { return this.read(p) !== null; },
    isDir: function (p) {
      if (p === "/") return true;
      var x = this._m(p); if (x) return x.store.isDir(x.rel);
      if (this.layer.isDir(p)) return true;
      if (!this.bare && (ROOT_DIRS.indexOf(p.slice(1)) >= 0 || p === "/usr/bin" || p === "/var/log" || p === "/usr/local")) return true;
      var pre = p + "/", self = this;
      return Object.keys(this.image).some(function (k) { return k.indexOf(pre) === 0 && !self.gone.has(k); }) ||
        this.mounts.some(function (m) { return m.path.indexOf(pre) === 0; });
    },
    exists: function (p) { return this.isFile(p) || this.isDir(p); },
    mkdirp: function (p) { var x = this._m(p); if (x) x.store.mkdirp(x.rel); else this.layer.mkdirp(p); },
    list: function (dir) {
      var x = this._m(dir); if (x) return x.store.list(x.rel);
      var pre = dir === "/" ? "/" : dir + "/", names = new Set(this.layer.list(dir)), self = this;
      Object.keys(this.image).forEach(function (k) { if (k.indexOf(pre) === 0 && !self.gone.has(k)) names.add(k.slice(pre.length).split("/")[0]); });
      this.mounts.forEach(function (m) { if (m.path.indexOf(pre) === 0) names.add(m.path.slice(pre.length).split("/")[0]); });
      if (dir === "/" && !this.bare) ROOT_DIRS.forEach(function (d) { names.add(d); });
      return Array.from(names).sort();
    },
    rm: function (p) {
      var x = this._m(p);
      if (x) { if (x.m.readOnly) throw new CmdError("Read-only file system"); x.store.rm(x.rel); return; }
      this.layer.rm(p);
      var pre = p + "/", self = this;
      Object.keys(this.image).forEach(function (k) { if (k === p || k.indexOf(pre) === 0) self.gone.add(k); });
    }
  };
  S.ProcFs = ProcFs;

  /* ---------- shell parsing ---------- */
  function splitSeq(line) {   // split on ; && || outside quotes and $( )
    var out = [], cur = "", q = null, depth = 0;
    for (var i = 0; i < line.length; i++) {
      var c = line[i], n = line[i + 1];
      if (q) { cur += c; if (c === "\\" && q === '"' && n) { cur += n; i++; } else if (c === q) q = null; continue; }
      if (c === "\\" && n) { cur += c + n; i++; continue; }
      if (c === "'" || c === '"') { q = c; cur += c; continue; }
      if (c === "$" && n === "(") { depth++; cur += "$("; i++; continue; }
      if (c === "(" && depth) { depth++; cur += c; continue; }
      if (c === ")" && depth) { depth--; cur += c; continue; }
      if (!depth) {
        if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
        if (c === ";") { out.push({ text: cur, op: ";" }); cur = ""; continue; }
        if ((c === "&" && n === "&") || (c === "|" && n === "|")) { out.push({ text: cur, op: c + n }); cur = ""; i++; continue; }
      }
      cur += c;
    }
    out.push({ text: cur, op: "" });
    return out.filter(function (s) { return s.text.trim(); });
  }

  function tokenize(str, env) {
    var toks = [], cur = "", has = false, i = 0;
    function push() { if (has) toks.push({ v: cur }); cur = ""; has = false; }
    function variable() {
      var m = /^\$(\w+|\{\w+\}|\?)/.exec(str.slice(i));
      if (!m) { cur += "$"; has = true; i++; return; }
      var k = m[1].replace(/[{}]/g, ""), v = env[k];
      cur += v == null ? "" : v; has = true; i += m[0].length;
    }
    while (i < str.length) {
      var c = str[i];
      if (c === "'") { var e = str.indexOf("'", i + 1); if (e < 0) throw new CmdError("syntax error: unterminated quote", 2); cur += str.slice(i + 1, e); has = true; i = e + 1; continue; }
      if (c === '"') {
        i++; has = true;
        while (i < str.length && str[i] !== '"') {
          if (str[i] === "\\" && /["\\$`]/.test(str[i + 1] || "")) { cur += str[i + 1]; i += 2; }
          else if (str[i] === "$") variable();
          else cur += str[i++];
        }
        if (i >= str.length) throw new CmdError("syntax error: unterminated quote", 2);
        i++; continue;
      }
      if (c === "\\" && i + 1 < str.length) { cur += str[i + 1]; has = true; i += 2; continue; }
      if (c === "$") { variable(); continue; }
      if (/\s/.test(c)) { push(); i++; continue; }
      if (c === "~" && !has && (i + 1 >= str.length || /[\s/]/.test(str[i + 1]))) { cur += env.HOME || "/"; has = true; i++; continue; }
      if (c === "2" && !has && str[i + 1] === ">") {   // stderr redirects are accepted and ignored
        var m2 = /^2>(&1|>?\s*\S+)/.exec(str.slice(i)); if (m2) { i += m2[0].length; continue; }
      }
      if (c === "|" || c === "<" || c === "&") { push(); toks.push({ op: c }); i++; continue; }
      if (c === ">") { push(); if (str[i + 1] === ">") { toks.push({ op: ">>" }); i += 2; } else { toks.push({ op: ">" }); i++; } continue; }
      cur += c; has = true; i++;
    }
    push();
    return toks;
  }
  S.tokenize = tokenize;

  /* ---------- the simulator ---------- */
  function Sim(opts) {
    opts = opts || {};
    this.opts = opts;
    this.epoch = opts.epoch || Date.now();
    this.now = 0;                         // simulated milliseconds since start
    this.rand = U.rng(opts.seed || 20261011);
    this.fs = new MemFs();
    this.realtime = !!opts.realtime;      // browser: blocking commands take (scaled) real time
    this.speed = opts.speed || 4;
    this.busy = 0;
    this.aborted = false;
    this.listeners = [];
    this.ui = opts.ui || {};              // { edit(name, text) -> Promise<string|null>, clear() }
    this.history = [];
    var sim = this;
    this.host = {
      type: "host", fs: this.fs, cwd: "/home/learner", user: "learner", hostname: "sandbox",
      env: { HOME: "/home/learner", USER: "learner", PATH: "/usr/local/bin:/usr/bin:/bin", KUBECONFIG: "/home/learner/.kube/config", "?": "0" },
      origin: { type: "host" },
      find: function (name) { return S.commands[name] || builtins[name] || null; },
      missing: function (name) { return "bash: " + name + ": command not found"; },
      prompt: function () { return "learner@sandbox:" + (this.cwd === this.env.HOME ? "~" : this.cwd.indexOf(this.env.HOME + "/") === 0 ? "~" + this.cwd.slice(this.env.HOME.length) : this.cwd) + "$ "; }
    };
    this.fs.mkdirp("/home/learner");
    this.scopes = [this.host];
    S.inits.forEach(function (f) { f(sim); });
  }
  S.Sim = Sim;

  Sim.prototype.scope = function () { return this.scopes[this.scopes.length - 1]; };
  Sim.prototype.prompt = function () { return this.scope().prompt(); };
  Sim.prototype.id = function (len) { var s = ""; while (s.length < len) s += Math.floor(this.rand() * 16).toString(16); return s; };
  Sim.prototype.suffix = function (len) { var a = "bcdfghjklmnpqrstvwxz2456789", s = ""; while (s.length < len) s += a[Math.floor(this.rand() * a.length)]; return s; };
  Sim.prototype.date = function (t) { return new Date(this.epoch + (t == null ? this.now : t)); };
  Sim.prototype.iso = function (t) { return this.date(t).toISOString().replace(/\.\d+Z$/, "Z"); };
  Sim.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Sim.prototype.changed = function () { var s = this; this.listeners.forEach(function (f) { try { f(s); } catch (e) { /* listener errors must not break the shell */ } }); };

  /* Advance simulated time, running every controller once per second. */
  Sim.prototype.advance = function (ms) {
    var end = this.now + ms, sim = this;
    this.reconcile();
    while (this.now < end) {
      this.now = Math.min(end, this.now + 1000);
      this.reconcile();
    }
    return sim;
  };
  Sim.prototype.reconcile = function () { var sim = this; S.tickers.forEach(function (t) { t(sim); }); };
  /* Used by blocking commands (pulls, rollout status, sleep): time passes while they wait. */
  Sim.prototype.wait = async function (ms) {
    var left = ms;
    while (left > 0) {
      if (this.aborted) throw new CmdError("^C", 130);
      var step = Math.min(1000, left);
      if (this.realtime) await new Promise(function (r) { setTimeout(r, step / this.speed); }.bind(this));
      this.advance(step);
      left -= step;
    }
  };
  Sim.prototype.abort = function () { if (this.busy) this.aborted = true; };

  /* Does the text need more lines before it can run? (heredoc, trailing backslash, open quote) */
  Sim.prototype.needsMore = function (text) {
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var h = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(lines[i]);
      if (h) { var j = i + 1; while (j < lines.length && lines[j].trim() !== h[2]) j++; if (j >= lines.length) return true; i = j; }
    }
    var last = lines[lines.length - 1];
    if (/\\$/.test(last)) return true;
    var q = null;
    for (var k = 0; k < text.length; k++) { var c = text[k]; if (q) { if (c === "\\" && q === '"') k++; else if (c === q) q = null; } else if (c === "\\") k++; else if (c === "'" || c === '"') q = c; }
    return !!q;
  };

  /* Run one or more lines. io: { out(text), err(text) }. Returns the last exit code. */
  Sim.prototype.run = async function (script, io) {
    io = io || {};
    var out = io.out || function () {}, err = io.err || out, sim = this, code = 0;
    this.busy++; this.aborted = false;
    try {
      var lines = script.replace(/\r/g, "").replace(/\\\n\s*/g, " ").split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i], stdin = null;
        var h = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line);
        if (h) {
          var body = [], j = i + 1;
          while (j < lines.length && lines[j].trim() !== h[2]) body.push(lines[j++]);
          stdin = body.join("\n") + "\n"; i = j;
          line = line.replace(h[0], " ");
        }
        if (!line.trim()) continue;
        if (line.trim()[0] !== "#") this.history.push(line.trim());
        code = await this.execLine(line, { out: out, err: err, stdin: stdin }, this.scope());
        this.reconcile();
      }
    } finally { this.busy--; this.aborted = false; }
    this.changed();
    return code;
  };

  Sim.prototype.capture = async function (line, scope) {
    var buf = "";
    await this.execLine(line, { out: function (t) { buf += t; }, err: function () {}, captured: true }, scope || this.scope());
    return buf;
  };

  Sim.prototype.expand = async function (text, scope) {   // $( ... ) command substitution
    var out = "", i = 0, q = null;
    while (i < text.length) {
      var c = text[i];
      if (q === "'") { out += c; if (c === "'") q = null; i++; continue; }
      if (c === "'" && !q) { q = "'"; out += c; i++; continue; }
      if (c === '"') { q = q ? null : '"'; out += c; i++; continue; }
      if (c === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
      if (c === "$" && text[i + 1] === "(") {
        var depth = 1, j = i + 2;
        while (j < text.length && depth) { if (text[j] === "(") depth++; else if (text[j] === ")") depth--; j++; }
        var res = (await this.capture(text.slice(i + 2, j - 1), scope)).replace(/\n+$/, "");
        out += q ? res.replace(/(["\\$`])/g, "\\$1") : res.replace(/\n/g, " ").replace(/(["'\\$`|&;<>#])/g, "\\$1");
        i = j; continue;
      }
      out += c; i++;
    }
    return out;
  };

  Sim.prototype.execLine = async function (line, io, scope) {
    var code = 0, segs = splitSeq(line), prevOp = "";
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s];
      if ((prevOp === "&&" && code !== 0) || (prevOp === "||" && code === 0)) { prevOp = seg.op; continue; }
      try {
        code = await this.execPipeline(await this.expand(seg.text, scope), io, scope);
      } catch (e) {
        if (!(e instanceof CmdError)) throw e;
        if (e.message) io.err(e.message + "\n");
        code = e.code;
      }
      scope.env["?"] = String(code);
      this.reconcile();
      prevOp = seg.op;
      if (this.scope() !== scope) break;    // entered or left a sub-shell
    }
    return code;
  };

  Sim.prototype.execPipeline = async function (text, io, scope) {
    var toks = tokenize(text, scope.env), stages = [[]], redirect = null, background = false;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.op === "|") stages.push([]);
      else if (t.op === ">" || t.op === ">>") { var f = toks[++i]; if (!f || f.op) throw new CmdError("bash: syntax error near unexpected token `newline'", 2); redirect = { path: f.v, append: t.op === ">>" }; }
      else if (t.op === "<") { var inf = toks[++i]; if (inf && !inf.op) { var c = scope.fs.read(norm(inf.v, scope.cwd)); if (c == null) throw new CmdError("bash: " + inf.v + ": No such file or directory"); io = Object.assign({}, io, { stdin: c }); } }
      else if (t.op === "&") background = true;
      else stages[stages.length - 1].push(t.v);
    }
    stages = stages.filter(function (a) { return a.length; });
    if (!stages.length) return 0;
    var stdin = io.stdin == null ? null : io.stdin, code = 0;
    for (var k = 0; k < stages.length; k++) {
      var last = k === stages.length - 1, buf = "";
      var sio = {
        stdin: stdin, err: io.err, background: background, tty: last && !redirect && !io.captured,
        out: (last && !redirect) ? io.out : function (x) { buf += x; }
      };
      code = await this.execArgv(stages[k], sio, scope);
      stdin = buf;
    }
    if (redirect) {
      var p = norm(redirect.path, scope.cwd);
      if (p !== "/dev/null") {
        if (scope.fs.isDir(p)) throw new CmdError("bash: " + redirect.path + ": Is a directory");
        scope.fs.write(p, (redirect.append ? (scope.fs.read(p) || "") : "") + stdin);
      }
    }
    return code;
  };

  Sim.prototype.execArgv = async function (argv, io, scope) {
    var m;
    while (argv.length > 1 && (m = /^([A-Za-z_]\w*)=(.*)$/.exec(argv[0]))) argv = argv.slice(1);   // VAR=x cmd
    if (argv.length === 1 && (m = /^([A-Za-z_]\w*)=(.*)$/.exec(argv[0]))) { scope.env[m[1]] = m[2]; return 0; }
    if (argv[0] === "sudo") { argv = argv.slice(1); if (!argv.length) return 0; }
    var fn = scope.find(argv[0]);
    if (!fn) { io.err(scope.missing(argv[0]) + "\n"); return 127; }
    try {
      var code = await fn(argv.slice(1), io, this, scope, argv[0]);
      return code || 0;
    } catch (e) {
      if (!(e instanceof CmdError)) throw e;
      if (e.message) io.err(e.message + "\n");
      return e.code;
    }
  };

  /* ---------- networking ---------- */
  /* An endpoint is { proc, port, ip }. A proc is a running container process (see images.js). */
  Sim.prototype.resolve = function (from, host, port) {
    for (var i = 0; i < S.resolvers.length; i++) {
      var r = S.resolvers[i](this, from, host, port);
      if (r) return r;
    }
    if (from.type === "host" && (host === "localhost" || host === "127.0.0.1")) return { error: "refused", ip: "127.0.0.1" };
    throw new NetError("resolve", host);
  };
  Sim.prototype.connect = function (from, host, port) {
    var ep = this.resolve(from, host, port);
    if (ep.error) throw new NetError(ep.error, ep.ip || host);
    var p = ep.proc;
    if (!p || !p.running || !p.listen || p.listen.indexOf(ep.port) < 0) throw new NetError("refused", ep.ip || host);
    return ep;
  };
  Sim.prototype.request = function (from, req) {
    var m = /^(?:(\w+):\/\/)?(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?([^#]*)/.exec(req.url);
    if (!m) throw new NetError("resolve", req.url);
    var host = m[2], port = m[3] ? +m[3] : (m[1] === "https" ? 443 : 80), path = m[4] || "/";
    if (path[0] !== "/") path = "/" + path;
    var hostHeader = (req.headers && (req.headers.Host || req.headers.host)) || host;
    var ep = this.connect(from, host, port);
    if (ep.route) { var routed = ep.route(hostHeader, path); if (routed.response) return routed.response; ep = routed; if (!ep.proc || !ep.proc.running || ep.proc.listen.indexOf(ep.port) < 0) return { status: 502, body: S.pages.nginx(502, "Bad Gateway") }; }
    var app = ep.proc.app;
    if (!app.http || (app.httpPorts && app.httpPorts(ep.proc).indexOf(ep.port) < 0)) throw new NetError("empty", host);
    var res = app.http(ep.proc, { method: req.method || "GET", path: path.split("?")[0], query: path.split("?")[1] || "", headers: req.headers || {}, body: req.body || "", host: hostHeader, from: from });
    res.status = res.status || 200;
    return res;
  };
  S.STATUS = { 200: "OK", 201: "Created", 204: "No Content", 301: "Moved Permanently", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Time-out" };
  S.pages = {
    nginx: function (code, text) { return "<html>\n<head><title>" + code + " " + text + "</title></head>\n<body>\n<center><h1>" + code + " " + text + "</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>\n"; }
  };

  /* ---------- builtin commands (shared by the host shell and container shells) ---------- */
  function need(scope, name) { return scope.fs; }
  function lines(text) { if (text == null || text === "") return []; var l = text.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; }
  function readInput(args, io, scope, cmd) {   // files named in args, else stdin
    if (!args.length) return io.stdin || "";
    return args.map(function (a) {
      var p = norm(a, scope.cwd);
      if (scope.fs.isDir(p)) throw new CmdError(cmd + ": " + a + ": Is a directory");
      var c = scope.fs.read(p);
      if (c == null) throw new CmdError(cmd + ": " + a + ": No such file or directory");
      return c;
    }).join("");
  }
  var builtins = S.builtins = {};
  builtins.pwd = function (a, io, sim, sc) { io.out(sc.cwd + "\n"); };
  builtins.cd = function (a, io, sim, sc) {
    var p = norm(a[0] || sc.env.HOME || "/", sc.cwd);
    if (!sc.fs.isDir(p)) throw new CmdError("cd: " + a[0] + ": " + (sc.fs.isFile(p) ? "Not a directory" : "No such file or directory"));
    sc.cwd = p;
  };
  builtins.ls = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "l a h 1 R t r", unknown: function (x) { return "ls: invalid option -- " + x; }, code: 2 });
    var targets = f._.length ? f._ : ["."], out = [], code = 0;
    targets.forEach(function (t) {
      var p = norm(t, sc.cwd);
      if (sc.fs.isFile(p)) { out.push(f.l ? "-rw-r--r-- 1 " + sc.user + " " + sc.user + " " + String(sc.fs.read(p).length).padStart(5) + " " + t : t); return; }
      if (!sc.fs.isDir(p)) { io.err("ls: cannot access '" + t + "': No such file or directory\n"); code = 2; return; }
      var names = sc.fs.list(p).filter(function (n) { return f.a || n[0] !== "."; });
      if (targets.length > 1) out.push(t + ":");
      if (f.l) {
        out.push("total " + names.length * 4);
        names.forEach(function (n) {
          var q = norm(n, p), d = sc.fs.isDir(q);
          out.push((d ? "drwxr-xr-x 2 " : "-rw-r--r-- 1 ") + sc.user + " " + sc.user + " " + String(d ? 4096 : (sc.fs.read(q) || "").length).padStart(5) + " " + n);
        });
      } else if (names.length) out.push(io.tty === false || f["1"] ? names.join("\n") : names.map(function (n) { return sc.fs.isDir(norm(n, p)) ? n + "/" : n; }).join("  "));
    });
    if (out.length) io.out(out.join("\n") + "\n");
    return code;
  };
  builtins.cat = function (a, io, sim, sc) { io.out(readInput(a.filter(function (x) { return x !== "-"; }), io, sc, "cat")); };
  builtins.less = builtins.more = builtins.cat;
  builtins.echo = function (a, io) {
    var nl = true, esc = false;
    while (a.length && /^-[ne]+$/.test(a[0])) { if (a[0].indexOf("n") > 0) nl = false; if (a[0].indexOf("e") > 0) esc = true; a = a.slice(1); }
    var s = a.join(" ");
    if (esc) s = s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    io.out(s + (nl ? "\n" : ""));
  };
  builtins.printf = function (a, io) { io.out((a[0] || "").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/%s/g, function () { return a.length > 1 ? a.splice(1, 1)[0] : ""; })); };
  builtins.mkdir = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "p" });
    f._.forEach(function (d) {
      var p = norm(d, sc.cwd);
      if (sc.fs.exists(p)) { if (!f.p) throw new CmdError("mkdir: cannot create directory '" + d + "': File exists"); return; }
      if (!f.p && !sc.fs.isDir(U.dirname(p))) throw new CmdError("mkdir: cannot create directory '" + d + "': No such file or directory");
      sc.fs.mkdirp(p);
    });
  };
  builtins.touch = function (a, io, sim, sc) { a.forEach(function (x) { var p = norm(x, sc.cwd); if (!sc.fs.exists(p)) sc.fs.write(p, ""); }); };
  builtins.rm = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "r f R" }), code = 0;
    f._.forEach(function (x) {
      var p = norm(x, sc.cwd);
      if (!sc.fs.exists(p)) { if (!f.f) { io.err("rm: cannot remove '" + x + "': No such file or directory\n"); code = 1; } return; }
      if (sc.fs.isDir(p) && !(f.r || f.R)) { io.err("rm: cannot remove '" + x + "': Is a directory\n"); code = 1; return; }
      sc.fs.rm(p);
    });
    return code;
  };
  function copy(sc, a, move, cmd) {
    var f = U.flags(a, { bool: "r R f a" });
    if (f._.length < 2) throw new CmdError(cmd + ": missing file operand");
    var dst = norm(f._[f._.length - 1], sc.cwd);
    f._.slice(0, -1).forEach(function (s) {
      var p = norm(s, sc.cwd);
      if (!sc.fs.exists(p)) throw new CmdError(cmd + ": cannot stat '" + s + "': No such file or directory");
      var target = sc.fs.isDir(dst) ? norm(U.basename(p), dst) : dst;
      if (sc.fs.isDir(p)) {
        if (!move && !(f.r || f.R || f.a)) throw new CmdError("cp: -r not specified; omitting directory '" + s + "'");
        sc.fs.mkdirp(target);
        (sc.fs.walk ? sc.fs.walk(p) : []).forEach(function (e) { sc.fs.write(target + "/" + e[0], e[1]); });
      } else sc.fs.write(target, sc.fs.read(p));
      if (move) sc.fs.rm(p);
    });
  }
  builtins.cp = function (a, io, sim, sc) { copy(sc, a, false, "cp"); };
  builtins.mv = function (a, io, sim, sc) { copy(sc, a, true, "mv"); };
  builtins.head = function (a, io, sim, sc) {
    var f = U.flags(a.map(function (x) { return /^-\d+$/.test(x) ? "-n" + x.slice(1) : x; }), { str: "n c" });
    var l = lines(readInput(f._, io, sc, "head")).slice(0, f.n == null ? 10 : +f.n);
    if (l.length) io.out(l.join("\n") + "\n");
  };
  builtins.tail = function (a, io, sim, sc) {
    var f = U.flags(a.map(function (x) { return /^-\d+$/.test(x) ? "-n" + x.slice(1) : x; }), { str: "n c", bool: "f" });
    var n = f.n == null ? 10 : +f.n, l = lines(readInput(f._, io, sc, "tail"));
    l = n ? l.slice(-n) : [];
    if (l.length) io.out(l.join("\n") + "\n");
  };
  builtins.grep = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "i v E c n q F w r", str: "A B C e m", unknown: function (x) { return "grep: invalid option -- " + x; }, code: 2 });
    var pat = f.e != null ? f.e : f._.shift();
    if (pat == null) throw new CmdError("Usage: grep [OPTION]... PATTERNS [FILE]...", 2);
    var re;
    try { re = new RegExp(f.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : (f.E ? pat : pat.replace(/\\\|/g, "|").replace(/\\([()])/g, "$1")), f.i ? "i" : ""); }
    catch (e) { throw new CmdError("grep: Invalid regular expression", 2); }
    if (f.w) re = new RegExp("\\b(?:" + re.source + ")\\b", re.flags);
    var l = lines(readInput(f._, io, sc, "grep")), keep = {}, after = +(f.A || f.C || 0), before = +(f.B || f.C || 0), hits = 0;
    l.forEach(function (x, i) { if (re.test(x) !== !!f.v) { hits++; for (var j = Math.max(0, i - before); j <= Math.min(l.length - 1, i + after); j++) keep[j] = 1; } });
    if (f.q) return hits ? 0 : 1;
    if (f.c) { io.out(hits + "\n"); return hits ? 0 : 1; }
    var res = l.map(function (x, i) { return f.n ? (i + 1) + ":" + x : x; }).filter(function (x, i) { return keep[i]; });
    if (res.length) io.out(res.join("\n") + "\n");
    return hits ? 0 : 1;
  };
  builtins.wc = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "l w c" }), t = readInput(f._, io, sc, "wc");
    var l = lines(t).length, w = t.split(/\s+/).filter(Boolean).length;
    io.out((f.l ? l : f.w ? w : f.c ? t.length : l + " " + w + " " + t.length) + (f._.length ? " " + f._.join(" ") : "") + "\n");
  };
  builtins.sort = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "r n u", str: "k t" }), l = lines(readInput(f._, io, sc, "sort"));
    var key = function (x) { return f.k ? (x.trim().split(f.t || /\s+/)[parseInt(f.k, 10) - 1] || "") : x; };
    l.sort(function (x, y) { var p = key(x), q = key(y); return f.n ? parseFloat(p) - parseFloat(q) : p < q ? -1 : p > q ? 1 : 0; });
    if (f.r) l.reverse();
    if (f.u) l = l.filter(function (x, i) { return i === 0 || x !== l[i - 1]; });
    if (l.length) io.out(l.join("\n") + "\n");
  };
  builtins.uniq = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "c" }), l = lines(readInput(f._, io, sc, "uniq")), out = [], n = 0;
    l.forEach(function (x, i) { n++; if (x !== l[i + 1]) { out.push(f.c ? String(n).padStart(7) + " " + x : x); n = 0; } });
    if (out.length) io.out(out.join("\n") + "\n");
  };
  builtins.cut = function (a, io, sim, sc) {
    var f = U.flags(a, { str: "d f c" }), d = f.d == null ? "\t" : f.d, idx = String(f.f || "1").split(",").map(function (x) { return +x - 1; });
    var l = lines(readInput(f._, io, sc, "cut")).map(function (x) { var p = x.split(d); return idx.map(function (i) { return p[i] == null ? "" : p[i]; }).join(d); });
    if (l.length) io.out(l.join("\n") + "\n");
  };
  builtins.awk = function (a, io, sim, sc) {
    var f = U.flags(a, { str: "F" }), prog = f._.shift() || "";
    var m = /^\s*(?:NR\s*(>|==|>=)\s*(\d+)\s*)?(?:\/(.*)\/\s*)?\{\s*print\s*(.*?)\s*;?\s*\}\s*$/.exec(prog);
    if (!m) throw new CmdError("awk: only simple programs such as '{print $1}' are supported in this sandbox", 2);
    var re = m[3] ? new RegExp(m[3]) : null, exprs = m[4] ? m[4].split(/\s*,\s*/) : ["$0"];
    var out = [];
    lines(readInput(f._, io, sc, "awk")).forEach(function (x, i) {
      var nr = i + 1;
      if (m[1] && !(m[1] === ">" ? nr > +m[2] : m[1] === "==" ? nr === +m[2] : nr >= +m[2])) return;
      if (re && !re.test(x)) return;
      var cols = f.F ? x.split(f.F) : x.trim().split(/\s+/);
      out.push(exprs.map(function (e) {
        return e.split(/\s+(?=["$N])|(?<=")\s*(?=\$)/).map(function (p) {
          if (p === "$0") return x; if (p === "NR") return nr; if (p === "$NF") return cols[cols.length - 1] || "";
          var d = /^\$(\d+)$/.exec(p); if (d) return cols[+d[1] - 1] || "";
          var s = /^"(.*)"$/.exec(p); return s ? s[1] : "";
        }).join("");
      }).join(" "));
    });
    if (out.length) io.out(out.join("\n") + "\n");
  };
  builtins.sed = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "i E n r", multi: "e" }), scripts = f.e || [f._.shift()];
    if (!scripts[0]) throw new CmdError("sed: no script specified");
    var subs = [];
    scripts.forEach(function (script) {
      var i = 0;
      while (i < script.length) {
        while (i < script.length && /[\s;]/.test(script[i])) i++;
        if (i >= script.length) break;
        if (script[i] === "/") {                       // /pattern/d
          var e = script.indexOf("/", i + 1);
          if (e < 0 || script[e + 1] !== "d") throw new CmdError("sed: only s/old/new/[g] and /pattern/d are supported in this sandbox");
          subs.push({ del: new RegExp(script.slice(i + 1, e)) }); i = e + 2; continue;
        }
        if (script[i] !== "s" || i + 1 >= script.length) throw new CmdError("sed: only s/old/new/[g] and /pattern/d are supported in this sandbox");
        var d = script[i + 1], parts = [], cur = "", j = i + 2;
        for (; j < script.length && parts.length < 2; j++) { if (script[j] === "\\" && j + 1 < script.length) { cur += script[j + 1] === d ? d : "\\" + script[j + 1]; j++; } else if (script[j] === d) { parts.push(cur); cur = ""; } else cur += script[j]; }
        if (parts.length < 2) throw new CmdError("sed: -e expression #1, char " + script.length + ": unterminated `s' command");
        var fl = /^[gIi0-9]*/.exec(script.slice(j))[0]; i = j + fl.length;
        var src = f.E || f.r ? parts[0] : parts[0].replace(/\\([()|+?{}])/g, "\u0000$1").replace(/([()|+?{}])/g, "\\$1").replace(/\u0000([()|+?{}])/g, "$1");
        var re; try { re = new RegExp(src, (fl.indexOf("g") >= 0 ? "g" : "") + (/[Ii]/.test(fl) ? "i" : "")); } catch (e2) { throw new CmdError("sed: -e expression #1: invalid regular expression"); }
        subs.push({ re: re, to: parts[1].replace(/\$/g, "$$$$").replace(/\\(\d)/g, "$$$1").replace(/(^|[^\\])&/g, "$1$$&").replace(/\\&/g, "&").replace(/\\n/g, "\n") });
      }
    });
    function apply(text) {
      var l = lines(text).filter(function (x) { return !subs.some(function (s) { return s.del && s.del.test(x); }); })
        .map(function (x) { subs.forEach(function (s) { if (s.re) x = x.replace(s.re, s.to); }); return x; });
      return l.length ? l.join("\n") + "\n" : "";
    }
    if (f.i) {
      if (!f._.length) throw new CmdError("sed: no input files");
      f._.forEach(function (x) { var p = norm(x, sc.cwd), c = sc.fs.read(p); if (c == null) throw new CmdError("sed: can't read " + x + ": No such file or directory", 2); sc.fs.write(p, apply(c)); });
    } else io.out(apply(readInput(f._, io, sc, "sed")));
  };
  builtins.base64 = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "d D decode", str: "w" }), t = readInput(f._, io, sc, "base64");
    if (f.d || f.D || f.decode) { try { io.out(U.b64d(t.trim())); } catch (e) { throw new CmdError("base64: invalid input"); } }
    else io.out(U.b64e(t) + "\n");
  };
  builtins.tr = function (a, io) {
    var f = U.flags(a, { bool: "d" }), t = io.stdin || "";
    function set(s) { return (s || "").replace(/\\n/g, "\n").replace(/(\w)-(\w)/g, function (_, x, y) { var o = ""; for (var c = x.charCodeAt(0); c <= y.charCodeAt(0); c++) o += String.fromCharCode(c); return o; }); }
    var from = set(f._[0]), to = set(f._[1]);
    io.out(t.split("").map(function (c) { var i = from.indexOf(c); return i < 0 ? c : f.d ? "" : to[Math.min(i, to.length - 1)] || ""; }).join(""));
  };
  builtins.tee = function (a, io, sim, sc) { var f = U.flags(a, { bool: "a" }); f._.forEach(function (x) { var p = norm(x, sc.cwd); sc.fs.write(p, (f.a ? sc.fs.read(p) || "" : "") + (io.stdin || "")); }); io.out(io.stdin || ""); };
  builtins.env = builtins.printenv = function (a, io, sim, sc) {
    if (a.length) { if (sc.env[a[0]] == null) return 1; io.out(sc.env[a[0]] + "\n"); return 0; }
    io.out(Object.keys(sc.env).filter(function (k) { return k !== "?"; }).map(function (k) { return k + "=" + sc.env[k]; }).join("\n") + "\n");
  };
  builtins.export = function (a, io, sim, sc) { a.forEach(function (x) { var m = /^([A-Za-z_]\w*)=(.*)$/.exec(x); if (m) sc.env[m[1]] = m[2]; }); };
  builtins.unset = function (a, io, sim, sc) { a.forEach(function (x) { delete sc.env[x]; }); };
  builtins.sleep = async function (a, io, sim) {
    if (a[0] === "infinity") throw new CmdError("sleep: 'infinity' would block the sandbox shell forever", 1);
    var n = parseFloat(a[0]); if (isNaN(n)) throw new CmdError("sleep: missing operand");
    await sim.wait(n * (/m$/.test(a[0]) ? 60000 : 1000));
  };
  builtins.date = function (a, io, sim) { io.out(sim.date().toUTCString().replace("GMT", "UTC") + "\n"); };
  builtins.whoami = function (a, io, sim, sc) { io.out(sc.user + "\n"); };
  builtins.id = function (a, io, sim, sc) { var u = sc.user === "root" ? 0 : sc.uid || 1000; io.out("uid=" + u + "(" + sc.user + ") gid=" + u + "(" + sc.user + ") groups=" + u + "(" + sc.user + ")\n"); };
  builtins.hostname = function (a, io, sim, sc) { io.out((a[0] === "-i" || a[0] === "-I" ? sc.ip || "127.0.0.1" : sc.hostname) + "\n"); };
  builtins.true = function () { return 0; };
  builtins.false = function () { return 1; };
  builtins[":"] = builtins.true;
  builtins.which = function (a, io, sim, sc) { if (a[0] && sc.find(a[0])) { io.out("/usr/bin/" + a[0] + "\n"); return 0; } return 1; };
  builtins.clear = function (a, io, sim) { if (sim.ui.clear) sim.ui.clear(); };
  builtins.history = function (a, io, sim) { io.out(sim.history.map(function (h, i) { return String(i + 1).padStart(5) + "  " + h; }).join("\n") + "\n"); };
  builtins.exit = builtins.logout = function (a, io, sim, sc) {
    if (sim.scopes.length > 1) { sim.scopes.pop(); if (sc.onExit) sc.onExit(parseInt(a[0] || "0", 10)); return parseInt(a[0] || "0", 10); }
    io.out("This is the sandbox's only shell, so there is nothing to exit. Use the Reset button to start over.\n");
  };
  builtins.sh = builtins.bash = builtins.ash = async function (a, io, sim, sc, name) {
    if (a[0] === "-c") { if (a[1] == null) throw new CmdError(name + ": -c: option requires an argument", 2); return sim.execLine(a[1], io, sc); }
    if (a.length) { var c = sc.fs.read(norm(a[0], sc.cwd)); if (c == null) throw new CmdError(name + ": " + a[0] + ": No such file or directory", 127); var code = 0; var ls = lines(c); for (var i = 0; i < ls.length; i++) if (ls[i].trim() && ls[i].trim()[0] !== "#") code = await sim.execLine(ls[i], io, sc); return code; }
    if (io.stdin) { var code2 = 0, l2 = lines(io.stdin); for (var k = 0; k < l2.length; k++) if (l2[k].trim()) code2 = await sim.execLine(l2[k], io, sc); return code2; }
    return 0;   // a nested interactive shell behaves like the current one
  };
  async function editor(a, io, sim, sc, name) {
    if (!a[0]) throw new CmdError(name + ": give a file name, for example: " + name + " Dockerfile");
    var p = norm(a[0], sc.cwd);
    if (sc.fs.isDir(p)) throw new CmdError(name + ": " + a[0] + ": Is a directory");
    if (!sim.ui.edit) throw new CmdError(name + ": no editor is available here");
    var text = await sim.ui.edit(a[0], sc.fs.read(p) || "");
    if (text != null) sc.fs.write(p, text.replace(/\r/g, "").replace(/\n*$/, "\n"));
  }
  ["nano", "vi", "vim", "edit", "code", "notepad"].forEach(function (n) { builtins[n] = editor; });

  /* curl / wget — both go through sim.request() */
  function netFail(tool, e, host, port) {
    if (tool === "curl") {
      if (e.kind === "resolve") return new CmdError("curl: (6) Could not resolve host: " + host, 6);
      if (e.kind === "refused") return new CmdError("curl: (7) Failed to connect to " + host + " port " + port + " after 0 ms: Could not connect to server", 7);
      if (e.kind === "reset") return new CmdError("curl: (56) Recv failure: Connection reset by peer", 56);
      if (e.kind === "timeout") return new CmdError("curl: (28) Failed to connect to " + host + " port " + port + " after " + e.ms + " ms: Timeout was reached", 28);
      return new CmdError("curl: (52) Empty reply from server", 52);
    }
    if (e.kind === "resolve") return new CmdError("wget: bad address '" + host + (port !== 80 ? ":" + port : "") + "'");
    if (e.kind === "refused") return new CmdError("wget: can't connect to remote host (" + (e.detail || host) + "): Connection refused");
    if (e.kind === "timeout") return new CmdError("wget: download timed out");
    return new CmdError("wget: error getting response: Connection reset by peer");
  }
  async function doRequest(tool, sim, sc, req, timeout) {
    var m = /^(?:\w+:\/\/)?([^/:?#]+)(?::(\d+))?/.exec(req.url) || [], host = m[1] || req.url, port = m[2] ? +m[2] : (/^https:/.test(req.url) ? 443 : 80);
    try { return sim.request(sc.origin, req); }
    catch (e) {
      if (!(e instanceof NetError)) throw e;
      if (e.kind === "timeout") { var ms = Math.min(timeout || 10, 130) * 1000; await sim.wait(ms); e.ms = ms + 1; }
      throw netFail(tool, e, host, port);
    }
  }
  builtins.curl = async function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "s S i I L f v k silent show-error include head location fail verbose insecure", str: "X d m o w u request data max-time connect-timeout output write-out user data-raw", multi: "H header",
      alias: { H: "header", X: "request", d: "data", m: "max-time", i: "include", I: "head", f: "fail", o: "output", w: "write-out", s: "silent" }, unknown: function (x) { return "curl: option " + x.replace(/.*'(.)'.*/, "-$1") + ": is unknown\ncurl: try 'curl --help' for more information"; }, code: 2 });
    if (!f._.length) throw new CmdError("curl: (2) no URL specified\ncurl: try 'curl --help' for more information", 2);
    var headers = {};
    (f.header || []).forEach(function (h) { var i = h.indexOf(":"); if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim(); });
    var body = f.data || f["data-raw"];
    var res = await doRequest("curl", sim, sc, { url: f._[0], method: f.request || (f.head ? "HEAD" : body != null ? "POST" : "GET"), headers: headers, body: body || "" }, +(f["max-time"] || f["connect-timeout"] || 0));
    var text = "";
    if (f.include || f.head) text += "HTTP/1.1 " + res.status + " " + (S.STATUS[res.status] || "") + "\nContent-Type: " + (res.type || "text/plain") + "\nContent-Length: " + (res.body || "").length + (res.server ? "\nServer: " + res.server : "") + "\n\n";
    if (f.fail && res.status >= 400) throw new CmdError("curl: (22) The requested URL returned error: " + res.status, 22);
    if (!f.head) text += res.body || "";
    if (f.output && f.output !== "-") { if (f.output !== "/dev/null") sc.fs.write(norm(f.output, sc.cwd), text); text = ""; }
    if (f["write-out"]) text += f["write-out"].replace(/%\{http_code\}/g, res.status).replace(/\\n/g, "\n");
    io.out(text);
    return 0;
  };
  builtins.wget = async function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "q S", str: "O T t", multi: "header", unknown: function (x) { return "wget: unrecognized option: " + x.replace(/^-+/, ""); } });
    if (!f._.length) throw new CmdError("BusyBox v1.36.1 multi-call binary.\n\nUsage: wget [-qO-] [-T SEC] URL...");
    var res = await doRequest("wget", sim, sc, { url: f._[0], method: "GET", headers: {} }, +(f.T || 0));
    if (res.status >= 400) throw new CmdError("wget: server returned error: HTTP/1.1 " + res.status + " " + (S.STATUS[res.status] || ""));
    if (f.O === "-" ) io.out(res.body || "");
    else { var name = f.O || U.basename(f._[0].split("?")[0]) || "index.html"; if (name !== "/dev/null") sc.fs.write(norm(name, sc.cwd), res.body || ""); if (!f.q) io.out("saving to '" + name + "'\n'" + name + "' saved\n"); }
    return 0;
  };
  builtins.nc = function (a, io, sim, sc) {
    var f = U.flags(a, { bool: "z v", str: "w" });
    if (f._.length < 2) throw new CmdError("usage: nc [-zv] [-w SEC] HOST PORT");
    try { var ep = sim.connect(sc.origin, f._[0], +f._[1]); io.out(f._[0] + " (" + (ep.ip || f._[0]) + ":" + f._[1] + ") open\n"); return 0; }
    catch (e) {
      if (!(e instanceof NetError)) throw e;
      throw new CmdError(e.kind === "resolve" ? "nc: bad address '" + f._[0] + "'" : e.kind === "timeout" ? "nc: " + f._[0] + " (" + (e.detail || f._[0]) + ":" + f._[1] + "): Operation timed out" : "nc: " + f._[0] + " (" + (e.detail || f._[0]) + ":" + f._[1] + "): Connection refused");
    }
  };
  builtins.nslookup = function (a, io, sim, sc) {
    if (!a[0]) throw new CmdError("Usage: nslookup HOST");
    var dns = sc.dns || "127.0.0.53";
    try {
      var ep = sim.resolve(sc.origin, a[0], 0);
      io.out("Server:\t\t" + dns + "\nAddress:\t" + dns + ":53\n\nName:\t" + (ep.fqdn || a[0]) + "\nAddress: " + (ep.ip || "127.0.0.1") + "\n\n");
      return 0;
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      io.out("Server:\t\t" + dns + "\nAddress:\t" + dns + ":53\n\n** server can't find " + a[0] + ": NXDOMAIN\n\n");
      return 1;
    }
  };
  builtins.ping = function (a, io, sim, sc) {
    var host = a.filter(function (x) { return x[0] !== "-" && !/^\d+$/.test(x); })[0];
    if (!host) throw new CmdError("Usage: ping HOST");
    try { var ep = sim.resolve(sc.origin, host, 0), ip = ep.ip || "127.0.0.1"; io.out("PING " + host + " (" + ip + "): 56 data bytes\n64 bytes from " + ip + ": seq=0 ttl=64 time=0.087 ms\n64 bytes from " + ip + ": seq=1 ttl=64 time=0.102 ms\n\n--- " + host + " ping statistics ---\n2 packets transmitted, 2 packets received, 0% packet loss\n"); }
    catch (e) { if (!(e instanceof NetError)) throw e; throw new CmdError("ping: bad address '" + host + "'"); }
  };
  builtins.watch = function () { throw new CmdError("watch: not available in the sandbox. Run the command again instead (press ↑ then Enter); time keeps moving between commands."); };
  builtins.help = function (a, io) {
    io.out([
      "infra-sim sandbox — a simulated Linux shell with Docker, Kubernetes, Helm and Argo CD.",
      "",
      "Tools:      docker (and docker compose), kubectl (alias: k), helm, argocd, git",
      "Files:      ls cat cd pwd mkdir rm cp mv touch nano|vi (opens an editor) sed -i",
      "Text:       grep head tail wc sort uniq cut awk '{print $1}' base64 tr tee",
      "Network:    curl wget nslookup nc",
      "Shell:      pipes |   redirects > >>   && || ;   $(command)   heredocs <<EOF   VAR=value   & (background)",
      "Other:      sleep N (fast-forwards simulated time), clear, history, help",
      "",
      "Keys:       ↑/↓ history · Tab completes · Ctrl+C stops a waiting command · Ctrl+L clears",
      "Everything is simulated in your browser: nothing is installed and nothing can break."
    ].join("\n") + "\n");
  };
  ["minikube", "kind", "k3d"].forEach(function (n) { builtins[n] = function (a, io) { io.out("The sandbox already has a 3-node Kubernetes cluster running, so you don't need " + n + " here. Try: kubectl get nodes\n"); }; });
  ["apt", "apt-get", "yum", "brew", "snap", "pip", "npm"].forEach(function (n) { builtins[n] = function () { throw new CmdError(n + ": installing software is not possible in the sandbox. docker, kubectl, helm, argocd and git are already installed."); }; });

  S.lines = lines;
})(typeof window !== "undefined" ? window : globalThis);
