/* infra-sim — `docker build` (BuildKit-style output) and `docker compose`. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, D = S.docker;
  function derr(msg, code) { return new CmdError(msg, code == null ? 1 : code); }
  var KNOWN = ["FROM", "RUN", "CMD", "LABEL", "MAINTAINER", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT", "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL"];

  function parseDockerfile(text) {
    var out = [], raw = text.split("\n");
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i], start = i + 1;
      if (!line.trim() || line.trim()[0] === "#") continue;
      while (/\\\s*$/.test(line) && i + 1 < raw.length) { line = line.replace(/\\\s*$/, "") + " " + raw[++i].trim(); while (raw[i].trim()[0] === "#" && i + 1 < raw.length) line += raw[++i].trim(); }
      var m = /^\s*(\S+)\s*(.*)$/.exec(line), ins = m[1].toUpperCase();
      if (KNOWN.indexOf(ins) < 0) {
        var near = KNOWN.filter(function (k) { return Math.abs(k.length - ins.length) <= 1 && k.split("").filter(function (c, n) { return ins[n] === c; }).length >= k.length - 2; })[0];
        throw derr("dockerfile parse error on line " + start + ": unknown instruction: " + m[1] + (near ? " (did you mean " + near + "?)" : ""));
      }
      out.push({ ins: ins, args: m[2].trim(), line: start, text: ins + " " + m[2].trim() });
    }
    return out;
  }
  function words(s, vars) { return S.tokenize(s, vars || {}).filter(function (t) { return t.v != null; }).map(function (t) { return t.v; }); }
  function execForm(s, vars) {
    if (/^\s*\[/.test(s)) { try { var a = JSON.parse(s); if (Array.isArray(a)) return { exec: true, argv: a.map(String) }; } catch (e) { /* falls back to shell form, like Docker */ } }
    return { exec: false, argv: ["/bin/sh", "-c", s] };
  }
  function subst(s, vars) { return s.replace(/\$\{(\w+)(?::-([^}]*))?\}|\$(\w+)/g, function (_, a, def, b) { var k = a || b; return vars[k] != null ? vars[k] : def != null ? def : ""; }); }

  /* Simulate a RUN instruction. Returns { ok, log:[], exit, bytes } and mutates the stage. */
  function runStep(st, script) {
    var log = [], bytes = 0, wd = st.config.WorkingDir || "/", parts = script.split(/\s*(?:&&|;)\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
    function fail(code, lines) { return { ok: false, log: log.concat(lines), exit: code }; }
    if (!st.tools.length) return fail(127, ["runc run failed: unable to start container process: exec: \"/bin/sh\": stat /bin/sh: no such file or directory"]);
    for (var i = 0; i < parts.length; i++) {
      var redirect = /^(.*?)\s*(>>?)\s*(\S+)\s*$/.exec(parts[i]), cmdText = redirect ? redirect[1] : parts[i], a;
      try { a = words(cmdText, st.config.Env); } catch (e) { a = cmdText.split(/\s+/); }
      if (!a.length) continue;
      var c = a[0];
      if (c === "npm") {
        var sub = a[1], pkgPath = U.norm("package.json", wd), pkg;
        if (!st.hasTool("npm")) return fail(127, ["/bin/sh: npm: not found"]);
        try { pkg = JSON.parse(st.files[pkgPath] || "null"); } catch (e2) { return fail(1, ["npm error code EJSONPARSE", "npm error path " + pkgPath, "npm error JSON.parse Invalid package.json: " + e2.message]); }
        if (sub === "install" || sub === "i" || sub === "ci") {
          if (!pkg) return fail(254, ["npm error code ENOENT", "npm error syscall open", "npm error path " + pkgPath, "npm error errno -2", "npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '" + pkgPath + "'", "npm error enoent This is related to npm not being able to find a file."]);
          if (sub === "ci" && !st.files[U.norm("package-lock.json", wd)]) return fail(1, ["npm error code EUSAGE", "npm error", "npm error The `npm ci` command can only install with an existing package-lock.json or", "npm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or", "npm error later to generate a package-lock.json file, then try again."]);
          var prod = a.indexOf("--omit=dev") >= 0 || a.indexOf("--production") >= 0 || a.indexOf("--only=production") >= 0;
          var deps = Object.keys(pkg.dependencies || {}).concat(prod ? [] : Object.keys(pkg.devDependencies || {}));
          deps.forEach(function (d) { st.files[U.norm("node_modules/" + d + "/package.json", wd)] = "{\"name\":\"" + d + "\"}\n"; });
          bytes += deps.length * 4200000 + 180000;
          log.push("", "added " + (deps.length * 23 + 1) + " packages, and audited " + (deps.length * 23 + 2) + " packages in " + (1 + deps.length) + "s", "", "found 0 vulnerabilities");
        } else if (sub === "run") {
          if (!pkg) return fail(254, ["npm error code ENOENT", "npm error enoent Could not read package.json"]);
          if (!pkg.scripts || !pkg.scripts[a[2]]) return fail(1, ["npm error Missing script: \"" + a[2] + "\"", "npm error", "npm error To see a list of scripts, run:", "npm error   npm run"]);
          log.push("", "> " + (pkg.name || "app") + "@" + (pkg.version || "1.0.0") + " " + a[2], "> " + pkg.scripts[a[2]], "");
          if (a[2] === "build") { var src = st.files[U.norm("src/index.html", wd)] || st.files[U.norm("public/index.html", wd)] || st.files[U.norm("index.html", wd)] || "<h1>" + (pkg.name || "app") + "</h1>\n"; st.files[U.norm("dist/index.html", wd)] = src; bytes += 240000; log.push("✓ built in 1.42s"); }
        } else if (sub !== "cache" && sub !== "config" && sub !== "prune") return fail(1, ["npm error Unknown command: \"" + sub + "\""]);
      } else if (c === "apk") {
        if (!st.hasTool("apk")) return fail(127, ["/bin/sh: 1: apk: not found"]);
        if (a[1] === "add") { var pk = a.slice(2).filter(function (x) { return x[0] !== "-"; }); pk.forEach(function (x) { st.addTool(x); }); bytes += pk.length * 2600000; log.push("fetch https://dl-cdn.alpinelinux.org/alpine/v3.22/main/x86_64/APKINDEX.tar.gz"); pk.forEach(function (x, n) { log.push("(" + (n + 1) + "/" + pk.length + ") Installing " + x); }); log.push("OK: " + (12 + pk.length * 3) + " MiB in " + (17 + pk.length * 4) + " packages"); }
      } else if (c === "apt-get" || c === "apt") {
        if (!st.hasTool("apt-get")) return fail(127, ["/bin/sh: " + c + ": not found"]);
        if (a[1] === "update") { st.aptUpdated = true; bytes += 19000000; log.push("Get:1 http://deb.debian.org/debian trixie InRelease [140 kB]", "Fetched 9285 kB in 1s (7340 kB/s)", "Reading package lists..."); }
        else if (a[1] === "install") {
          var pk2 = a.slice(2).filter(function (x) { return x[0] !== "-"; });
          if (!st.aptUpdated) return fail(100, ["Reading package lists...", "Building dependency tree...", "Reading state information..."].concat(pk2.map(function (x) { return "E: Unable to locate package " + x; })));
          if (a.indexOf("-y") < 0 && a.indexOf("--yes") < 0 && a.indexOf("-qy") < 0 && a.indexOf("-yq") < 0) return fail(1, ["Reading package lists...", "Building dependency tree...", "After this operation, 12.4 MB of additional disk space will be used.", "Do you want to continue? [Y/n] Abort."]);
          pk2.forEach(function (x) { st.addTool(x); }); bytes += pk2.length * 9800000;
          log.push("Reading package lists...", "Setting up " + pk2.join(", ") + " ...");
        } else if (a[1] === "clean") { /* nothing */ }
      } else if (c === "pip" || c === "pip3") {
        if (!st.hasTool("pip")) return fail(127, ["/bin/sh: " + c + ": not found"]);
        var ri = a.indexOf("-r");
        if (ri >= 0 && !st.files[U.norm(a[ri + 1] || "", wd)]) return fail(1, ["ERROR: Could not open requirements file: [Errno 2] No such file or directory: '" + a[ri + 1] + "'"]);
        bytes += 21000000; log.push("Successfully installed packages");
      } else if (c === "echo") {
        if (redirect) { var fp = U.norm(redirect[3], wd); st.files[fp] = (redirect[2] === ">>" ? st.files[fp] || "" : "") + a.slice(1).join(" ") + "\n"; bytes += 100; } else log.push(a.slice(1).join(" "));
      } else if (c === "rm") {
        a.slice(1).filter(function (x) { return x[0] !== "-"; }).forEach(function (x) { var q = U.norm(x, wd); Object.keys(st.files).forEach(function (k) { if (k === q || k.indexOf(q + "/") === 0) delete st.files[k]; }); });
      } else if (c === "exit") { if (+a[1]) return fail(+a[1], []); }
      else if (c === "false") return fail(1, []);
      else if (["mkdir", "chmod", "chown", "adduser", "addgroup", "useradd", "groupadd", "ln", "true", "set", "cd", "touch", "update-ca-certificates", "ls", "cat", "cp", "mv", "test", "["].indexOf(c) >= 0) { if (c === "touch") a.slice(1).forEach(function (x) { st.files[U.norm(x, wd)] = st.files[U.norm(x, wd)] || ""; }); }
      else if (!st.hasTool(c)) return fail(127, ["/bin/sh: " + (st.os === "alpine" ? "" : "1: ") + c + ": not found"]);
    }
    return { ok: true, log: log, bytes: bytes };
  }

  function contextFiles(sim, dir) {
    var files = D.walk(sim.fs, dir), ignore = (sim.fs.read(dir + "/.dockerignore") || "").split("\n").map(function (l) { return l.trim().replace(/^\.?\//, "").replace(/\/$/, ""); }).filter(function (l) { return l && l[0] !== "#"; });
    return files.filter(function (e) {
      return !ignore.some(function (pat) {
        if (pat.indexOf("*") >= 0) { var re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, "(.*/)?") + "(/.*)?$"); return re.test(e[0]); }
        return e[0] === pat || e[0].indexOf(pat + "/") === 0;
      });
    });
  }

  function line(text, secs) { var t = secs.toFixed(1) + "s"; return (text.length > 78 - t.length - 1 ? text.slice(0, 78 - t.length - 1) : text.padEnd(78 - t.length - 1)) + " " + t + "\n"; }

  D.build = async function (a, io, sim, sc) {
    var f = U.flags(a, { str: "f file target progress platform network", bool: "no-cache q quiet pull load push rm", multi: "t tag build-arg label", alias: { t: "tag", f: "file" },
      unknown: function (x) { return "unknown flag: " + x.replace(/^unknown shorthand flag: /, "") + "\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -"; }, code: 125 });
    if (f._.length !== 1) throw derr("ERROR: docker: 'docker buildx build' requires 1 argument\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n\nStart a build", 1);
    var dir = U.norm(f._[0], sc.cwd), out = f.q || f.quiet ? function () {} : io.err;
    if (!sim.fs.isDir(dir)) throw derr("ERROR: unable to prepare context: path \"" + f._[0] + "\" not found");
    var dfPath = f.file ? U.norm(f.file, sc.cwd) : dir + "/Dockerfile", dfName = f.file ? U.basename(f.file) : "Dockerfile", text = sim.fs.read(dfPath);
    var tags = (f.tag || []).map(function (t) { var r = S.parseRef(t); if (!r.valid) throw derr("ERROR: failed to build: invalid tag \"" + t + "\": invalid reference format" + (/[A-Z]/.test(t) ? ": repository name (" + t.split(":")[0] + ") must be lowercase" : "")); return r; });
    var t0 = sim.now, body = "", steps = 0, done = 0;
    function solveFail(msg) { return derr("ERROR: failed to build: failed to solve: " + msg, 1); }
    function emit(extraHead) { out("[+] Building " + ((sim.now - t0) / 1000).toFixed(1) + "s (" + done + "/" + steps + ")" + (extraHead || " FINISHED").padEnd(20) + "                 docker:default\n" + body); }
    if (text == null) { steps = 1; body = line(" => [internal] load build definition from " + dfName, 0) + line(" => => transferring dockerfile: 2B", 0); done = 1; emit(" FINISHED"); throw solveFail("failed to read dockerfile: open " + dfName + ": no such file or directory"); }
    var ins;
    body += line(" => [internal] load build definition from " + dfName, 0) + line(" => => transferring dockerfile: " + text.length + "B", 0);
    steps = 1; done = 1;
    try { ins = parseDockerfile(text); } catch (e) { emit(""); throw solveFail(e.message); }
    var args = D.parse.env(f["build-arg"]), globalArgs = {}, stages = [], cur = null, ctx = null, snippetFail = null;
    var firstFrom = ins.filter(function (x) { return x.ins !== "ARG"; })[0];
    if (!firstFrom || firstFrom.ins !== "FROM") { emit(""); throw solveFail(ins.length ? "no build stage in current context" : "the Dockerfile cannot be empty"); }
    var totalByStage = [], si = -1;
    ins.forEach(function (x) { if (x.ins === "FROM") { si++; totalByStage[si] = 1; } else if (si >= 0 && ["RUN", "COPY", "ADD", "WORKDIR"].indexOf(x.ins) >= 0) totalByStage[si]++; });
    var multi = totalByStage.length > 1;

    function newStage(base, name, key) {
      var st = { name: name, files: Object.assign({}, base ? base.files : {}), config: base ? U.clone(base.config) : { Env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" }, Cmd: null, Entrypoint: null, WorkingDir: "", ExposedPorts: [], User: "", Labels: {}, Volumes: [], StopSignal: "SIGTERM" },
        app: base ? base.app : "shell", appName: base ? base.appName : null, version: base ? base.version : "", os: base ? base.os : "scratch", tools: base ? base.tools.slice() : [], size: base ? base.size : 0,
        history: base ? base.history.slice() : [], key: key, step: 1, aptUpdated: !!(base && base.aptUpdated) };
      st.hasTool = function (t) { return st.tools.indexOf(t) >= 0 || (t === "apt-get" && st.tools.indexOf("apt") >= 0) || (t === "pip" && st.tools.indexOf("pip3") >= 0); };
      st.addTool = function (t) { if (st.tools.indexOf(t) < 0) st.tools.push(t); if (t === "bind-tools" || t === "dnsutils") st.tools.push("nslookup"); if (t === "netcat-openbsd") st.tools.push("nc"); if (t === "iputils-ping" || t === "iputils") st.tools.push("ping"); };
      return st;
    }
    function label(st) { return "[" + (multi ? (st.name || "stage-" + stages.indexOf(st)) + " " : "") + st.step + "/" + totalByStage[stages.indexOf(st)] + "]"; }
    function snippet(x, msg) {
      var ls = text.split("\n"), from = Math.max(1, x.line - 2), to = Math.min(ls.length, x.line + 2), s = dfName + ":" + x.line + "\n--------------------\n";
      for (var n = from; n <= to; n++) s += String(n).padStart(4) + " | " + (n === x.line ? ">>> " : "    ") + ls[n - 1] + "\n";
      return s + "--------------------\n" + "ERROR: failed to build: failed to solve: " + msg;
    }

    for (var i = 0; i < ins.length && !snippetFail; i++) {
      var x = ins[i], vars = Object.assign({}, globalArgs, cur ? cur.args : {}, cur ? cur.config.Env : {});
      if (x.ins === "ARG" && !cur) { x.args.split(/\s+/).forEach(function (kv) { var p = kv.split("="); globalArgs[p[0]] = args[p[0]] != null ? args[p[0]] : p.slice(1).join("="); }); continue; }
      if (x.ins === "FROM") {
        var fm = /^(?:--platform=\S+\s+)?(\S+)(?:\s+[Aa][Ss]\s+(\S+))?$/.exec(subst(x.args, globalArgs));
        if (!fm) { snippetFail = snippet(x, "dockerfile parse error on line " + x.line + ": FROM requires either one or three arguments"); break; }
        var baseRef = fm[1], prev = stages.filter(function (s) { return s.name === baseRef; })[0], base = null, r = S.parseRef(baseRef);
        if (baseRef === "scratch") base = null;
        else if (prev) base = prev;
        else {
          steps++;
          base = D.findImage(sim, baseRef) || D.registryImage(sim, r);
          await sim.wait(600);
          if (!base) {
            body += line(" => ERROR [internal] load metadata for " + r.full, 0.6);
            emit(" ERROR");
            throw derr("------\n > [internal] load metadata for " + r.full + ":\n------\n" + snippet(x, r.short + ": failed to resolve source metadata for " + r.full + ": " + (D.repoKnown(sim, r) ? r.full + ": not found" : "pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed")), 1);
          }
          done++;
          body += line(" => [internal] load metadata for " + r.full, 0.6);
          if (!ctx) {
            ctx = contextFiles(sim, dir);
            steps += 2; done += 2;
            body += line(" => [internal] load .dockerignore", 0) + line(" => => transferring context: " + (sim.fs.read(dir + "/.dockerignore") || "  ").length + "B", 0);
            body += line(" => [internal] load build context", 0) + line(" => => transferring context: " + U.size(ctx.reduce(function (n, e) { return n + e[1].length; }, 0)), 0);
          }
        }
        cur = newStage(base, fm[2] || null, "from:" + (base ? base.id || base.key : "scratch"));
        cur.args = {};
        stages.push(cur);
        steps++; done++;
        body += line(" => " + (prev || baseRef === "scratch" ? "" : "") + label(cur) + " FROM " + (prev ? baseRef : baseRef === "scratch" ? "scratch" : r.full + "@sha256:" + S.hex(r.full + "digest", 12) + "…"), 0);
        continue;
      }
      var argText = subst(x.args, vars);
      if (x.ins === "ARG") { x.args.split(/\s+/).forEach(function (kv) { var p = kv.split("="); cur.args[p[0]] = args[p[0]] != null ? args[p[0]] : p.length > 1 ? p.slice(1).join("=") : globalArgs[p[0]] || ""; }); continue; }
      if (x.ins === "ENV") {
        var em = /^(\w+)\s+([^=]+)$/.exec(argText);
        if (em) cur.config.Env[em[1]] = em[2];
        else words(argText, {}).forEach(function (kv) { var p = kv.indexOf("="); if (p > 0) cur.config.Env[kv.slice(0, p)] = kv.slice(p + 1); });
        cur.key += "|" + x.text; cur.history.unshift({ by: "ENV " + argText, size: 0 }); continue;
      }
      if (x.ins === "EXPOSE") { argText.split(/\s+/).forEach(function (p) { var e = p.indexOf("/") < 0 ? p + "/tcp" : p; if (cur.config.ExposedPorts.indexOf(e) < 0) cur.config.ExposedPorts.push(e); }); cur.history.unshift({ by: "EXPOSE " + argText, size: 0 }); cur.key += "|" + x.text; continue; }
      if (x.ins === "USER") { cur.config.User = argText; cur.key += "|" + x.text; cur.history.unshift({ by: "USER " + argText, size: 0 }); continue; }
      if (x.ins === "LABEL") { words(argText, {}).forEach(function (kv) { var p = kv.indexOf("="); if (p > 0) cur.config.Labels[kv.slice(0, p)] = kv.slice(p + 1); }); cur.key += "|" + x.text; continue; }
      if (x.ins === "VOLUME") { (execForm(argText).exec ? execForm(argText).argv : argText.split(/\s+/)).forEach(function (v) { cur.config.Volumes.push(v); }); cur.key += "|" + x.text; continue; }
      if (x.ins === "CMD") { var cf = execForm(argText); cur.config.Cmd = cf.argv; cur.shellCmd = !cf.exec; cur.key += "|" + x.text; cur.history.unshift({ by: "CMD " + JSON.stringify(cf.argv), size: 0 }); continue; }
      if (x.ins === "ENTRYPOINT") { var ef = execForm(argText); cur.config.Entrypoint = ef.argv; cur.config.Cmd = null; cur.key += "|" + x.text; cur.history.unshift({ by: "ENTRYPOINT " + JSON.stringify(ef.argv), size: 0 }); continue; }
      if (["HEALTHCHECK", "STOPSIGNAL", "SHELL", "ONBUILD", "MAINTAINER"].indexOf(x.ins) >= 0) { cur.key += "|" + x.text; continue; }

      // Layer-producing steps: WORKDIR, COPY/ADD, RUN
      cur.step++; steps++;
      var head = label(cur) + " " + x.ins + " " + x.args, secs = 0, stepKey = cur.key + "|" + x.text, cachedOk;
      if (x.ins === "WORKDIR") {
        cur.config.WorkingDir = U.norm(argText, cur.config.WorkingDir || "/");
        cur.history.unshift({ by: "WORKDIR " + cur.config.WorkingDir, size: 0 });
      } else if (x.ins === "COPY" || x.ins === "ADD") {
        var w = words(argText, {}), fromStage = null, srcFiles = ctx || [];
        w = w.filter(function (t) { var m = /^--from=(.+)$/.exec(t); if (m) fromStage = m[1]; return !/^--/.test(t); });
        if (w.length < 2) { snippetFail = snippet(x, "dockerfile parse error on line " + x.line + ": " + x.ins + " requires at least two arguments, but only one was provided. Destination could not be determined"); break; }
        if (fromStage != null) {
          var fs2 = stages.filter(function (s, n) { return s.name === fromStage || String(n) === fromStage; })[0], img2 = fs2 ? null : D.findImage(sim, fromStage) || D.registryImage(sim, fromStage);
          if (!fs2 && !img2) { snippetFail = snippet(x, "failed to stat stage: stage \"" + fromStage + "\" not found"); steps--; break; }
          srcFiles = Object.keys((fs2 || img2).files).map(function (k) { return [k.slice(1), (fs2 || img2).files[k]]; });
          stepKey += "#" + (fs2 ? fs2.key : img2.id);
        }
        var dest = w[w.length - 1], destDir = /\/$/.test(dest) || dest === "." || w.length > 2, wd = cur.config.WorkingDir || "/", copied = [], miss = null;
        w.slice(0, -1).forEach(function (src) {
          var s = src.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/$/, "");
          var re = s.indexOf("*") >= 0 ? new RegExp("^" + s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$") : null;
          var hits = srcFiles.filter(function (e) { return s === "." || s === "" || e[0] === s || e[0].indexOf(s + "/") === 0 || (re && re.test(e[0])); });
          if (!hits.length) { miss = miss || s; return; }
          hits.forEach(function (e) {
            var isDirSrc = s === "." || s === "" || (e[0] !== s && !re), rel = isDirSrc ? (s === "." || s === "" ? e[0] : e[0].slice(s.length + 1)) : U.basename(e[0]);
            var target = isDirSrc || destDir ? U.norm(rel, U.norm(dest, wd)) : U.norm(dest, wd);
            copied.push([target, e[1]]);
          });
        });
        if (miss) {
          body += line(" => ERROR " + head, 0);
          emit(" ERROR");
          throw derr("------\n > " + head + ":\n------\n" + snippet(x, "failed to compute cache key: failed to calculate checksum of ref " + S.hex(stepKey, 8) + "-" + S.hex(stepKey + "x", 4) + "::" + S.hex(stepKey + "y", 25) + ": \"/" + miss + "\": not found"), 1);
        }
        copied.forEach(function (e) { cur.files[e[0]] = e[1]; });
        var cb = copied.reduce(function (n, e) { return n + e[1].length; }, 0);
        cur.size += cb; stepKey += "#" + U.hash(JSON.stringify(copied));
        cur.history.unshift({ by: x.ins + " " + x.args + " # buildkit", size: cb });
      } else if (x.ins === "RUN") {
        var rf = execForm(argText), scriptText = rf.exec ? rf.argv.join(" ") : argText;
        cachedOk = !f["no-cache"] && sim.docker.cache[stepKey];
        var snap = cachedOk ? null : Object.assign({}, cur.files), res = runStep(cur, scriptText);
        secs = cachedOk ? 0 : /npm (install|ci|i)\b|apt-get install|pip install/.test(scriptText) ? 2.4 : /npm run build/.test(scriptText) ? 1.6 : /apk add|apt-get update/.test(scriptText) ? 1.1 : 0.3;
        if (!res.ok) {
          await sim.wait(Math.round(secs * 500));
          body += line(" => ERROR " + head, secs / 2);
          emit(" ERROR");
          throw derr("------\n > " + head + ":\n" + res.log.map(function (l, n) { return (0.2 + n * 0.004).toFixed(3) + " " + l; }).join("\n") + (res.log.length ? "\n" : "") + "------\n" + snippet(x, "process \"/bin/sh -c " + scriptText + "\" did not complete successfully: exit code: " + res.exit), 1);
        }
        cur.size += res.bytes;
        cur.history.unshift({ by: "RUN /bin/sh -c " + scriptText + " # buildkit", size: res.bytes });
      }
      if (cachedOk === undefined) cachedOk = !f["no-cache"] && sim.docker.cache[stepKey];
      if (!cachedOk && secs) await sim.wait(Math.round(secs * 1000));
      sim.docker.cache[stepKey] = true;
      cur.key = stepKey; done++;
      body += line(" => " + (cachedOk ? "CACHED " : "") + head, cachedOk ? 0 : secs);
    }
    if (snippetFail) { emit(" ERROR"); throw derr(snippetFail, 1); }

    var final = f.target ? stages.filter(function (s) { return s.name === f.target; })[0] : stages[stages.length - 1];
    if (!final) { emit(" ERROR"); throw solveFail("target stage \"" + f.target + "\" could not be found"); }
    var id = "sha256:" + S.hex("image:" + final.key + JSON.stringify(final.config), 64);
    var img = { id: id, repoTags: [], size: final.size, created: sim.now, app: final.app, appName: final.appName, version: tags[0] ? tags[0].tag : final.version, os: final.os, tools: final.tools, private: false,
      config: final.config, files: final.files, history: final.history, aptUpdated: final.aptUpdated, built: true };
    if (final.shellCmd && img.config.Cmd && !img.config.Entrypoint) img.shellForm = true;
    steps++; done++;
    body += line(" => exporting to image", 0.1) + line(" => => exporting layers", 0.1) + line(" => => writing image " + id, 0);
    await sim.wait(200);
    var stored = D.addImage(sim, img, tags[0] ? tags[0].short : null);
    tags.forEach(function (t) { D.addImage(sim, stored, t.short); body += line(" => => naming to " + t.full, 0); });
    emit(" FINISHED");
    if (f.q || f.quiet) io.out(id + "\n");
    if (!tags.length) io.err("\nWARNING: No output tag was given, so the image has no name. Use -t name:tag (see `docker images`: it is listed as <none>).\n");
    return 0;
  };

  /* ---------- docker compose ---------- */
  var COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
  function loadProject(sim, sc, f) {
    var path = null, name;
    if (f.file) { path = U.norm(f.file, sc.cwd); if (!sim.fs.isFile(path)) throw derr("open " + path + ": no such file or directory", 1); }
    else COMPOSE_FILES.forEach(function (n) { if (!path && sim.fs.isFile(U.norm(n, sc.cwd))) path = U.norm(n, sc.cwd); });
    if (!path) throw derr("no configuration file provided: not found", 1);
    var doc;
    try { doc = S.YAML.load(sim.fs.read(path)); } catch (e) { throw derr("yaml: " + (e.mark ? "line " + (e.mark.line + 1) + ": " : "") + (e.reason || e.message), 1); }
    var fileName = U.basename(path);
    if (!doc || typeof doc !== "object") throw derr("validating " + path + ": empty compose file", 1);
    Object.keys(doc).forEach(function (k) { if (["services", "volumes", "networks", "name", "version", "configs", "secrets"].indexOf(k) < 0 && k.indexOf("x-") !== 0) throw derr("validating " + path + ": (root) Additional property " + k + " is not allowed", 1); });
    if (!doc.services || typeof doc.services !== "object") throw derr("validating " + path + ": services must be a mapping", 1);
    name = (f["project-name"] || doc.name || U.basename(U.dirname(path))).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    var services = {}, vols = doc.volumes || {};
    var ALLOWED = ["image", "build", "ports", "environment", "env_file", "volumes", "depends_on", "command", "entrypoint", "restart", "networks", "container_name", "healthcheck", "expose", "labels", "working_dir", "user", "hostname", "deploy", "mem_limit", "profiles", "pull_policy", "stop_grace_period", "tty", "stdin_open", "init"];
    Object.keys(doc.services).forEach(function (sn) {
      var s = doc.services[sn] || {};
      Object.keys(s).forEach(function (k) { if (ALLOWED.indexOf(k) < 0) throw derr("validating " + path + ": services." + sn + " Additional property " + k + " is not allowed", 1); });
      if (!s.image && !s.build) throw derr("service \"" + sn + "\" has neither an image nor a build context specified: invalid compose project", 1);
      var env = {};
      if (Array.isArray(s.environment)) s.environment.forEach(function (e) { var i = String(e).indexOf("="); if (i > 0) env[e.slice(0, i)] = e.slice(i + 1); else if (sc.env[e] != null) env[e] = sc.env[e]; });
      else Object.keys(s.environment || {}).forEach(function (k) { env[k] = s.environment[k] == null ? "" : String(s.environment[k]); });
      var deps = Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on || {});
      deps.forEach(function (d) { if (!doc.services[d]) throw derr("service \"" + sn + "\" depends on undefined service \"" + d + "\": invalid compose project", 1); });
      var mounts = (s.volumes || []).map(function (v) {
        if (typeof v === "object") v = (v.source || "") + ":" + v.target + (v.read_only ? ":ro" : "");
        var p = String(v).split(":");
        if (p.length > 1 && !/^[./~]/.test(p[0])) { if (!Object.prototype.hasOwnProperty.call(vols, p[0])) throw derr("service \"" + sn + "\" refers to undefined volume " + p[0] + ": invalid compose project", 1); return { type: "volume", source: name + "_" + p[0], target: p[1], ro: p[2] === "ro", key: p[0] }; }
        return D.parse.mounts(sim, sc, [String(v)], U.dirname(path))[0];
      });
      var ports;
      try { ports = D.parse.ports((s.ports || []).map(String)); } catch (e) { throw derr("validating " + path + ": services." + sn + ".ports invalid port mapping", 1); }
      var cmd = s.command == null ? [] : Array.isArray(s.command) ? s.command.map(String) : S.tokenize(String(s.command), {}).map(function (t) { return t.v; });
      var build = s.build ? (typeof s.build === "string" ? { context: s.build } : s.build) : null;
      services[sn] = { name: sn, image: s.image || name + "-" + sn, build: build, env: env, ports: ports, mounts: mounts, deps: deps, cmd: cmd, restart: s.restart, container: s.container_name || name + "-" + sn + "-1", user: s.user, workdir: s.working_dir,
        entrypoint: s.entrypoint == null ? undefined : Array.isArray(s.entrypoint) ? s.entrypoint : [String(s.entrypoint)] };
    });
    // start order: dependencies first; reject cycles
    var order = [], seen = {};
    (function visit(list, trail) { list.forEach(function (sn) { if (seen[sn] === 2) return; if (seen[sn] === 1) throw derr("dependency cycle detected: " + trail.concat(sn).join(" -> "), 1); seen[sn] = 1; visit(services[sn].deps, trail.concat(sn)); seen[sn] = 2; order.push(sn); }); })(Object.keys(services), []);
    return { name: name, dir: U.dirname(path), file: fileName, services: services, order: order, volumes: Object.keys(vols) };
  }
  function projectContainers(sim, proj, svc) {
    return sim.docker.containers.filter(function (c) { return c.labels["com.docker.compose.project"] === proj.name && (!svc || !svc.length || svc.indexOf(c.labels["com.docker.compose.service"]) >= 0); });
  }
  function running(lines, out) {
    var w = Math.max.apply(null, lines.map(function (l) { return l[0].length; }).concat([0]));
    out("[+] Running " + lines.length + "/" + lines.length + "\n" + lines.map(function (l, i) { return " ✔ " + l[0].padEnd(w) + "  " + l[1].padEnd(28) + (0.1 + i * 0.1).toFixed(1) + "s"; }).join("\n") + "\n");
  }

  var compose = {};
  compose.up = async function (a, io, sim, sc, f0) {
    var f = U.flags(a, { bool: "d detach build force-recreate no-build remove-orphans wait no-deps quiet-pull", str: "scale" }), proj = loadProject(sim, sc, f0), d = sim.docker, lines = [];
    var wanted = f._.length ? [] : proj.order;
    if (f._.length) (function add(list) { list.forEach(function (sn) { if (!proj.services[sn]) throw derr("no such service: " + sn, 1); if (!f["no-deps"]) add(proj.services[sn].deps); if (wanted.indexOf(sn) < 0) wanted.push(sn); }); })(f._);
    // images
    for (var i = 0; i < wanted.length; i++) {
      var s = proj.services[wanted[i]];
      if (s.build && (f.build || !D.findImage(sim, s.image))) {
        var bargs = ["-t", s.image].concat(s.build.dockerfile ? ["-f", U.norm(s.build.dockerfile, U.norm(s.build.context || ".", proj.dir))] : [], [U.norm(s.build.context || ".", proj.dir)]);
        var code = await sim.execArgv(["docker", "build"].concat(bargs), io, sc);
        if (code) return code;
      } else if (!D.findImage(sim, s.image)) {
        io.err("[+] Pulling " + s.name + "\n");
        try { await D.pull(sim, s.image, io, true); io.err(" ✔ " + s.name + " Pulled\n"); }
        catch (e) { if (!(e instanceof CmdError) || e.code === 130) throw e; io.err(" ✘ " + s.name + " Error " + e.message.replace("Error response from daemon: ", "") + "\n"); throw derr(e.message, 1); }
      }
    }
    var netName = proj.name + "_default";
    if (!d.networks[netName]) { D.createNetwork(sim, netName, { "com.docker.compose.project": proj.name, "com.docker.compose.network": "default" }); lines.push(["Network " + netName, "Created"]); }
    wanted.forEach(function (sn) { proj.services[sn].mounts.forEach(function (m) { if (m.type === "volume" && !d.volumes[m.source]) { D.volume(sim, m.source, { "com.docker.compose.project": proj.name, "com.docker.compose.volume": m.key }); lines.push(["Volume \"" + m.source + "\"", "Created"]); } }); });
    var failed = null;
    for (var k = 0; k < wanted.length && !failed; k++) {
      var svc = proj.services[wanted[k]], hash = String(U.hash(JSON.stringify([svc.image, svc.env, svc.ports, svc.mounts, svc.cmd, svc.restart, svc.entrypoint, D.findImage(sim, svc.image).id])));
      var c = d.containers.filter(function (x) { return x.name === svc.container; })[0];
      if (c && c.labels["com.docker.compose.project"] !== proj.name) throw derr("Error response from daemon: Conflict. The container name \"/" + svc.container + "\" is already in use by container \"" + c.id + "\". You have to remove (or rename) that container to be able to reuse that name.", 1);
      if (c && (c.labels["com.docker.compose.config-hash"] !== hash || f["force-recreate"])) { if (c.state === "running") D.stop(sim, c, 137); D.remove(sim, c, false); c = null; lines.push(["Container " + svc.container, "Recreated"]); }
      if (c && c.state === "running") { lines.push(["Container " + svc.container, "Running"]); continue; }
      try {
        if (!c) {
          c = D.create(sim, { image: D.findImage(sim, svc.image), imageRef: svc.image, name: svc.container, cmd: svc.cmd, entrypoint: svc.entrypoint, env: svc.env, ports: U.clone(svc.ports).map(function (p) { if (p.host == null) p.host = 32768 + Math.floor(sim.rand() * 1000); return p; }), mounts: U.clone(svc.mounts), networks: [{ name: netName, aliases: [svc.name] }],
            restart: D.parse.restart(svc.restart === false ? "no" : svc.restart), user: svc.user, workdir: svc.workdir, labels: { "com.docker.compose.project": proj.name, "com.docker.compose.service": svc.name, "com.docker.compose.config-hash": hash, "com.docker.compose.container-number": "1" } });
        }
        D.start(sim, c);
        if (!lines.some(function (l) { return l[0] === "Container " + svc.container; })) lines.push(["Container " + svc.container, "Started"]);
        else lines[lines.length - 1][1] = "Started";
      } catch (e) {
        if (!(e instanceof CmdError)) throw e;
        lines.push(["Container " + svc.container, "Error"]); failed = e.message.replace(/^docker: /, "");
      }
      await sim.wait(300);
    }
    if (failed) { io.err("[+] Running " + (lines.length - 1) + "/" + lines.length + "\n" + lines.map(function (l) { return " " + (l[1] === "Error" ? "✘" : "✔") + " " + l[0] + "  " + l[1]; }).join("\n") + "\n"); throw derr(failed.replace("Error response from daemon: ", "Error response from daemon: "), 1); }
    running(lines, io.err);
    if (!f.d && !f.detach) {
      io.err("(sandbox) `docker compose up` without -d would hold the terminal and stream logs. The stack keeps running in the background; use `docker compose logs`.\n");
    }
    return 0;
  };
  compose.down = async function (a, io, sim, sc, f0) {
    var f = U.flags(a, { bool: "v volumes remove-orphans", str: "rmi t timeout" }), proj = loadProject(sim, sc, f0), d = sim.docker, lines = [];
    projectContainers(sim, proj).reverse().forEach(function (c) { if (c.state === "running") D.stop(sim, c, D.graceCode(c)); D.remove(sim, c, true); lines.push(["Container " + c.name, "Removed"]); });
    if (f.v || f.volumes) Object.keys(d.volumes).forEach(function (k) { if (d.volumes[k].labels["com.docker.compose.project"] === proj.name) { delete d.volumes[k]; lines.push(["Volume " + k, "Removed"]); } });
    if (d.networks[proj.name + "_default"]) { delete d.networks[proj.name + "_default"]; lines.push(["Network " + proj.name + "_default", "Removed"]); }
    await sim.wait(500);
    if (lines.length) running(lines, io.err);
  };
  compose.ps = function (a, io, sim, sc, f0) {
    var f = U.flags(a, { bool: "a all q quiet services", str: "format status" }), proj = loadProject(sim, sc, f0);
    var list = projectContainers(sim, proj, f._).filter(function (c) { return f.a || f.all || c.state === "running" || c.state === "restarting"; });
    if (f.services) { io.out(proj.order.join("\n") + "\n"); return; }
    if (f.q || f.quiet) { if (list.length) io.out(list.map(function (c) { return c.id.slice(0, 12); }).join("\n") + "\n"); return; }
    io.out(U.table([["NAME", "IMAGE", "COMMAND", "SERVICE", "CREATED", "STATUS", "PORTS"]].concat(list.map(function (c) {
      var cl = (c.entrypoint || []).concat(c.cmd).join(" ");
      return [c.name, c.imageRef, "\"" + (cl.length > 20 ? cl.slice(0, 19) + "…" : cl) + "\"", c.labels["com.docker.compose.service"], U.human(sim.now - c.created) + " ago", D.status(sim, c), D.portsText(c)];
    }))) + "\n");
  };
  compose.logs = function (a, io, sim, sc, f0) {
    var f = U.flags(a, { bool: "f follow t timestamps no-color no-log-prefix", str: "n tail since", alias: { n: "tail" } }), proj = loadProject(sim, sc, f0), all = [];
    f._.forEach(function (sn) { if (!proj.services[sn]) throw derr("no such service: " + sn, 1); });
    var cs = projectContainers(sim, proj, f._), w = Math.max.apply(null, cs.map(function (c) { return c.name.replace(proj.name + "-", "").length; }).concat([0]));
    cs.forEach(function (c, order) {
      var l = c.proc ? c.proc.logs : [];
      if (f.tail != null && f.tail !== "all") l = +f.tail > 0 ? l.slice(-(+f.tail)) : [];
      l.forEach(function (x, n) { all.push({ t: x.t, o: order, n: n, s: c.name.replace(proj.name + "-", "").padEnd(w) + "  | " + x.s }); });
    });
    all.sort(function (x, y) { return x.t - y.t || x.o - y.o || x.n - y.n; });
    if (all.length) io.out(all.map(function (x) { return x.s; }).join("\n") + "\n");
  };
  function eachService(verb, past, fn) {
    return async function (a, io, sim, sc, f0) {
      var f = U.flags(a, { str: "t timeout", bool: "v volumes f force s stop" }), proj = loadProject(sim, sc, f0), lines = [];
      f._.forEach(function (sn) { if (!proj.services[sn]) throw derr("no such service: " + sn, 1); });
      var cs = projectContainers(sim, proj, f._);
      for (var i = 0; i < cs.length; i++) { try { fn(sim, cs[i]); lines.push(["Container " + cs[i].name, past]); } catch (e) { if (!(e instanceof CmdError)) throw e; lines.push(["Container " + cs[i].name, "Error"]); io.err(e.message + "\n"); } }
      await sim.wait(300);
      if (lines.length) running(lines, io.err);
    };
  }
  compose.stop = eachService("stop", "Stopped", function (sim, c) { D.stop(sim, c, D.graceCode(c)); });
  compose.start = eachService("start", "Started", function (sim, c) { D.start(sim, c); });
  compose.restart = eachService("restart", "Started", function (sim, c) { if (c.state === "running") D.stop(sim, c, D.graceCode(c)); D.start(sim, c); });
  compose.rm = eachService("rm", "Removed", function (sim, c) { if (c.state === "running") throw derr("container " + c.name + " is running: stop it first"); D.remove(sim, c, true); });
  compose.exec = function (a, io, sim, sc, f0) {
    var f = U.flags(a, { bool: "T d i t", str: "u w user workdir", multi: "e env", stop: true }), proj = loadProject(sim, sc, f0);
    if (!proj.services[f._[0]]) throw derr("no such service: " + f._[0], 1);
    var c = projectContainers(sim, proj, [f._[0]])[0];
    if (!c || c.state !== "running") throw derr("service \"" + f._[0] + "\" is not running", 1);
    return D.cmds.exec(["-it", c.name].concat(f._.slice(1)), io, sim, sc);
  };
  compose.build = async function (a, io, sim, sc, f0) {
    var f = U.flags(a, { bool: "no-cache pull q" }), proj = loadProject(sim, sc, f0);
    for (var i = 0; i < proj.order.length; i++) {
      var s = proj.services[proj.order[i]];
      if (!s.build || (f._.length && f._.indexOf(s.name) < 0)) continue;
      var code = await sim.execArgv(["docker", "build", "-t", s.image].concat(f["no-cache"] ? ["--no-cache"] : [], [U.norm(s.build.context || ".", proj.dir)]), io, sc);
      if (code) return code;
    }
  };
  compose.config = function (a, io, sim, sc, f0) {
    var f = U.flags(a, { bool: "services q quiet volumes" }), proj = loadProject(sim, sc, f0);
    if (f.services) { io.out(Object.keys(proj.services).join("\n") + "\n"); return; }
    if (f.q || f.quiet) return;
    var doc = { name: proj.name, services: {}, networks: { "default": { name: proj.name + "_default" } } };
    Object.keys(proj.services).sort().forEach(function (sn) {
      var s = proj.services[sn], o = {};
      if (s.cmd.length) o.command = s.cmd;
      if (s.deps.length) o.depends_on = s.deps.reduce(function (m, d) { m[d] = { condition: "service_started", required: true }; return m; }, {});
      if (Object.keys(s.env).length) o.environment = s.env;
      o.image = s.image; o.networks = { "default": null };
      if (s.ports.length) o.ports = s.ports.map(function (p) { return { mode: "ingress", target: p.container, published: String(p.host), protocol: p.proto }; });
      if (s.restart) o.restart = s.restart;
      if (s.mounts.length) o.volumes = s.mounts.map(function (m) { return { type: m.type, source: m.key || m.source, target: m.target }; });
      doc.services[sn] = o;
    });
    if (proj.volumes.length) doc.volumes = proj.volumes.reduce(function (m, v) { m[v] = { name: proj.name + "_" + v }; return m; }, {});
    io.out(S.yamlDump(doc));
  };
  compose.ls = function (a, io, sim) {
    var by = {};
    sim.docker.containers.forEach(function (c) { var p = c.labels["com.docker.compose.project"]; if (p && c.state === "running") by[p] = (by[p] || 0) + 1; });
    io.out(U.table([["NAME", "STATUS", "CONFIG FILES"]].concat(Object.keys(by).map(function (p) { return [p, "running(" + by[p] + ")", "/home/learner/" + p + "/compose.yaml"]; })), 10) + "\n");
  };
  compose.version = function (a, io) { io.out("Docker Compose version v5.6.0\n"); };
  compose.pull = async function (a, io, sim, sc, f0) { var proj = loadProject(sim, sc, f0); for (var i = 0; i < proj.order.length; i++) { var s = proj.services[proj.order[i]]; if (!s.build) { await D.pull(sim, s.image, io, true); io.err(" ✔ " + s.name + " Pulled\n"); } } };

  D.compose = async function (a, io, sim, sc) {
    var f0 = U.flags(a, { str: "f file p project-name project-directory env-file profile", bool: "help version", alias: { f: "file", p: "project-name" }, stop: true });
    var sub = f0._[0];
    if (!sub || f0.help) { io.out("Usage:  docker compose [OPTIONS] COMMAND\n\nDefine and run multi-container applications with Docker\n\nCommands:\n  " + Object.keys(compose).sort().join("\n  ") + "\n"); return 0; }
    if (f0.version) sub = "version";
    if (!compose[sub]) throw derr("unknown docker command: \"compose " + sub + "\"", 16);
    return compose[sub](f0._.slice(1), io, sim, sc, f0);
  };
})(typeof window !== "undefined" ? window : globalThis);
