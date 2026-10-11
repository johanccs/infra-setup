/* infra-sim — simulated Docker Engine and the `docker` CLI (models Docker Engine 29 output). */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, NetError = S.NetError;
  function derr(msg, code) { return new CmdError(msg, code == null ? 1 : code); }
  function daemon(msg, code) { return derr("Error response from daemon: " + msg, code); }

  S.inits.push(function (sim) {
    sim.docker = {
      images: [], containers: [], volumes: {}, cache: {}, pushed: {}, logins: {}, netSeq: 18,
      networks: {
        bridge: { name: "bridge", id: S.hex("net-bridge", 64), driver: "bridge", subnet: "172.17.0.0/16", gateway: "172.17.0.1", next: 2, builtin: true, created: 0, labels: {} },
        host: { name: "host", id: S.hex("net-host", 64), driver: "host", builtin: true, created: 0, labels: {} },
        none: { name: "none", id: S.hex("net-none", 64), driver: "null", builtin: true, created: 0, labels: {} }
      }
    };
  });

  /* ---------- helpers ---------- */
  var D = S.docker = {};
  D.findImage = function (sim, ref) {
    var d = sim.docker, r = S.parseRef(ref), i;
    for (i = 0; i < d.images.length; i++) if (d.images[i].repoTags.indexOf(r.short) >= 0) return d.images[i];
    if (/^[0-9a-f]{3,64}$/.test(ref) || /^sha256:/.test(ref)) {
      var hits = d.images.filter(function (im) { return im.id.replace("sha256:", "").indexOf(ref.replace("sha256:", "")) === 0; });
      if (hits.length) return hits[0];
    }
    return null;
  };
  /* What a registry returns for a reference: catalogue images plus anything pushed in this sandbox. */
  D.registryImage = function (sim, ref) {
    var r = typeof ref === "string" ? S.parseRef(ref) : ref;
    return sim.docker.pushed[r.full] || S.catalogImage(r);
  };
  D.repoKnown = function (sim, r) { return !!S.catalog[r.name] || Object.keys(sim.docker.pushed).some(function (k) { return k.indexOf(r.fullRepo + ":") === 0; }); };
  D.pullError = function (sim, r) {
    if (!D.repoKnown(sim, r)) return "pull access denied for " + r.name + ", repository does not exist or may require 'docker login': denied: requested access to the resource is denied";
    return "manifest for " + r.short + " not found: manifest unknown: manifest unknown";
  };
  D.addImage = function (sim, img, tag) {
    var d = sim.docker, existing = d.images.filter(function (x) { return x.id === img.id; })[0];
    d.images.forEach(function (x) { if (x !== existing) x.repoTags = x.repoTags.filter(function (t) { return t !== tag; }); });
    if (existing) { if (existing.repoTags.indexOf(tag) < 0) existing.repoTags.push(tag); return existing; }
    img.repoTags = tag ? [tag] : [];
    d.images.push(img);
    return img;
  };
  async function pull(sim, ref, io, quiet) {
    var r = S.parseRef(ref);
    if (!r.valid) throw derr("invalid reference format");
    var img = D.registryImage(sim, r);
    if (!img) throw daemon(D.pullError(sim, r));
    if (img.private && !sim.docker.logins[r.registry]) throw daemon("pull access denied for " + r.name + ", repository does not exist or may require 'docker login': denied: requested access to the resource is denied");
    var have = sim.docker.images.filter(function (x) { return x.id === img.id && x.repoTags.indexOf(r.short) >= 0; })[0];
    if (!quiet) {
      if (ref.indexOf(":") < 0 || (ref.lastIndexOf(":") < ref.lastIndexOf("/"))) io.out("Using default tag: latest\n");
      io.out(r.tag + ": Pulling from " + (r.library ? "library/" : "") + r.name + "\n");
    }
    if (!have) {
      var layers = Math.max(1, Math.min(7, Math.round(Math.log10(img.size / 1e5) * 2)));
      await sim.wait(1000 + layers * 300);
      if (!quiet) for (var i = 0; i < layers; i++) io.out(S.hex(r.full + "layer" + i, 12) + ": Pull complete\n");
      D.addImage(sim, U.clone(img), r.short);
    }
    if (!quiet) io.out("Digest: sha256:" + S.hex(r.full + "digest", 64) + "\nStatus: " + (have ? "Image is up to date for " : "Downloaded newer image for ") + r.short + "\n" + r.full + "\n");
    return D.findImage(sim, ref);
  }
  D.pull = pull;

  D.container = function (sim, ref) {
    var cs = sim.docker.containers, hit = cs.filter(function (c) { return c.name === ref || c.name === ref.replace(/^\//, ""); })[0];
    if (hit) return hit;
    if (/^[0-9a-f]{2,64}$/.test(ref)) { var hs = cs.filter(function (c) { return c.id.indexOf(ref) === 0; }); if (hs.length === 1) return hs[0]; }
    throw daemon("No such container: " + ref);
  };
  function shortId(id) { return id.replace("sha256:", "").slice(0, 12); }
  function ago(sim, t) { return U.human(sim.now - t) + " ago"; }
  function cmdline(c) { return (c.entrypoint || []).concat(c.cmd || []); }
  function status(sim, c) {
    if (c.state === "created") return "Created";
    if (c.state === "running") return "Up " + U.human(sim.now - c.proc.startedAt);
    if (c.state === "restarting") return "Restarting (" + c.exitCode + ") " + ago(sim, c.finishedAt);
    return "Exited (" + c.exitCode + ") " + ago(sim, c.finishedAt);
  }
  function portsText(c) {
    var out = [];
    if (c.state !== "running") return "";
    c.ports.forEach(function (p) { out.push("0.0.0.0:" + p.host + "->" + p.container + "/" + p.proto, "[::]:" + p.host + "->" + p.container + "/" + p.proto); });
    (c.image.config.ExposedPorts || []).forEach(function (e) { if (!c.ports.some(function (p) { return p.container + "/" + p.proto === e; })) out.push(e); });
    return out.join(", ");
  }
  D.portsText = portsText; D.status = status;
  function nextIp(net) { var base = net.subnet.split(".").slice(0, 2).join("."); return base + ".0." + (net.next++); }

  function SubFs(fs, base) { this.fs = fs; this.base = base; }
  SubFs.prototype = {
    p: function (rel) { return rel === "/" ? this.base : this.base + rel; },
    read: function (r) { return this.fs.read(this.p(r)); }, write: function (r, c) { this.fs.write(this.p(r), c); },
    isFile: function (r) { return this.fs.isFile(this.p(r)); }, isDir: function (r) { return this.fs.isDir(this.p(r)); }, exists: function (r) { return this.fs.exists(this.p(r)); },
    mkdirp: function (r) { this.fs.mkdirp(this.p(r)); }, list: function (r) { return this.fs.list(this.p(r)); }, rm: function (r) { this.fs.rm(this.p(r)); },
    walk: function (r) { return this.fs.walk(this.p(r)); }
  };
  S.SubFs = SubFs;

  D.volume = function (sim, name, labels, anonymous) {
    var d = sim.docker;
    if (!d.volumes[name]) d.volumes[name] = { name: name, driver: "local", store: new S.MemFs(), created: sim.now, labels: labels || {}, anonymous: !!anonymous };
    return d.volumes[name];
  };

  /* Create a container (not started). o: { image, imageRef, name, cmd, entrypoint, env, ports, mounts, networks:[{name, aliases}], restart, autoRemove, tty, memory, labels, workdir, user, hostname } */
  D.create = function (sim, o) {
    var d = sim.docker, id = sim.id(64);
    var name = o.name || (["brave", "eager", "quirky", "gentle", "clever", "sleepy", "bold"][Math.floor(sim.rand() * 7)] + "_" + ["hopper", "turing", "lovelace", "ritchie", "knuth", "curie", "hamilton"][Math.floor(sim.rand() * 7)]);
    if (o.name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(o.name)) throw daemon("Invalid container name (" + o.name + "), only [a-zA-Z0-9][a-zA-Z0-9_.-] are allowed", 125);
    var clash = d.containers.filter(function (c) { return c.name === name; })[0];
    if (clash) throw daemon("Conflict. The container name \"/" + name + "\" is already in use by container \"" + clash.id + "\". You have to remove (or rename) that container to be able to reuse that name.", 125);
    var nets = {};
    (o.networks && o.networks.length ? o.networks : [{ name: "bridge" }]).forEach(function (n) {
      var net = d.networks[n.name] || Object.keys(d.networks).map(function (k) { return d.networks[k]; }).filter(function (x) { return x.id.indexOf(n.name) === 0; })[0];
      if (!net) throw daemon("network " + n.name + " not found", 125);
      nets[net.name] = { ip: null, aliases: (n.aliases || []).slice() };
    });
    var cfg = o.image.config;
    var c = {
      id: id, name: name, image: o.image, imageRef: o.imageRef, created: sim.now, state: "created",
      entrypoint: o.entrypoint !== undefined ? o.entrypoint : (cfg.Entrypoint || null), cmd: o.cmd && o.cmd.length ? o.cmd : (o.entrypoint !== undefined ? [] : (cfg.Cmd || [])),
      env: Object.assign({}, cfg.Env, o.env || {}), ports: o.ports || [], mounts: o.mounts || [], networks: nets,
      restart: o.restart || { name: "no", max: 0 }, restartCount: 0, autoRemove: !!o.autoRemove, tty: !!o.tty, memory: o.memory || 0,
      labels: o.labels || {}, workdir: o.workdir || cfg.WorkingDir || "/", user: o.user || cfg.User || "", hostname: o.hostname || id.slice(0, 12),
      exitCode: 0, finishedAt: null, proc: null, manualStop: false, error: ""
    };
    (cfg.Volumes || []).forEach(function (path) {
      if (!c.mounts.some(function (m) { return m.target === path; })) { var v = D.volume(sim, sim.id(64), {}, true); c.mounts.push({ type: "volume", source: v.name, target: path, anonymous: true }); }
    });
    d.containers.push(c);
    return c;
  };
  D.mountsFor = function (sim, c) {
    return c.mounts.map(function (m) {
      if (m.type === "volume") return { path: m.target, store: D.volume(sim, m.source).store, readOnly: !!m.ro };
      if (!sim.fs.exists(m.source)) sim.fs.mkdirp(m.source);
      return { path: m.target, store: new SubFs(sim.fs, m.source), readOnly: !!m.ro };
    });
  };
  D.start = function (sim, c) {
    var d = sim.docker;
    if (c.state === "running") return;
    c.ports.forEach(function (p) {
      var other = d.containers.filter(function (x) { return x !== c && x.state === "running" && x.ports.some(function (q) { return q.host === p.host; }); })[0];
      if (other) throw daemon("failed to set up container networking: driver failed programming external connectivity on endpoint " + c.name + " (" + sim.id(64) + "): Bind for 0.0.0.0:" + p.host + " failed: port is already allocated", 125);
      if (sim.k8s && sim.k8s.forwards.some(function (f) { return f.local === p.host; })) throw daemon("failed to set up container networking: driver failed programming external connectivity on endpoint " + c.name + ": failed to bind host port for 0.0.0.0:" + p.host + ": address already in use", 125);
    });
    Object.keys(c.networks).forEach(function (n) { var net = d.networks[n]; if (net && net.subnet && !c.networks[n].ip) c.networks[n].ip = nextIp(net); });
    var firstNet = Object.keys(c.networks)[0], ip = c.networks[firstNet] && c.networks[firstNet].ip;
    if (!c.proc) {
      c.proc = S.proc.create(sim, { image: c.image, argv: cmdline(c), env: Object.assign({ HOSTNAME: c.hostname }, c.env), mounts: D.mountsFor(sim, c), origin: { type: "container", id: c.id, ip: ip }, hostname: c.hostname, ip: ip, tty: c.tty, workdir: c.workdir, memLimitMi: c.memory ? c.memory / 1048576 : 0, user: c.user });
    }
    c.proc.ip = ip; c.proc.origin.ip = ip;
    var err = S.proc.start(sim, c.proc);
    if (err) {
      c.error = err; c.exitCode = /not found/.test(err) ? 127 : 126; c.finishedAt = sim.now;
      throw daemon("failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: " + err + ": unknown", c.exitCode);
    }
    c.state = "running"; c.manualStop = false; c.error = "";
    sync(sim, c);
  };
  function sync(sim, c) {   // fold the process state back into the container
    if (c.state !== "running" || !c.proc) return;
    if (S.proc.poll(sim, c.proc)) return;
    c.state = "exited"; c.exitCode = c.proc.exitCode; c.finishedAt = c.proc.finishedAt;
    if (c.autoRemove) D.remove(sim, c, true);
  }
  D.stop = function (sim, c, code) {
    if (c.state !== "running") { c.manualStop = true; if (c.state === "restarting") c.state = "exited"; return; }
    S.proc.kill(sim, c.proc, code);
    c.manualStop = true; c.state = "exited"; c.exitCode = c.proc.exitCode; c.finishedAt = sim.now;
    if (c.autoRemove) D.remove(sim, c, true);
  };
  D.remove = function (sim, c, withVolumes) {
    var d = sim.docker;
    d.containers = d.containers.filter(function (x) { return x !== c; });
    if (withVolumes) c.mounts.forEach(function (m) { if (m.anonymous) delete d.volumes[m.source]; });
    sim.scopes = sim.scopes.filter(function (s) { return !(s.type === "proc" && s.proc === c.proc); });
  };
  D.graceCode = function (c) { return ["nginx", "redis", "postgres", "hello"].indexOf(c.image.app) >= 0 ? 0 : 137; };

  S.tickers.push(function (sim) {
    sim.docker.containers.slice().forEach(function (c) {
      sync(sim, c);
      if (c.state === "exited" && !c.manualStop && c.finishedAt != null) {
        var pol = c.restart.name;
        var want = pol === "always" || pol === "unless-stopped" || (pol === "on-failure" && c.exitCode !== 0 && (!c.restart.max || c.restartCount < c.restart.max));
        if (want) c.state = "restarting";
      }
      if (c.state === "restarting") {
        var delay = Math.min(60, Math.pow(2, Math.min(c.restartCount, 6))) * 1000;
        if (sim.now - c.finishedAt >= delay) {
          c.restartCount++;
          try { c.state = "exited"; D.start(sim, c); } catch (e) { if (!(e instanceof CmdError)) throw e; c.state = "restarting"; c.finishedAt = sim.now; }
        }
      }
    });
  });

  /* ---------- networking ---------- */
  S.resolvers.push(function (sim, from, host, port) {
    var d = sim.docker, cs = d.containers.filter(function (c) { return c.state === "running"; }), i, n;
    if (from.type === "host") {
      if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
        for (i = 0; i < cs.length; i++) for (n = 0; n < cs[i].ports.length; n++) if (cs[i].ports[n].host === port) {
          // the port is published, so the host accepts the connection; if nothing listens inside, it is reset
          if (cs[i].proc.listen.indexOf(cs[i].ports[n].container) < 0) return { error: "reset", ip: "127.0.0.1" };
          return { proc: cs[i].proc, port: cs[i].ports[n].container, ip: "127.0.0.1" };
        }
        return null;
      }
      for (i = 0; i < cs.length; i++) for (n in cs[i].networks) if (cs[i].networks[n].ip === host) return { proc: cs[i].proc, port: port, ip: host };
      return null;
    }
    if (from.type !== "container") return null;
    var me = d.containers.filter(function (c) { return c.id === from.id; })[0];
    if (!me) return null;
    if (host === "localhost" || host === "127.0.0.1" || host === me.hostname) return { proc: me.proc, port: port, ip: "127.0.0.1" };
    var all = d.containers;
    for (n in me.networks) {
      var net = d.networks[n];
      if (!net || !net.subnet) continue;
      for (i = 0; i < all.length; i++) {
        var c = all[i], link = c.networks[n];
        if (!link || c === me) continue;
        var byName = !net.builtin && (c.name === host || link.aliases.indexOf(host) >= 0 || c.hostname === host || c.id.slice(0, 12) === host);
        if (byName || (link.ip && link.ip === host)) {
          if (c.state !== "running") { if (byName) continue; return { error: "timeout", ip: host }; }
          return { proc: c.proc, port: port, ip: link.ip, fqdn: host };
        }
      }
      if (host === net.gateway) return { error: "refused", ip: host };
    }
    return null;
  });

  /* ---------- CLI ---------- */
  var cmds = {};
  var RUN_SPEC = { bool: "d detach i interactive t tty rm init privileged read-only q quiet P publish-all", str: "name network net restart w workdir u user h hostname m memory entrypoint cpus pull platform network-alias health-cmd health-interval add-host stop-timeout ip env-file",
    multi: "p publish e env v volume l label mount", alias: { d: "detach", i: "interactive", t: "tty", p: "publish", e: "env", v: "volume", l: "label", w: "workdir", u: "user", h: "hostname", m: "memory", net: "network" }, stop: true,
    unknown: function (x) { return x + "\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nRun 'docker run --help' for more information"; }, code: 125 };
  function parseMem(s) { var m = /^(\d+(?:\.\d+)?)([bkmg]?)i?b?$/i.exec(s || ""); if (!m) throw derr("docker: invalid value \"" + s + "\" for flag -m: invalid size: '" + s + "'", 125); return Math.round(parseFloat(m[1]) * { "": 1, b: 1, k: 1024, m: 1048576, g: 1073741824 }[m[2].toLowerCase()]); }
  function parsePorts(list) {
    return (list || []).map(function (s) {
      var m = /^(.*?)(?:\/(tcp|udp))?$/.exec(s), parts = m[1].split(":"), bad = function () { return derr("invalid publish opts format (should be name=value but got '" + s + "')", 125); };
      if (parts.length > 3 || parts.some(function (x, i) { return i >= parts.length - 2 && x !== "" && !/^\d+$/.test(x); })) throw bad();
      var cont = +parts[parts.length - 1], host = parts.length > 1 && parts[parts.length - 2] !== "" ? +parts[parts.length - 2] : null;
      if (!cont) throw bad();
      if ((host != null && (host < 1 || host > 65535)) || cont > 65535) throw derr("invalid " + (cont > 65535 ? "containerPort" : "hostPort") + ": " + (cont > 65535 ? cont : host), 125);
      return { host: host, container: cont, proto: m[2] || "tcp" };
    });
  }
  function parseMounts(sim, sc, list, cwd) {
    return (list || []).map(function (s) {
      var parts = s.split(":"), ro = parts[2] === "ro";
      if (parts.length === 1) return { type: "volume", source: sim.id(64), target: parts[0], anonymous: true };
      if (parts[1][0] !== "/") throw derr("docker: Error response from daemon: invalid volume specification: '" + s + "': invalid mount config for type \"volume\": invalid mount path: '" + parts[1] + "' mount path must be absolute", 125);
      if (/^[./~]/.test(parts[0])) return { type: "bind", source: U.norm(parts[0].replace(/^~/, sc.env.HOME), cwd), target: parts[1], ro: ro };
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(parts[0])) throw derr("docker: Error response from daemon: create " + parts[0] + ": \"" + parts[0] + "\" includes invalid characters for a local volume name, only \"[a-zA-Z0-9][a-zA-Z0-9_.-]\" are allowed. If you intended to pass a host directory, use absolute path", 125);
      return { type: "volume", source: parts[0], target: parts[1], ro: ro };
    });
  }
  function parseEnv(list, sc) {
    var env = {};
    (list || []).forEach(function (e) { var i = e.indexOf("="); if (i < 0) { if (sc && sc.env[e] != null) env[e] = sc.env[e]; } else env[e.slice(0, i)] = e.slice(i + 1); });
    return env;
  }
  function parseRestart(s) {
    if (!s) return { name: "no", max: 0 };
    var m = /^(no|always|unless-stopped|on-failure)(?::(\d+))?$/.exec(s);
    if (!m) throw derr("docker: invalid restart policy: unknown policy '" + s + "'; use one of 'no', 'always', 'on-failure', or 'unless-stopped'", 125);
    return { name: m[1], max: +(m[2] || 0) };
  }
  D.parse = { ports: parsePorts, mounts: parseMounts, env: parseEnv, restart: parseRestart, mem: parseMem };

  async function attach(sim, c, io, fromLine) {   // stream logs until the container stops (or Ctrl+C)
    var seen = fromLine || 0, limit = sim.realtime ? Infinity : 20;
    function flush() { var l = c.proc.logs.slice(seen); seen = c.proc.logs.length; if (l.length) io.out(l.map(function (x) { return x.s; }).join("\n") + "\n"); }
    flush();
    try {
      while (c.state === "running" && limit-- > 0) { await sim.wait(1000); flush(); }
    } catch (e) {
      if (!(e instanceof CmdError) || e.code !== 130) throw e;
      io.out("^C\n");
      return 130;
    }
    flush();
    return c.state === "running" ? 0 : c.exitCode;
  }

  cmds.run = async function (a, io, sim, sc) {
    var f = U.flags(a, RUN_SPEC);
    if (!f._.length) throw derr("docker: 'docker run' requires at least 1 argument\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nSee 'docker run --help' for more information", 1);
    var ref = f._[0], r = S.parseRef(ref);
    if (!r.valid) throw derr("docker: invalid reference format" + (/[A-Z]/.test(ref) ? ": repository name (" + ref.split(":")[0] + ") must be lowercase" : ""), 125);
    var img = D.findImage(sim, ref);
    if (!img) {
      io.err("Unable to find image '" + r.short + "' locally\n");
      try { img = await pull(sim, ref, { out: io.err }, false); }
      catch (e) { if (e instanceof CmdError && /^Error response/.test(e.message)) throw derr("docker: " + e.message + "\n\nRun 'docker run --help' for more information", 125); throw e; }
    }
    var nets = f.network ? [{ name: f.network, aliases: f["network-alias"] ? [f["network-alias"]] : [] }] : null;
    var c;
    try {
      c = D.create(sim, {
        image: img, imageRef: ref, name: f.name, cmd: f._.slice(1), entrypoint: f.entrypoint != null ? (f.entrypoint ? [f.entrypoint] : []) : undefined,
        env: parseEnv(f.env, sc), ports: parsePorts(f.publish).map(function (p) { if (p.host == null) p.host = 32768 + Math.floor(sim.rand() * 1000); return p; }), mounts: parseMounts(sim, sc, f.volume, sc.cwd), networks: nets,
        restart: parseRestart(f.restart), autoRemove: f.rm, tty: f.tty || f.interactive, memory: f.memory ? parseMem(f.memory) : 0, labels: parseEnv(f.label), workdir: f.workdir, user: f.user, hostname: f.hostname
      });
      c.mounts.forEach(function (m) { if (m.type === "volume") D.volume(sim, m.source, {}, m.anonymous); });
      D.start(sim, c);
    } catch (e) {
      if (!(e instanceof CmdError)) throw e;
      if (c && f.rm) D.remove(sim, c, true);
      throw derr("docker: " + e.message + "\n\nRun 'docker run --help' for more information", e.code === 1 ? 125 : e.code);
    }
    if (f.detach) { io.out(c.id + "\n"); return 0; }
    var argv0 = (cmdline(c)[0] || "").replace(/^.*\//, "");
    if ((f.tty || f.interactive) && c.state === "running" && ["sh", "bash", "ash"].indexOf(argv0) >= 0 && cmdline(c).length === 1) {
      var scope = S.proc.scope(sim, c.proc);
      scope.onExit = function (code) { c.proc.exitCode = code; S.proc.finish(sim, c.proc); c.state = "exited"; c.exitCode = code; c.finishedAt = sim.now; c.manualStop = true; if (c.autoRemove) D.remove(sim, c, true); };
      sim.scopes.push(scope);
      return 0;
    }
    var code = await attach(sim, c, io, 0);
    if (code === 130 && c.state === "running") { D.stop(sim, c, D.graceCode(c)); return 130; }
    if (c.state === "running") { io.err("(sandbox) the container is still running in the background as \"" + c.name + "\". Use docker logs / docker stop.\n"); return 0; }
    return code;
  };

  cmds.create = function (a, io, sim, sc) {
    var f = U.flags(a, RUN_SPEC), img = D.findImage(sim, f._[0] || "");
    if (!img) throw daemon("No such image: " + f._[0]);
    var c = D.create(sim, { image: img, imageRef: f._[0], name: f.name, cmd: f._.slice(1), env: parseEnv(f.env, sc), ports: parsePorts(f.publish), mounts: parseMounts(sim, sc, f.volume, sc.cwd), networks: f.network ? [{ name: f.network }] : null, restart: parseRestart(f.restart), autoRemove: f.rm });
    io.out(c.id + "\n");
  };

  cmds.pull = async function (a, io, sim) {
    var f = U.flags(a, { bool: "q quiet a all-tags", str: "platform" });
    if (!f._.length) throw derr("docker: 'docker pull' requires 1 argument\n\nUsage:  docker pull [OPTIONS] NAME[:TAG|@DIGEST]");
    await pull(sim, f._[0], io, f.q || f.quiet);
  };

  function psRows(sim, list, wide) {
    return list.map(function (c) {
      var cl = cmdline(c).join(" "), cmd = "\"" + (cl.length > 20 ? cl.slice(0, 19) + "…" : cl) + "\"";
      return [c.id.slice(0, 12), c.imageRef, cmd, ago(sim, c.created), status(sim, c), portsText(c), c.name];
    });
  }
  cmds.ps = function (a, io, sim) {
    var f = U.flags(a, { bool: "a all q quiet l latest s size no-trunc", str: "format n last", multi: "f filter", alias: { a: "all", q: "quiet", f: "filter" } });
    var list = sim.docker.containers.slice().reverse().filter(function (c) { return f.all || c.state === "running" || c.state === "restarting"; });
    (f.filter || []).forEach(function (flt) {
      var kv = flt.split("="), k = kv[0], v = kv.slice(1).join("=");
      list = list.filter(function (c) {
        if (k === "name") return c.name.indexOf(v) >= 0;
        if (k === "status") return c.state === v;
        if (k === "ancestor") return c.imageRef === v || c.imageRef.split(":")[0] === v;
        if (k === "label") return v.indexOf("=") >= 0 ? c.labels[v.split("=")[0]] === v.split("=")[1] : c.labels[v] != null;
        if (k === "network") return !!c.networks[v];
        if (k === "volume") return c.mounts.some(function (m) { return m.source === v; });
        if (k === "exited") return c.state === "exited" && String(c.exitCode) === v;
        return true;
      });
    });
    if (f.quiet) { if (list.length) io.out(list.map(function (c) { return c.id.slice(0, 12); }).join("\n") + "\n"); return; }
    if (f.format) { var fr = list.map(function (c) { return fmt(f.format, { ID: c.id.slice(0, 12), Names: c.name, Image: c.imageRef, Status: status(sim, c), Ports: portsText(c), State: c.state, Command: "\"" + cmdline(c).join(" ") + "\"", CreatedAt: sim.iso(c.created), RunningFor: ago(sim, c.created) }); });
      if (/^table /.test(f.format)) { var hd = fmt(f.format, {}).head; io.out(U.table([hd].concat(fr.map(function (x) { return x.row; }))) + "\n"); }
      else if (fr.length) io.out(fr.join("\n") + "\n");
      return; }
    io.out(U.table([["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"]].concat(psRows(sim, list))) + "\n");
  };
  function fmt(tpl, data) {
    if (tpl.indexOf("table ") === 0) {
      var cols = tpl.slice(6).split(/\\t|\t/), head = cols.map(function (c) { var m = /\{\{\s*\.(\w+)\s*\}\}/.exec(c); return m ? m[1].replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase() : c; });
      return { table: true, head: head, row: cols.map(function (c) { return render(c, data); }) };
    }
    return render(tpl.replace(/\\t/g, "\t").replace(/\\n/g, "\n"), data);
  }
  function render(tpl, data) {
    try { var e = new S.Template(); e.add("f", tpl); return e.render("f", data); }
    catch (err) { if (err instanceof S.TemplateError) throw derr("template parsing error: template: :" + (err.line || 1) + ": " + err.msg, 64); throw err; }
  }
  D.render = render;

  function eachContainer(a, io, sim, fn) {
    var code = 0;
    a.forEach(function (ref) {
      try { fn(D.container(sim, ref), ref); } catch (e) { if (!(e instanceof CmdError)) throw e; io.err(e.message + "\n"); code = 1; }
    });
    return code;
  }
  cmds.stop = async function (a, io, sim) {
    var f = U.flags(a, { str: "t time s signal", alias: { t: "time" } }), code = 0;
    if (!f._.length) throw derr("docker: 'docker stop' requires at least 1 argument\n\nUsage:  docker stop [OPTIONS] CONTAINER [CONTAINER...]");
    for (var i = 0; i < f._.length; i++) {
      try {
        var c = D.container(sim, f._[i]), gc = D.graceCode(c);
        if (c.state === "running" && gc === 137 && f.time !== "0") await sim.wait(Math.min(10, +(f.time || 10)) * 1000);
        D.stop(sim, c, gc);
        io.out(f._[i] + "\n");
      } catch (e) { if (!(e instanceof CmdError)) throw e; if (e.code === 130) throw e; io.err(e.message + "\n"); code = 1; }
    }
    return code;
  };
  cmds.kill = function (a, io, sim) {
    var f = U.flags(a, { str: "s signal" });
    return eachContainer(f._, io, sim, function (c, ref) { if (c.state !== "running") throw daemon("cannot kill container: " + ref + ": container " + c.id + " is not running"); D.stop(sim, c, 137); io.out(ref + "\n"); });
  };
  cmds.start = async function (a, io, sim) {
    var f = U.flags(a, { bool: "a attach i interactive" });
    if (!f._.length) throw derr("docker: 'docker start' requires at least 1 argument\n\nUsage:  docker start [OPTIONS] CONTAINER [CONTAINER...]");
    var code = eachContainer(f._, io, sim, function (c, ref) {
      try { D.start(sim, c); } catch (e) { if (e instanceof CmdError) throw derr(e.message + "\nError: failed to start containers: " + ref); throw e; }
      if (!f.attach) io.out(ref + "\n");
    });
    if (f.attach && !code) return attach(sim, D.container(sim, f._[0]), io, 0);
    return code;
  };
  cmds.restart = async function (a, io, sim) {
    var f = U.flags(a, { str: "t time" }), code = 0;
    for (var i = 0; i < f._.length; i++) {
      try { var c = D.container(sim, f._[i]); if (c.state === "running") { if (D.graceCode(c) === 137 && f.time !== "0") await sim.wait(10000); D.stop(sim, c, D.graceCode(c)); } D.start(sim, c); io.out(f._[i] + "\n"); }
      catch (e) { if (!(e instanceof CmdError) || e.code === 130) throw e; io.err(e.message + "\n"); code = 1; }
    }
    return code;
  };
  cmds.rm = function (a, io, sim) {
    var f = U.flags(a, { bool: "f force v volumes" });
    if (!f._.length) throw derr("docker: 'docker rm' requires at least 1 argument\n\nUsage:  docker rm [OPTIONS] CONTAINER [CONTAINER...]");
    return eachContainer(f._, io, sim, function (c, ref) {
      if (c.state === "running" || c.state === "restarting") {
        if (!f.f && !f.force) throw daemon("cannot remove container \"/" + c.name + "\": container is " + c.state + ": stop the container before removing or force remove");
        var auto = c.autoRemove; c.autoRemove = false; D.stop(sim, c, 137); c.autoRemove = auto;
      }
      D.remove(sim, c, f.v || f.volumes || c.autoRemove);
      io.out(ref + "\n");
    });
  };
  cmds.rename = function (a, io, sim) {
    var c = D.container(sim, a[0] || "");
    if (!a[1]) throw derr("docker: 'docker rename' requires 2 arguments");
    if (sim.docker.containers.some(function (x) { return x.name === a[1]; })) throw daemon("Conflict. The container name \"/" + a[1] + "\" is already in use");
    c.name = a[1];
  };
  cmds.logs = async function (a, io, sim) {
    var f = U.flags(a, { bool: "f follow t timestamps details", str: "n tail since until", alias: { f: "follow", n: "tail", t: "timestamps" } });
    if (f._.length !== 1) throw derr("docker: 'docker logs' requires 1 argument\n\nUsage:  docker logs [OPTIONS] CONTAINER");
    var c = D.container(sim, f._[0]);
    if (!c.proc) return 0;
    var l = c.proc.logs;
    if (f.tail != null && f.tail !== "all") l = +f.tail > 0 ? l.slice(-(+f.tail)) : [];
    if (l.length) io.out(l.map(function (x) { return (f.timestamps ? sim.date(x.t).toISOString().replace("Z", "000000Z") + " " : "") + x.s; }).join("\n") + "\n");
    if (f.follow && c.state === "running") { var code = await attach(sim, c, io, c.proc.logs.length); return code === 130 ? 130 : 0; }
  };
  cmds.exec = async function (a, io, sim) {
    var f = U.flags(a, { bool: "i interactive t tty d detach privileged", str: "w workdir u user", multi: "e env", alias: { i: "interactive", t: "tty", e: "env", w: "workdir", u: "user" }, stop: true });
    if (f._.length < 2) throw derr("docker: 'docker exec' requires at least 2 arguments\n\nUsage:  docker exec [OPTIONS] CONTAINER COMMAND [ARG...]");
    var c = D.container(sim, f._[0]), argv = f._.slice(1);
    if (c.state !== "running") throw daemon("container " + c.id + " is not running");
    if (!S.proc.has(c.proc, argv[0])) throw derr("OCI runtime exec failed: exec failed: unable to start container process: exec: \"" + argv[0] + "\": executable file not found in $PATH: unknown", 127);
    var scope = S.proc.scope(sim, c.proc, { workdir: f.workdir, user: f.user, env: parseEnv(f.env), dns: Object.keys(c.networks).some(function (n) { return !sim.docker.networks[n].builtin; }) ? "127.0.0.11" : "192.168.65.7" });
    if ((f.tty || f.interactive) && argv.length === 1 && ["sh", "bash", "ash"].indexOf(argv[0].replace(/^.*\//, "")) >= 0) { sim.scopes.push(scope); return 0; }
    return sim.execArgv(argv, io, scope);
  };
  cmds.top = function (a, io, sim) { var c = D.container(sim, a[0] || ""); if (c.state !== "running") throw daemon("container " + c.id + " is not running"); io.out(U.table([["UID", "PID", "PPID", "C", "STIME", "TTY", "TIME", "CMD"], [c.user || "root", 4200 + sim.docker.containers.indexOf(c) * 37, 4180, 0, sim.date(c.proc.startedAt).toISOString().slice(11, 16), "?", "00:00:00", cmdline(c).join(" ")]]) + "\n"); };
  cmds.port = function (a, io, sim) { var c = D.container(sim, a[0] || ""); c.ports.forEach(function (p) { io.out(p.container + "/" + p.proto + " -> 0.0.0.0:" + p.host + "\n" + p.container + "/" + p.proto + " -> [::]:" + p.host + "\n"); }); };
  cmds.cp = function (a, io, sim, sc) {
    if (a.length !== 2) throw derr("docker: 'docker cp' requires 2 arguments\n\nUsage:  docker cp [OPTIONS] CONTAINER:SRC_PATH DEST_PATH|-\n\tdocker cp [OPTIONS] SRC_PATH|- CONTAINER:DEST_PATH");
    function side(s) { var i = s.indexOf(":"); if (i > 0) { var c = D.container(sim, s.slice(0, i)); if (!c.proc) throw daemon("container " + c.name + " has never been started in this sandbox"); return { fs: c.proc.fs, path: U.norm(s.slice(i + 1), "/"), c: c }; } return { fs: sc.fs, path: U.norm(s, sc.cwd) }; }
    var src = side(a[0]), dst = side(a[1]);
    if (!src.fs.exists(src.path)) throw derr(src.c ? "Error response from daemon: Could not find the file " + src.path + " in container " + src.c.name : "lstat " + src.path + ": no such file or directory");
    var files = src.fs.isDir(src.path) ? walk(src.fs, src.path) : [["", src.fs.read(src.path)]];
    var base = dst.fs.isDir(dst.path) ? dst.path + "/" + U.basename(src.path) : dst.path;
    files.forEach(function (e) { dst.fs.write(e[0] ? base + "/" + e[0] : base, e[1]); });
    io.out("Successfully copied " + U.size(files.reduce(function (n, e) { return n + e[1].length; }, 0) + 1536) + " to " + a[1] + "\n");
  };
  function walk(fs, dir) {
    var out = [];
    (function rec(d, rel) { fs.list(d).forEach(function (n) { var p = d === "/" ? "/" + n : d + "/" + n, r = rel ? rel + "/" + n : n; if (fs.isDir(p)) rec(p, r); else out.push([r, fs.read(p)]); }); })(dir, "");
    return out;
  }
  D.walk = walk;

  /* images */
  cmds.images = function (a, io, sim) {
    var f = U.flags(a, { bool: "a all q quiet no-trunc digests tree", str: "format", multi: "f filter" }), d = sim.docker;
    var used = d.containers.map(function (c) { return c.image; }), rows = [], dangling = (f.filter || []).indexOf("dangling=true") >= 0;
    d.images.slice().sort(function (x, y) { return (x.repoTags[0] || "~") < (y.repoTags[0] || "~") ? -1 : 1; }).forEach(function (im) {
      if (!im.repoTags.length && !(f.a || f.all || dangling)) return;      // Docker 29 hides untagged images unless --all
      if (dangling && im.repoTags.length) return;
      (im.repoTags.length ? im.repoTags : ["<untagged>"]).forEach(function (t) {
        var i = t.lastIndexOf(":");
        if (f._[0] && t.slice(0, i) !== f._[0] && t !== f._[0]) return;
        rows.push({ name: t, id: shortId(im.id), disk: U.size(im.size), content: U.size(Math.round(im.size * 0.31)), used: used.indexOf(im) >= 0, im: im });
      });
    });
    if (f.q || f.quiet) { if (rows.length) io.out(rows.map(function (r) { return r.id; }).join("\n") + "\n"); return; }
    if (f.format) { rows.forEach(function (r) { var i = r.name.lastIndexOf(":"); io.out(render(f.format.replace(/\\t/g, "\t"), { Repository: r.name.slice(0, i), Tag: r.name.slice(i + 1), ID: r.id, Size: r.disk, CreatedSince: ago(sim, r.im.created) }) + "\n"); }); return; }
    var w = Math.max.apply(null, rows.map(function (r) { return r.name.length; }).concat([5]));
    var line = function (n, id, disk, content, extra) { return (n.padEnd(w) + "   " + id.padEnd(12) + "   " + disk.padStart(10) + "   " + content.padStart(12) + "   " + extra).replace(/\s+$/, ""); };
    io.out((io.tty === false ? "" : " ".repeat(Math.max(0, w + 22)) + "i Info →   U  In Use\n") + line("IMAGE", "ID", "DISK USAGE", "CONTENT SIZE", "EXTRA") + "\n" + rows.map(function (r) { return line(r.name, r.id, r.disk, r.content, r.used ? "   U" : ""); }).join("\n") + (rows.length ? "\n" : ""));
  };
  cmds.rmi = function (a, io, sim) {
    var f = U.flags(a, { bool: "f force no-prune" }), code = 0, d = sim.docker;
    if (!f._.length) throw derr("docker: 'docker rmi' requires at least 1 argument\n\nUsage:  docker rmi [OPTIONS] IMAGE [IMAGE...]");
    f._.forEach(function (ref) {
      var im = D.findImage(sim, ref);
      if (!im) { io.err("Error response from daemon: No such image: " + (ref.indexOf(":") < 0 && !/^[0-9a-f]{6,}$/.test(ref) ? ref + ":latest" : ref) + "\n"); code = 1; return; }
      var users = d.containers.filter(function (c) { return c.image === im; }), tag = S.parseRef(ref).short, byId = im.repoTags.indexOf(tag) < 0;
      if (users.length && !(f.f || f.force) && (byId || im.repoTags.length <= 1)) {
        var u = users[0];
        io.err("Error response from daemon: conflict: unable to " + (byId ? "delete " + shortId(im.id) + " (must be forced) - image is being used by " + (u.state === "running" ? "running" : "stopped") + " container " + u.id.slice(0, 12) : "remove repository reference \"" + ref + "\" (must force) - container " + u.id.slice(0, 12) + " is using its referenced image " + shortId(im.id)) + "\n");
        code = 1; return;
      }
      if (byId) { im.repoTags.forEach(function (t) { io.out("Untagged: " + t + "\n"); }); im.repoTags = []; }
      else { im.repoTags = im.repoTags.filter(function (t) { return t !== tag; }); io.out("Untagged: " + tag + "\n"); }
      if (!im.repoTags.length && !users.length) { d.images = d.images.filter(function (x) { return x !== im; }); io.out("Deleted: " + im.id + "\n"); }
    });
    return code;
  };
  cmds.tag = function (a, io, sim) {
    if (a.length !== 2) throw derr("docker: 'docker tag' requires 2 arguments\n\nUsage:  docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]");
    var im = D.findImage(sim, a[0]), r = S.parseRef(a[1]);
    if (!im) throw daemon("No such image: " + S.parseRef(a[0]).short);
    if (!r.valid) throw derr("Error parsing reference: \"" + a[1] + "\" is not a valid repository/tag: invalid reference format" + (/[A-Z]/.test(a[1]) ? ": repository name (" + a[1].split(":")[0] + ") must be lowercase" : ""));
    D.addImage(sim, im, r.short);
  };
  cmds.push = async function (a, io, sim) {
    var f = U.flags(a, { bool: "q quiet a all-tags" });
    if (f._.length !== 1) throw derr("docker: 'docker push' requires 1 argument\n\nUsage:  docker push [OPTIONS] NAME[:TAG]");
    var r = S.parseRef(f._[0]), im = D.findImage(sim, f._[0]);
    if (!im) throw derr("An image does not exist locally with the tag: " + r.name);
    if (f._[0].indexOf(":") < 0) io.out("Using default tag: latest\n");
    io.out("The push refers to repository [" + r.fullRepo + "]\n");
    await sim.wait(1000);
    if (r.library || S.catalog[r.name]) {
      io.out(S.hex(im.id + "l0", 12) + ": Preparing\n");
      throw derr(r.library ? "denied: requested access to the resource is denied" : "unauthorized: authentication required");
    }
    for (var i = 0; i < 3; i++) io.out(S.hex(im.id + "l" + i, 12) + ": Pushed\n");
    var copy = U.clone(im); copy.registryRef = r.full; copy.private = false;
    sim.docker.pushed[r.full] = copy;
    io.out(r.tag + ": digest: sha256:" + S.hex(r.full + im.id, 64) + " size: " + (1570 + im.history.length * 211) + "\n");
  };
  cmds.login = function (a, io, sim) {
    var f = U.flags(a, { str: "u username p password", bool: "password-stdin" }), reg = f._[0] || "docker.io";
    if (!f.u && !f.username) throw derr("Error: Cannot perform an interactive login from a non TTY device\n(sandbox) pass the user name and password as flags: docker login " + (f._[0] ? f._[0] + " " : "") + "-u learner -p anything");
    sim.docker.logins[reg] = f.u || f.username;
    io.out((f.p || f.password ? "WARNING! Using --password via the CLI is insecure. Use --password-stdin.\n" : "") + "Login Succeeded\n");
  };
  cmds.logout = function (a, io, sim) { var reg = a[0] || "docker.io"; delete sim.docker.logins[reg]; io.out("Removing login credentials for " + (reg === "docker.io" ? "https://index.docker.io/v1/" : reg) + "\n"); };
  cmds.history = function (a, io, sim) {
    var f = U.flags(a, { bool: "no-trunc H human q quiet" }), im = D.findImage(sim, f._[0] || "");
    if (!im) throw daemon("No such image: " + S.parseRef(f._[0] || "").short);
    io.out(U.table([["IMAGE", "CREATED", "CREATED BY", "SIZE", "COMMENT"]].concat(im.history.map(function (h, i) {
      var by = h.by; if (!f["no-trunc"] && by.length > 45) by = by.slice(0, 44) + "…";
      return [i === 0 ? shortId(im.id) : "<missing>", ago(sim, im.created), by, h.size ? U.size(h.size) : "0B", h.kit === false ? "" : "buildkit.dockerfile.v0"];
    }))) + "\n");
  };
  cmds.search = function (a, io) {
    var q = a.filter(function (x) { return x[0] !== "-"; })[0] || "";
    var rows = Object.keys(S.catalog).filter(function (k) { return k.indexOf(q) >= 0 && !S.catalog[k].private; }).map(function (k) { return [k, k.indexOf("/") < 0 ? "Official build of " + k + "." : "Practice image for this course.", String(100 + U.hash(k) % 9000), k.indexOf("/") < 0 ? "[OK]" : ""]; });
    io.out(U.table([["NAME", "DESCRIPTION", "STARS", "OFFICIAL"]].concat(rows)) + "\n");
  };

  /* inspect */
  function inspectContainer(sim, c) {
    var portMap = {}, bindings = {};
    (c.image.config.ExposedPorts || []).forEach(function (e) { portMap[e] = null; });
    c.ports.forEach(function (p) { var k = p.container + "/" + p.proto; bindings[k] = [{ HostIp: "", HostPort: String(p.host) }]; portMap[k] = c.state === "running" ? [{ HostIp: "0.0.0.0", HostPort: String(p.host) }, { HostIp: "::", HostPort: String(p.host) }] : null; });
    var nets = {};
    Object.keys(c.networks).forEach(function (n) { var net = sim.docker.networks[n], l = c.networks[n]; nets[n] = { Aliases: l.aliases.length ? l.aliases : null, NetworkID: net.id, Gateway: c.state === "running" ? net.gateway || "" : "", IPAddress: c.state === "running" ? l.ip || "" : "", IPPrefixLen: 16, DNSNames: net.builtin ? null : [c.name].concat(l.aliases, [c.id.slice(0, 12)]) }; });
    var cl = cmdline(c), p = c.proc;
    return {
      Id: c.id, Created: sim.date(c.created).toISOString(), Path: cl[0] || "", Args: cl.slice(1),
      State: { Status: c.state, Running: c.state === "running", Paused: false, Restarting: c.state === "restarting", OOMKilled: !!(p && p.oom && c.state !== "running"), Dead: false, Pid: c.state === "running" ? 4200 + sim.docker.containers.indexOf(c) * 37 : 0, ExitCode: c.state === "running" ? 0 : c.exitCode, Error: c.error || "",
        StartedAt: p && p.startedAt != null ? sim.date(p.startedAt).toISOString() : "0001-01-01T00:00:00Z", FinishedAt: c.finishedAt != null && c.state !== "running" ? sim.date(c.finishedAt).toISOString() : "0001-01-01T00:00:00Z" },
      Image: c.image.id, Name: "/" + c.name, RestartCount: c.restartCount, Driver: "overlay2", Platform: "linux",
      HostConfig: { Binds: c.mounts.filter(function (m) { return !m.anonymous; }).map(function (m) { return m.source + ":" + m.target + (m.ro ? ":ro" : ""); }), NetworkMode: Object.keys(c.networks)[0], PortBindings: bindings, RestartPolicy: { Name: c.restart.name, MaximumRetryCount: c.restart.max }, AutoRemove: c.autoRemove, Memory: c.memory },
      Mounts: c.mounts.map(function (m) { return m.type === "volume" ? { Type: "volume", Name: m.source, Source: "/var/lib/docker/volumes/" + m.source + "/_data", Destination: m.target, Driver: "local", Mode: m.ro ? "ro" : "z", RW: !m.ro } : { Type: "bind", Source: m.source, Destination: m.target, Mode: m.ro ? "ro" : "", RW: !m.ro }; }),
      Config: { Hostname: c.hostname, User: c.user, Tty: c.tty, Env: Object.keys(c.env).map(function (k) { return k + "=" + c.env[k]; }), Cmd: c.cmd.length ? c.cmd : null, Image: c.imageRef, WorkingDir: c.workdir === "/" ? "" : c.workdir, Entrypoint: c.entrypoint, Labels: c.labels, ExposedPorts: Object.keys(portMap).reduce(function (o, k) { o[k] = {}; return o; }, {}) },
      NetworkSettings: { Ports: c.state === "running" ? portMap : {}, Networks: nets }
    };
  }
  function inspectImage(sim, im) {
    return { Id: im.id, RepoTags: im.repoTags, RepoDigests: im.repoTags.map(function (t) { return t.split(":")[0] + "@sha256:" + S.hex(t + "digest", 64); }), Created: sim.date(im.created).toISOString(), Architecture: "amd64", Os: "linux", Size: im.size,
      Config: { User: im.config.User, Env: Object.keys(im.config.Env).map(function (k) { return k + "=" + im.config.Env[k]; }), Cmd: im.config.Cmd, Entrypoint: im.config.Entrypoint, WorkingDir: im.config.WorkingDir, ExposedPorts: (im.config.ExposedPorts || []).reduce(function (o, k) { o[k] = {}; return o; }, {}), Labels: im.config.Labels, Volumes: (im.config.Volumes || []).reduce(function (o, k) { o[k] = {}; return o; }, {}) },
      RootFS: { Type: "layers", Layers: im.history.filter(function (h) { return h.size; }).map(function (h, i) { return "sha256:" + S.hex(im.id + "fs" + i, 64); }) } };
  }
  function inspectNetwork(sim, n) {
    var cont = {};
    sim.docker.containers.forEach(function (c) { if (c.networks[n.name] && c.state === "running") cont[c.id] = { Name: c.name, EndpointID: S.hex(c.id + n.name, 64), MacAddress: "", IPv4Address: c.networks[n.name].ip + "/16", IPv6Address: "" }; });
    return { Name: n.name, Id: n.id, Created: sim.date(n.created).toISOString(), Scope: "local", Driver: n.driver, EnableIPv6: false, IPAM: { Driver: "default", Options: {}, Config: n.subnet ? [{ Subnet: n.subnet, Gateway: n.gateway }] : [] }, Internal: false, Attachable: false, Containers: cont, Options: n.name === "bridge" ? { "com.docker.network.bridge.name": "docker0" } : {}, Labels: n.labels };
  }
  function inspectVolume(sim, v) { return { CreatedAt: sim.date(v.created).toISOString().replace(/\.\d+Z/, "Z"), Driver: "local", Labels: Object.keys(v.labels).length ? v.labels : null, Mountpoint: "/var/lib/docker/volumes/" + v.name + "/_data", Name: v.name, Options: null, Scope: "local" }; }
  function inspectOut(io, f, objs) {
    var tpl = f.format || f.f;
    if (tpl) io.out(objs.map(function (o) { return tpl === "json" ? JSON.stringify(o) : render(tpl, o); }).join("\n") + "\n");
    else io.out(JSON.stringify(objs, null, 4) + "\n");
  }
  cmds.inspect = function (a, io, sim) {
    var f = U.flags(a, { str: "f format type", bool: "s size" }), out = [], code = 0;
    if (!f._.length) throw derr("docker: 'docker inspect' requires at least 1 argument\n\nUsage:  docker inspect [OPTIONS] NAME|ID [NAME|ID...]");
    f._.forEach(function (ref) {
      var d = sim.docker, o = null;
      try { if (!f.type || f.type === "container") o = inspectContainer(sim, D.container(sim, ref)); } catch (e) { if (!(e instanceof CmdError)) throw e; }
      if (!o && (!f.type || f.type === "image")) { var im = D.findImage(sim, ref); if (im) o = inspectImage(sim, im); }
      if (!o && (!f.type || f.type === "network") && d.networks[ref]) o = inspectNetwork(sim, d.networks[ref]);
      if (!o && (!f.type || f.type === "volume") && d.volumes[ref]) o = inspectVolume(sim, d.volumes[ref]);
      if (!o) { io.err("Error response from daemon: No such object: " + ref + "\n"); code = 1; } else out.push(o);
    });
    if (out.length || !code) inspectOut(io, f, out); else io.out("[]\n");
    return code;
  };

  /* networks */
  var net = {};
  net.ls = function (a, io, sim) {
    var f = U.flags(a, { bool: "q quiet no-trunc", str: "format", multi: "f filter" }), list = Object.keys(sim.docker.networks).map(function (k) { return sim.docker.networks[k]; });
    if (f.q || f.quiet) { io.out(list.map(function (n) { return n.id.slice(0, 12); }).join("\n") + "\n"); return; }
    io.out(U.table([["NETWORK ID", "NAME", "DRIVER", "SCOPE"]].concat(list.map(function (n) { return [n.id.slice(0, 12), n.name, n.driver, "local"]; }))) + "\n");
  };
  D.createNetwork = function (sim, name, labels) {
    var d = sim.docker;
    if (d.networks[name]) throw daemon("network with name " + name + " already exists");
    var n = d.netSeq++;
    d.networks[name] = { name: name, id: sim.id(64), driver: "bridge", subnet: "172." + n + ".0.0/16", gateway: "172." + n + ".0.1", next: 2, created: sim.now, labels: labels || {} };
    return d.networks[name];
  };
  net.create = function (a, io, sim) {
    var f = U.flags(a, { str: "d driver subnet gateway", bool: "internal attachable", multi: "label o opt" });
    if (f._.length !== 1) throw derr("docker: 'docker network create' requires 1 argument\n\nUsage:  docker network create [OPTIONS] NETWORK");
    if (f.d && f.d !== "bridge" && f.driver !== "bridge") throw daemon("this sandbox only simulates the bridge driver");
    io.out(D.createNetwork(sim, f._[0]).id + "\n");
  };
  net.rm = function (a, io, sim) {
    var code = 0, d = sim.docker;
    a.forEach(function (name) {
      var n = d.networks[name];
      if (!n) { io.err("Error response from daemon: network " + name + " not found\n"); code = 1; return; }
      if (n.builtin) { io.err("Error response from daemon: " + name + " is a pre-defined network and cannot be removed\n"); code = 1; return; }
      if (d.containers.some(function (c) { return c.networks[name]; })) { io.err("Error response from daemon: error while removing network: network " + name + " id " + n.id + " has active endpoints\n"); code = 1; return; }
      delete d.networks[name]; io.out(name + "\n");
    });
    return code;
  };
  net.inspect = function (a, io, sim) {
    var f = U.flags(a, { str: "f format", bool: "v verbose" });
    inspectOut(io, f, f._.map(function (name) { var n = sim.docker.networks[name]; if (!n) throw daemon("network " + name + " not found"); return inspectNetwork(sim, n); }));
  };
  net.connect = function (a, io, sim) {
    var f = U.flags(a, { multi: "alias", str: "ip" });
    if (f._.length !== 2) throw derr("docker: 'docker network connect' requires 2 arguments\n\nUsage:  docker network connect [OPTIONS] NETWORK CONTAINER");
    var n = sim.docker.networks[f._[0]], c = D.container(sim, f._[1]);
    if (!n) throw daemon("network " + f._[0] + " not found");
    if (c.networks[n.name]) throw daemon("endpoint with name " + c.name + " already exists in network " + n.name, 1);
    c.networks[n.name] = { ip: c.state === "running" ? nextIp(n) : null, aliases: f.alias || [] };
  };
  net.disconnect = function (a, io, sim) {
    var f = U.flags(a, { bool: "f force" }), n = sim.docker.networks[f._[0]], c = D.container(sim, f._[1] || "");
    if (!n) throw daemon("network " + f._[0] + " not found");
    if (!c.networks[n.name]) throw daemon("container " + c.id + " is not connected to network " + n.name);
    delete c.networks[n.name];
  };
  net.prune = function (a, io, sim) {
    var d = sim.docker, gone = Object.keys(d.networks).filter(function (k) { return !d.networks[k].builtin && !d.containers.some(function (c) { return c.networks[k]; }); });
    gone.forEach(function (k) { delete d.networks[k]; });
    if (gone.length) io.out("Deleted Networks:\n" + gone.join("\n") + "\n\n");
  };
  net.list = net.ls; net.remove = net.rm;

  /* volumes */
  var vol = {};
  vol.ls = function (a, io, sim) {
    var f = U.flags(a, { bool: "q quiet", str: "format", multi: "f filter" }), list = Object.keys(sim.docker.volumes).map(function (k) { return sim.docker.volumes[k]; });
    if (f.q || f.quiet) { if (list.length) io.out(list.map(function (v) { return v.name; }).join("\n") + "\n"); return; }
    io.out(U.table([["DRIVER", "VOLUME NAME"]].concat(list.map(function (v) { return [v.driver, v.name]; })), 4) + "\n");
  };
  vol.create = function (a, io, sim) {
    var f = U.flags(a, { str: "d driver name", multi: "label o opt" }), name = f._[0] || f.name || sim.id(64);
    D.volume(sim, name, parseEnv(f.label), !f._[0] && !f.name); io.out(name + "\n");
  };
  function volumeUsers(sim, name) { return sim.docker.containers.filter(function (c) { return c.mounts.some(function (m) { return m.type === "volume" && m.source === name; }); }); }
  vol.rm = function (a, io, sim) {
    var f = U.flags(a, { bool: "f force" }), code = 0;
    f._.forEach(function (name) {
      if (!sim.docker.volumes[name]) { if (!f.f) { io.err("Error response from daemon: get " + name + ": no such volume\n"); code = 1; } return; }
      var users = volumeUsers(sim, name);
      if (users.length) { io.err("Error response from daemon: remove " + name + ": volume is in use - [" + users.map(function (c) { return c.id; }).join(", ") + "]\n"); code = 1; return; }
      delete sim.docker.volumes[name]; io.out(name + "\n");
    });
    return code;
  };
  vol.inspect = function (a, io, sim) {
    var f = U.flags(a, { str: "f format" });
    inspectOut(io, f, f._.map(function (name) { var v = sim.docker.volumes[name]; if (!v) throw daemon("get " + name + ": no such volume"); return inspectVolume(sim, v); }));
  };
  vol.prune = function (a, io, sim) {
    var f = U.flags(a, { bool: "f force a all", multi: "filter" }), d = sim.docker;
    var gone = Object.keys(d.volumes).filter(function (k) { return (f.a || f.all || d.volumes[k].anonymous) && !volumeUsers(sim, k).length; });
    gone.forEach(function (k) { delete d.volumes[k]; });
    io.out((gone.length ? "Deleted Volumes:\n" + gone.join("\n") + "\n\n" : "") + "Total reclaimed space: 0B\n");
  };
  vol.list = vol.ls; vol.remove = vol.rm;

  /* system */
  function pruneContainers(sim, io) {
    var gone = sim.docker.containers.filter(function (c) { return c.state === "exited" || c.state === "created"; });
    gone.forEach(function (c) { D.remove(sim, c, true); });
    if (gone.length) io.out("Deleted Containers:\n" + gone.map(function (c) { return c.id; }).join("\n") + "\n\n");
    return gone.length;
  }
  function pruneImages(sim, io, all) {
    var d = sim.docker, used = d.containers.map(function (c) { return c.image; });
    var gone = d.images.filter(function (im) { return used.indexOf(im) < 0 && (all || !im.repoTags.length); }), bytes = 0;
    if (gone.length) io.out("Deleted Images:\n" + gone.map(function (im) { bytes += im.size; return im.repoTags.map(function (t) { return "untagged: " + t + "\n"; }).join("") + "deleted: " + im.id; }).join("\n") + "\n\n");
    d.images = d.images.filter(function (im) { return gone.indexOf(im) < 0; });
    return bytes;
  }
  var system = {
    df: function (a, io, sim) {
      var d = sim.docker, imgs = d.images, used = d.containers.map(function (c) { return c.image; }), size = imgs.reduce(function (n, i) { return n + i.size; }, 0);
      var reclaim = imgs.filter(function (i) { return used.indexOf(i) < 0; }).reduce(function (n, i) { return n + i.size; }, 0), vols = Object.keys(d.volumes);
      io.out(U.table([["TYPE", "TOTAL", "ACTIVE", "SIZE", "RECLAIMABLE"],
        ["Images", imgs.length, imgs.filter(function (i) { return used.indexOf(i) >= 0; }).length, U.size(size), U.size(reclaim) + " (" + (size ? Math.round(100 * reclaim / size) : 0) + "%)"],
        ["Containers", d.containers.length, d.containers.filter(function (c) { return c.state === "running"; }).length, "0B", "0B (0%)"],
        ["Local Volumes", vols.length, vols.filter(function (v) { return volumeUsers(sim, v).length; }).length, "0B", "0B (0%)"],
        ["Build Cache", Object.keys(d.cache).length, 0, "0B", "0B"]], 4) + "\n");
    },
    prune: function (a, io, sim) {
      var f = U.flags(a, { bool: "f force a all volumes" });
      pruneContainers(sim, io); net.prune([], io, sim);
      if (f.volumes) vol.prune(["-f"], { out: function () {} }, sim);
      var bytes = pruneImages(sim, io, f.a || f.all);
      sim.docker.cache = {};
      io.out("Total reclaimed space: " + U.size(bytes) + "\n");
    },
    info: function (a, io, sim) { return cmds.info(a, io, sim); }
  };
  cmds.stats = function (a, io, sim) {
    var f = U.flags(a, { bool: "no-stream a all no-trunc", str: "format" });
    var list = f._.length ? f._.map(function (r) { return D.container(sim, r); }) : sim.docker.containers.filter(function (c) { return c.state === "running"; });
    io.out(U.table([["CONTAINER ID", "NAME", "CPU %", "MEM USAGE / LIMIT", "MEM %", "NET I/O", "BLOCK I/O", "PIDS"]].concat(list.map(function (c) {
      var run = c.state === "running", mem = run ? c.proc.mem * 1.048576 : 0, lim = c.memory ? c.memory / 1048576 : 7836;
      return [c.id.slice(0, 12), c.name, (run ? (c.proc.cpu / 10).toFixed(2) : "0.00") + "%", (run ? mem.toFixed(mem < 10 ? 2 : 1) + "MiB" : "0B") + " / " + (lim >= 1024 ? (lim / 1024).toFixed(3) + "GiB" : lim + "MiB"), (run ? (100 * mem / lim).toFixed(2) : "0.00") + "%", run ? "1.2kB / 0B" : "0B / 0B", "0B / 0B", run ? (c.image.app === "nginx" ? 9 : c.image.app === "postgres" ? 6 : c.image.app === "shell" ? 1 : 11) : 0];
    }))) + "\n");
  };
  cmds.version = function (a, io) {
    io.out("Client: Docker Engine - Community\n Version:           29.9.0\n OS/Arch:           linux/amd64\n Context:           default\n\nServer: Docker Engine - Community\n Engine:\n  Version:          29.9.0\n  OS/Arch:          linux/amd64\n containerd:\n  Version:          v2.2.1\n runc:\n  Version:          1.3.4\n");
  };
  cmds.info = function (a, io, sim) {
    var d = sim.docker, run = d.containers.filter(function (c) { return c.state === "running"; }).length;
    io.out("Client: Docker Engine - Community\n Version:    29.9.0\n Context:    default\n Plugins:\n  buildx: Docker Buildx (Docker Inc.)\n    Version:  v0.33.0\n  compose: Docker Compose (Docker Inc.)\n    Version:  v5.6.0\n\nServer:\n Containers: " + d.containers.length + "\n  Running: " + run + "\n  Paused: 0\n  Stopped: " + (d.containers.length - run) + "\n Images: " + d.images.length + "\n Server Version: 29.9.0\n Storage Driver: overlayfs\n  driver-type: io.containerd.snapshotter.v1\n Cgroup Driver: systemd\n Cgroup Version: 2\n Kernel Version: 6.8.0-sandbox\n Operating System: Ubuntu 24.04 LTS (simulated)\n OSType: linux\n Architecture: x86_64\n CPUs: 4\n Total Memory: 7.653GiB\n Name: sandbox\n Docker Root Dir: /var/lib/docker\n");
  };

  var groups = {
    container: { ls: cmds.ps, list: cmds.ps, ps: cmds.ps, run: cmds.run, stop: cmds.stop, start: cmds.start, restart: cmds.restart, rm: cmds.rm, remove: cmds.rm, logs: cmds.logs, exec: cmds.exec, inspect: function (a, io, sim) { return cmds.inspect(["--type", "container"].concat(a), io, sim); }, kill: cmds.kill, top: cmds.top, stats: cmds.stats, port: cmds.port, cp: cmds.cp, rename: cmds.rename, create: cmds.create,
      prune: function (a, io, sim) { pruneContainers(sim, io); io.out("Total reclaimed space: 0B\n"); } },
    image: { ls: cmds.images, list: cmds.images, rm: cmds.rmi, remove: cmds.rmi, pull: cmds.pull, push: cmds.push, tag: cmds.tag, history: cmds.history, inspect: function (a, io, sim) { return cmds.inspect(["--type", "image"].concat(a), io, sim); },
      prune: function (a, io, sim) { var f = U.flags(a, { bool: "f force a all" }); io.out("Total reclaimed space: " + U.size(pruneImages(sim, io, f.a || f.all)) + "\n"); } },
    network: net, volume: vol, system: system
  };
  D.cmds = cmds; D.groups = groups;

  var USAGE = "Usage:  docker [OPTIONS] COMMAND\n\nA self-sufficient runtime for containers\n\nCommon Commands:\n  run         Create and run a new container from an image\n  exec        Execute a command in a running container\n  ps          List containers\n  build       Build an image from a Dockerfile\n  pull        Download an image from a registry\n  push        Upload an image to a registry\n  images      List images\n  login       Authenticate to a registry\n  logs        Fetch the logs of a container\n  inspect     Return low-level information on Docker objects\n  stop/start/restart/kill/rm   Manage the container lifecycle\n\nManagement Commands:\n  compose     Docker Compose\n  container   Manage containers\n  image       Manage images\n  network     Manage networks\n  system      Manage Docker\n  volume      Manage volumes\n\nOther simulated commands: cp, create, history, info, port, rename, rmi, search, stats, tag, top, version\n";
  S.commands.docker = async function (a, io, sim, sc) {
    if (!a.length || a[0] === "--help" || a[0] === "help" || a[0] === "-h") { io.out(USAGE); return 0; }
    if (a[0] === "--version" || a[0] === "-v") { io.out("Docker version 29.9.0, build a1b2c3d\n"); return 0; }
    var name = a[0], rest = a.slice(1);
    if (groups[name]) {
      var sub = groups[name][rest[0]];
      if (!rest.length || rest[0] === "--help") { io.out("Usage:  docker " + name + " COMMAND\n\nCommands:\n  " + Object.keys(groups[name]).join("\n  ") + "\n"); return 0; }
      if (!sub) throw derr("docker: unknown command: docker " + name + " " + rest[0] + "\n\nRun 'docker " + name + " --help' for more information");
      return sub(rest.slice(1), io, sim, sc);
    }
    if (name === "compose" && D.compose) return D.compose(rest, io, sim, sc);
    if (name === "build" && D.build) return D.build(rest, io, sim, sc);
    if (name === "buildx" && rest[0] === "build" && D.build) return D.build(rest.slice(1), io, sim, sc);
    if (name === "builder" && rest[0] === "prune") { sim.docker.cache = {}; io.out("Total:\t0B\n"); return 0; }
    if (!cmds[name]) throw derr("docker: unknown command: docker " + name + "\n\nRun 'docker --help' for more information");
    return cmds[name](rest, io, sim, sc);
  };
  S.commands["docker-compose"] = function (a, io, sim, sc) { return D.compose(a, io, sim, sc); };
})(typeof window !== "undefined" ? window : globalThis);
