/* infra-sim — image registry, simulated applications and container processes. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, NetError = S.NetError;

  /* ---------- image references ---------- */
  S.parseRef = function (ref) {
    var digest = null, at = ref.indexOf("@");
    if (at >= 0) { digest = ref.slice(at + 1); ref = ref.slice(0, at); }
    var first = ref.split("/")[0], registry = "docker.io", rest = ref;
    if (ref.indexOf("/") >= 0 && (/[.:]/.test(first) || first === "localhost")) { registry = first; rest = ref.slice(first.length + 1); }
    var colon = rest.lastIndexOf(":"), tag = "latest", repo = rest;
    if (colon >= 0 && rest.indexOf("/", colon) < 0) { tag = rest.slice(colon + 1); repo = rest.slice(0, colon); }
    var valid = /^[a-z0-9]+([._-]+[a-z0-9]+)*(\/[a-z0-9]+([._-]+[a-z0-9]+)*)*$/.test(repo) && /^[\w][\w.-]{0,127}$/.test(tag);
    var library = registry === "docker.io" && repo.indexOf("/") < 0;
    var shortRepo = registry === "docker.io" ? repo : registry + "/" + repo;
    return { registry: registry, repo: repo, tag: tag, digest: digest, valid: valid, library: library,
      name: shortRepo, short: shortRepo + ":" + tag, full: registry + "/" + (library ? "library/" : "") + repo + ":" + tag,
      fullRepo: registry + "/" + (library ? "library/" : "") + repo };
  };

  /* ---------- tool sets available inside containers ---------- */
  var CORE = "sh ls cat echo printf env printenv pwd cd mkdir rm cp mv touch head tail grep wc sort uniq cut awk sed sleep date whoami id hostname true false which exit export unset tr tee base64 :".split(" ");
  var BUSY = CORE.concat("ash wget nc nslookup ping".split(" "));
  var DEB = CORE.concat(["bash"]);

  /* ---------- registry catalogue ---------- */
  var NGINX_INDEX = "<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and\nworking. Further configuration is required.</p>\n\n<p><em>Thank you for using nginx.</em></p>\n</body>\n</html>\n";
  var NGINX_CONF = "server {\n    listen       80;\n    server_name  localhost;\n\n    location / {\n        root   /usr/share/nginx/html;\n        index  index.html index.htm;\n    }\n}\n";
  var CAT = S.catalog = {
    "nginx": { tags: ["latest", "1.29", "1.28", "1.29-alpine", "alpine"], mb: 192, alpineMb: 52, app: "nginx", entry: ["/docker-entrypoint.sh"], cmd: ["nginx", "-g", "daemon off;"], ports: ["80/tcp"], tools: DEB.concat(["curl", "nginx"]), stop: "SIGQUIT",
      env: { NGINX_VERSION: "1.29.1" }, files: { "/usr/share/nginx/html/index.html": NGINX_INDEX, "/usr/share/nginx/html/50x.html": "<h1>An error occurred.</h1>\n", "/etc/nginx/conf.d/default.conf": NGINX_CONF, "/etc/nginx/nginx.conf": "user  nginx;\nworker_processes  auto;\n\nevents {\n    worker_connections  1024;\n}\n\nhttp {\n    include /etc/nginx/conf.d/*.conf;\n}\n" } },
    "redis": { tags: ["latest", "8", "7", "7-alpine"], mb: 137, alpineMb: 41, app: "redis", entry: ["docker-entrypoint.sh"], cmd: ["redis-server"], ports: ["6379/tcp"], tools: DEB.concat(["redis-cli", "redis-server"]), workdir: "/data", volumes: ["/data"] },
    "postgres": { tags: ["17", "16", "17-alpine", "16-alpine"], mb: 438, alpineMb: 276, app: "postgres", entry: ["docker-entrypoint.sh"], cmd: ["postgres"], ports: ["5432/tcp"], tools: DEB.concat(["psql", "pg_isready", "postgres"]), volumes: ["/var/lib/postgresql/data"],
      env: { PGDATA: "/var/lib/postgresql/data" } },
    "alpine": { tags: ["latest", "3.22", "3.21"], mb: 8.3, app: "shell", cmd: ["/bin/sh"], tools: BUSY.concat(["apk"]), os: "alpine" },
    "busybox": { tags: ["latest", "1.37", "1.36"], mb: 4.4, app: "shell", cmd: ["sh"], tools: BUSY, os: "busybox" },
    "ubuntu": { tags: ["latest", "24.04", "22.04"], mb: 78, app: "shell", cmd: ["/bin/bash"], tools: DEB.concat(["apt-get", "apt"]), os: "debian", files: { "/etc/os-release": "PRETTY_NAME=\"Ubuntu 24.04.3 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nID=ubuntu\nID_LIKE=debian\n" } },
    "node": { tags: ["24", "22", "24-alpine", "22-alpine"], mb: 1120, alpineMb: 161, app: "node", entry: ["docker-entrypoint.sh"], cmd: ["node"], tools: DEB.concat(["node", "npm", "curl", "wget"]), env: { NODE_VERSION: "24.9.0" } },
    "python": { tags: ["3.13", "3.13-slim"], mb: 1020, slimMb: 121, app: "shell", cmd: ["python3"], tools: DEB.concat(["python", "python3", "pip"]) },
    "hello-world": { tags: ["latest"], mb: 0.0101, app: "hello", cmd: ["/hello"], tools: [] },
    "curlimages/curl": { tags: ["latest", "8.16.0"], mb: 22, app: "shell", entry: ["/entrypoint.sh"], cmd: ["curl"], tools: BUSY.concat(["curl"]), os: "alpine", user: "curl_user" },
    "shop/web": { tags: ["1.0", "1.1", "1.2", "2.0"], mb: 168, app: "shopweb", entry: ["docker-entrypoint.sh"], cmd: ["node", "server.js"], ports: ["8080/tcp"], tools: BUSY.concat(["node"]), os: "alpine", workdir: "/app", user: "node",
      files: { "/app/server.js": "// shop web front end (simulated)\n", "/app/package.json": "{\n  \"name\": \"shop-web\"\n}\n" } },
    "shop/api": { tags: ["1.0", "1.1"], mb: 174, app: "shopapi", entry: ["docker-entrypoint.sh"], cmd: ["node", "server.js"], ports: ["3000/tcp"], tools: BUSY.concat(["node"]), os: "alpine", workdir: "/app", user: "node",
      files: { "/app/server.js": "// shop API (simulated)\n", "/app/package.json": "{\n  \"name\": \"shop-api\"\n}\n" } },
    "registry.shop.example/shop/billing": { tags: ["1.0"], mb: 171, app: "shopweb", entry: ["docker-entrypoint.sh"], cmd: ["node", "server.js"], ports: ["8080/tcp"], tools: BUSY.concat(["node"]), os: "alpine", workdir: "/app", user: "node", private: true, appName: "billing" }
  };
  // Kubernetes system images only ever appear in pod listings; they are never started as real processes.

  var OS_RELEASE = {
    alpine: "NAME=\"Alpine Linux\"\nID=alpine\nVERSION_ID=3.22.1\nPRETTY_NAME=\"Alpine Linux v3.22\"\n",
    debian: "PRETTY_NAME=\"Debian GNU/Linux 13 (trixie)\"\nNAME=\"Debian GNU/Linux\"\nVERSION_ID=\"13\"\nID=debian\n",
    busybox: ""
  };
  function tagOs(def, tag) { return def.os || (/alpine/.test(tag) ? "alpine" : "debian"); }
  /* Build an image object from the catalogue (what a registry would hand out). */
  S.catalogImage = function (ref) {
    var r = typeof ref === "string" ? S.parseRef(ref) : ref, def = CAT[r.name];
    if (!def && /^(registry\.k8s\.io|quay\.io\/argoproj|ghcr\.io\/dexidp|public\.ecr\.aws)\//.test(r.full) || r.full.indexOf("docker.io/library/traefik:v") === 0) def = { tags: [r.tag], mb: 60 + U.hash(r.name) % 70, app: "system", cmd: ["/" + r.repo.split("/").pop()], tools: [] };
    if (!def || def.tags.indexOf(r.tag) < 0) return null;
    var os = tagOs(def, r.tag);
    var mb = /alpine/.test(r.tag) && def.alpineMb ? def.alpineMb : /slim/.test(r.tag) && def.slimMb ? def.slimMb : def.mb;
    var tools = def.tools.slice();
    if (os === "alpine" && def.tools.indexOf("bash") >= 0) tools = tools.filter(function (t) { return t !== "bash" && t !== "curl"; }).concat(["ash", "wget", "nc", "nslookup", "ping", "apk"]);
    var id = "sha256:" + hex(r.full, 64);
    return {
      id: id, repoTags: [r.short], size: Math.round(mb * 1e6), created: -(20 + U.hash(r.full) % 60) * 86400000,
      app: def.app, appName: def.appName || null, version: r.tag, os: os, tools: tools, private: !!def.private, registryRef: r.full,
      config: { Env: Object.assign({ PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" }, def.env || {}), Entrypoint: def.entry ? def.entry.slice() : null, Cmd: def.cmd ? def.cmd.slice() : null,
        WorkingDir: def.workdir || "", ExposedPorts: (def.ports || []).slice(), User: def.user || "", Labels: {}, Volumes: (def.volumes || []).slice(), StopSignal: def.stop || "SIGTERM" },
      files: Object.assign(os === "scratch" || def.app === "hello" ? {} : { "/etc/os-release": OS_RELEASE[os] || OS_RELEASE.debian, "/etc/hostname": "", "/etc/hosts": "127.0.0.1\tlocalhost\n" }, def.files || {}),
      history: [{ by: "CMD " + JSON.stringify(def.cmd || []), size: 0 }, { by: "COPY docker-entrypoint.sh / # buildkit", size: 4620 }, { by: "RUN /bin/sh -c set -eux; ... # buildkit", size: Math.round(mb * 1e6 * 0.6) }, { by: "ADD rootfs.tar.xz / # buildkit", size: Math.round(mb * 1e6 * 0.4) }]
    };
  };
  function hex(str, len) {
    var out = "", a = U.hash(str) || 1;
    while (out.length < len) { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; a = (a + 0x9e3779b9) | 0; var t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); out += ("00000000" + ((t ^ (t >>> 14)) >>> 0).toString(16)).slice(-8); }
    return out.slice(0, len);
  }
  S.hex = hex;

  /* ---------- simulated applications ---------- */
  var apps = S.apps = {};
  function stamp(p) { var d = p.sim.date(); return d.toISOString().slice(0, 10).replace(/-/g, "/") + " " + d.toISOString().slice(11, 19); }
  function netMsg(e, host, port) {
    if (e.kind === "resolve") return "getaddrinfo ENOTFOUND " + host;
    if (e.kind === "timeout") return "connect ETIMEDOUT " + (e.detail || host) + ":" + port;
    if (e.kind === "refused") return "connect ECONNREFUSED " + (e.detail || host) + ":" + port;
    return "socket hang up";
  }

  // Cluster add-ons (CoreDNS, kube-proxy, Argo CD...): they only need to be "running".
  apps.system = { mem: 38, cpu: 5, any: true, start: function (p) { p.log("level=info msg=\"" + p.argv[0].replace(/^\//, "") + " started\""); return {}; } };

  apps.hello = {
    bins: ["/hello"],
    start: function (p) {
      p.log("\nHello from Docker!\nThis message shows that your installation appears to be working correctly.\n\nTo generate this message, Docker took the following steps:\n 1. The Docker client contacted the Docker daemon.\n 2. The Docker daemon pulled the \"hello-world\" image from the Docker Hub.\n    (amd64)\n 3. The Docker daemon created a new container from that image which runs the\n    executable that produces the output you are currently reading.\n 4. The Docker daemon streamed that output to the Docker client, which sent it\n    to your terminal.\n\nTo try something more ambitious, you can run an Ubuntu container with:\n $ docker run -it ubuntu bash\n\nShare images, automate workflows, and more with a free Docker ID:\n https://hub.docker.com/\n\nFor more examples and ideas, visit:\n https://docs.docker.com/get-started/\n");
      return { exit: 0 };
    }
  };

  apps.nginx = {
    mem: 9, cpu: 1,
    bins: ["nginx", "/docker-entrypoint.sh"],
    check: function (p) {
      var path = "/etc/nginx/conf.d/default.conf", conf = p.fs.read(path), st = { port: 80, proxy: null, root: "/usr/share/nginx/html" };
      if (conf == null) return st;
      var depth = 0, ls = conf.split("\n");
      for (var i = 0; i < ls.length; i++) {
        var l = ls[i].replace(/#.*/, "").trim();
        if (!l) continue;
        if (/\{$/.test(l)) depth++;
        else if (l === "}") { depth--; if (depth < 0) return { error: "nginx: [emerg] unexpected \"}\" in " + path + ":" + (i + 1) }; }
        else if (!/;$/.test(l)) return { error: "nginx: [emerg] directive \"" + l.split(/\s+/)[0] + "\" is not terminated by \";\" in " + path + ":" + (i + 1) };
        var m;
        if ((m = /^listen\s+(?:[\d.]+:)?(\d+)/.exec(l))) st.port = +m[1];
        if ((m = /^proxy_pass\s+(\S+?);/.exec(l))) st.proxy = m[1].replace(/\/$/, "");
        if ((m = /^root\s+(\S+?);/.exec(l))) st.root = m[1];
      }
      if (depth > 0) return { error: "nginx: [emerg] unexpected end of file, expecting \"}\" in " + path + ":" + ls.length };
      return st;
    },
    start: function (p) {
      var argv = p.argv.filter(function (a) { return a !== "/docker-entrypoint.sh"; });
      if (argv[0] === "nginx" && (argv[1] === "-v" || argv[1] === "-t")) return apps.nginx.tools.nginx(argv.slice(1), { out: function (t) { p.log(t.replace(/\n$/, "")); } }, p.sim, null, p) || { exit: 0 };
      p.log("/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration");
      p.log("/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/");
      p.log("/docker-entrypoint.sh: Configuration complete; ready for start up");
      var st = this.check(p);
      if (st.error) { p.log(stamp(p) + " [emerg] 1#1: " + st.error.replace("nginx: [emerg] ", "")); p.log(st.error); return { exit: 1 }; }
      p.state.nginx = st;
      p.log(stamp(p) + " [notice] 1#1: using the \"epoll\" event method");
      p.log(stamp(p) + " [notice] 1#1: nginx/" + (p.env.NGINX_VERSION || "1.29.1"));
      p.log(stamp(p) + " [notice] 1#1: start worker processes");
      return { listen: [st.port] };
    },
    http: function (p, req) {
      var st = p.state.nginx, res, d = p.sim.date().toUTCString().split(" ");
      if (st.proxy) {
        try { res = p.sim.request(p.origin, { url: st.proxy + req.path, method: req.method, headers: req.headers, body: req.body }); }
        catch (e) {
          if (!(e instanceof NetError)) throw e;
          p.log(stamp(p) + " [error] 29#29: *1 " + (e.kind === "resolve" ? "no resolver defined to resolve " + st.proxy.replace(/^\w+:\/\//, "") : "connect() failed (111: Connection refused) while connecting to upstream") + ", client: " + (req.from.ip || "172.17.0.1") + ", server: localhost, request: \"" + req.method + " " + req.path + " HTTP/1.1\", upstream: \"" + st.proxy + req.path + "\"");
          res = { status: 502, body: S.pages.nginx(502, "Bad Gateway"), type: "text/html" };
        }
      } else {
        var path = st.root + (/\/$/.test(req.path) ? req.path + "index.html" : req.path), body = p.fs.read(path);
        if (body == null && p.fs.isDir(path)) res = { status: 403, body: S.pages.nginx(403, "Forbidden"), type: "text/html" };
        else res = body == null ? { status: 404, body: S.pages.nginx(404, "Not Found"), type: "text/html" } : { status: 200, body: body, type: /\.html?$/.test(path) ? "text/html" : "text/plain" };
      }
      p.log((req.from.ip || "172.17.0.1") + " - - [" + d[1] + "/" + d[2] + "/" + d[3] + ":" + d[4] + " +0000] \"" + req.method + " " + req.path + " HTTP/1.1\" " + res.status + " " + (res.body || "").length + " \"-\" \"" + (req.headers["User-Agent"] || "curl/8.14.1") + "\" \"-\"");
      res.server = "nginx/" + (p.env.NGINX_VERSION || "1.29.1");
      return res;
    },
    tools: {
      nginx: function (a, io, sim, sc, p) {
        if (a[0] === "-v") { io.out("nginx version: nginx/" + (p.env.NGINX_VERSION || "1.29.1") + "\n"); return { exit: 0 }; }
        if (a[0] === "-t") {
          var st = apps.nginx.check(p);
          if (st.error) { io.out(st.error + "\nnginx: configuration file /etc/nginx/nginx.conf test failed\n"); return { exit: 1 }; }
          io.out("nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n"); return { exit: 0 };
        }
        if (a[0] === "-s" && a[1] === "reload") {
          var st2 = apps.nginx.check(p);
          if (st2.error) { io.out(st2.error + "\n"); return { exit: 1 }; }
          p.state.nginx = st2; p.listen = [st2.port]; p.log(stamp(p) + " [notice] 1#1: signal 1 (SIGHUP) received from 42, reconfiguring");
          return { exit: 0 };
        }
        io.out("nginx: invalid option\n"); return { exit: 1 };
      }
    }
  };

  apps.redis = {
    mem: 8, cpu: 2, bins: ["redis-server", "docker-entrypoint.sh"],
    start: function (p) {
      p.log("1:C " + p.sim.date().toUTCString().slice(5, 25) + " * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo");
      p.log("1:M " + p.sim.date().toUTCString().slice(5, 25) + " * Running mode=standalone, port=6379.");
      p.log("1:M " + p.sim.date().toUTCString().slice(5, 25) + " * Ready to accept connections tcp");
      p.state.kv = JSON.parse(p.fs.read("/data/dump.json") || "{}");
      return { listen: [6379] };
    },
    tcp: function (p, port, msg) {
      var kv = p.state.kv;
      if (msg.op === "ping") return { value: "PONG" };
      if (msg.op === "set") { kv[msg.key] = msg.value; p.fs.write("/data/dump.json", JSON.stringify(kv)); return { value: "OK" }; }
      if (msg.op === "incr") { kv[msg.key] = String((parseInt(kv[msg.key] || "0", 10) || 0) + 1); p.fs.write("/data/dump.json", JSON.stringify(kv)); return { value: kv[msg.key] }; }
      if (msg.op === "get") return { value: kv[msg.key] == null ? null : kv[msg.key] };
      if (msg.op === "keys") return { value: Object.keys(kv) };
      return { error: "ERR unknown command" };
    },
    tools: {
      "redis-cli": function (a, io, sim, sc, p) {
        var f = U.flags(a, { str: "h p a n", stop: true }), host = f.h || "127.0.0.1", port = +(f.p || 6379), ep;
        try { ep = sim.connect(p.origin, host, port); }
        catch (e) { if (!(e instanceof NetError)) throw e; throw new CmdError("Could not connect to Redis at " + host + ":" + port + ": " + (e.kind === "resolve" ? "Name or service not known" : "Connection refused")); }
        if (!ep.proc.app.tcp || ep.proc.app !== apps.redis) throw new CmdError("Error: Protocol error, got \"H\" as reply type byte");
        var c = (f._[0] || "ping").toLowerCase(), r = apps.redis.tcp(ep.proc, port, { op: c, key: f._[1], value: f._[2] });
        if (r.error) { io.out("(error) " + r.error + "\n"); return; }
        io.out((r.value == null ? "(nil)" : Array.isArray(r.value) ? (r.value.length ? r.value.map(function (k, i) { return (i + 1) + ") \"" + k + "\""; }).join("\n") : "(empty array)") : c === "get" ? "\"" + r.value + "\"" : c === "incr" ? "(integer) " + r.value : r.value) + "\n");
      }
    }
  };

  var PRODUCTS = [{ id: 1, name: "Keyboard", price: 49 }, { id: 2, name: "Mouse", price: 19 }, { id: 3, name: "Monitor", price: 199 }];
  apps.postgres = {
    mem: 42, cpu: 3, bins: ["postgres", "docker-entrypoint.sh"],
    dataFile: function (p) { return (p.env.PGDATA || "/var/lib/postgresql/data").replace(/\/$/, "") + "/sim-cluster.json"; },
    load: function (p) { var c = p.fs.read(this.dataFile(p)); return c ? JSON.parse(c) : null; },
    save: function (p, db) { p.fs.write(this.dataFile(p), JSON.stringify(db)); },
    start: function (p) {
      var db = this.load(p), ts = function () { return p.sim.date().toISOString().replace("T", " ").replace("Z", " UTC"); };
      if (!db) {
        if (!p.env.POSTGRES_PASSWORD && p.env.POSTGRES_HOST_AUTH_METHOD !== "trust") {
          p.log("Error: Database is uninitialized and superuser password is not specified.\n       You must specify POSTGRES_PASSWORD to a non-empty value for the\n       superuser. For example, \"-e POSTGRES_PASSWORD=password\" on \"docker run\".\n\n       You may also use \"POSTGRES_HOST_AUTH_METHOD=trust\" to allow all\n       connections without a password. This is *not* recommended.\n\n       See PostgreSQL documentation about \"trust\":\n       https://www.postgresql.org/docs/current/auth-trust.html");
          return { exit: 1 };
        }
        var user = p.env.POSTGRES_USER || "postgres", name = p.env.POSTGRES_DB || user;
        db = { user: user, password: p.env.POSTGRES_PASSWORD || "", trust: p.env.POSTGRES_HOST_AUTH_METHOD === "trust", dbs: {} };
        db.dbs[name] = { orders: [], products: PRODUCTS };
        if (name !== "postgres") db.dbs.postgres = {};
        p.log("The files belonging to this database system will be owned by user \"postgres\".\nThis user must also own the server process.\n");
        p.log("fixing permissions on existing directory " + (p.env.PGDATA || "/var/lib/postgresql/data") + " ... ok");
        p.log("creating subdirectories ... ok\nperforming post-bootstrap initialization ... ok\nsyncing data to disk ... ok\n");
        if (name !== "postgres") p.log("CREATE DATABASE\n");
        p.log("PostgreSQL init process complete; ready for start up.\n");
        this.save(p, db);
      } else {
        p.log("\nPostgreSQL Database directory appears to contain a database; Skipping initialization\n");
      }
      p.log(ts() + " [1] LOG:  starting PostgreSQL " + (/^16/.test(p.image.version) ? "16.10" : "17.6") + " on x86_64-pc-linux-gnu, compiled by gcc, 64-bit");
      p.log(ts() + " [1] LOG:  listening on IPv4 address \"0.0.0.0\", port 5432");
      p.log(ts() + " [1] LOG:  database system is ready to accept connections");
      return { listen: [5432] };
    },
    tcp: function (p, port, msg) {
      var db = this.load(p), ts = p.sim.date().toISOString().replace("T", " ").replace("Z", " UTC");
      if (!msg.local && !db.trust && (msg.user !== db.user || msg.password !== db.password)) {
        p.log(ts + " [77] FATAL:  password authentication failed for user \"" + msg.user + "\"");
        p.log(ts + " [77] DETAIL:  " + (msg.user !== db.user ? "Role \"" + msg.user + "\" does not exist." : "Connection matched file \"/var/lib/postgresql/data/pg_hba.conf\" line 128: \"host all all all scram-sha-256\""));
        return { error: "password authentication failed for user \"" + msg.user + "\"" };
      }
      if (msg.user !== db.user) { p.log(ts + " [77] FATAL:  role \"" + msg.user + "\" does not exist"); return { error: "role \"" + msg.user + "\" does not exist" }; }
      var d = db.dbs[msg.db];
      if (!d) { p.log(ts + " [77] FATAL:  database \"" + msg.db + "\" does not exist"); return { error: "database \"" + msg.db + "\" does not exist" }; }
      if (msg.op === "list") return { rows: Object.keys(db.dbs) };
      if (msg.op === "tables") return { rows: Object.keys(d) };
      if (msg.op === "select") { if (!d[msg.table]) return { error: "relation \"" + msg.table + "\" does not exist" }; return { rows: d[msg.table] }; }
      if (msg.op === "insert") { d[msg.table] = d[msg.table] || []; var row = Object.assign({ id: d[msg.table].length + 1 }, msg.row); d[msg.table].push(row); this.save(p, db); return { rows: [row] }; }
      if (msg.op === "ping") return { rows: [] };
      return { error: "syntax error" };
    },
    tools: {
      pg_isready: function (a, io, sim, sc, p) { io.out("/var/run/postgresql:5432 - accepting connections\n"); },
      psql: function (a, io, sim, sc, p) {
        var f = U.flags(a, { str: "U d c h p", bool: "t A l" }), db = apps.postgres.load(p);
        var user = f.U || sc.env.POSTGRES_USER || (sc.user === "postgres" ? "postgres" : "root"), name = f.d || f._[0] || sc.env.POSTGRES_DB || user;
        if (user !== db.user) throw new CmdError("psql: error: connection to server on socket \"/var/run/postgresql/.s.PGSQL.5432\" failed: FATAL:  role \"" + user + "\" does not exist", 2);
        if (!db.dbs[name]) throw new CmdError("psql: error: connection to server on socket \"/var/run/postgresql/.s.PGSQL.5432\" failed: FATAL:  database \"" + name + "\" does not exist", 2);
        var sql = f.l ? "\\l" : f.c;
        if (sql == null) throw new CmdError("psql: the interactive prompt isn't simulated. Run one statement with -c, for example:\n  psql -U " + user + " -d " + name + " -c \"SELECT * FROM orders\"");
        sql = sql.trim().replace(/;$/, "");
        var m;
        function grid(rows, cols) {
          if (!cols.length) cols = ["?column?"];
          var t = [cols].concat(rows.map(function (r) { return cols.map(function (c) { return r[c] == null ? "" : String(r[c]); }); }));
          var w = cols.map(function (_, i) { return Math.max.apply(null, t.map(function (r) { return r[i].length; })); });
          var line = function (r) { return " " + r.map(function (c, i) { return c + " ".repeat(w[i] - c.length); }).join(" | ").replace(/\s+$/, ""); };
          io.out(line(t[0]) + "\n" + w.map(function (n) { return "-".repeat(n + 2); }).join("+") + "\n" + t.slice(1).map(line).join("\n") + (rows.length ? "\n" : "") + "(" + rows.length + " row" + (rows.length === 1 ? "" : "s") + ")\n\n");
        }
        if (sql === "\\l") return grid(Object.keys(db.dbs).map(function (n) { return { Name: n, Owner: db.user, Encoding: "UTF8" }; }), ["Name", "Owner", "Encoding"]);
        if (sql === "\\dt") return grid(Object.keys(db.dbs[name]).map(function (n) { return { Schema: "public", Name: n, Type: "table", Owner: db.user }; }), ["Schema", "Name", "Type", "Owner"]);
        if ((m = /^select\s+count\(\*\)\s+from\s+(\w+)$/i.exec(sql))) { if (!db.dbs[name][m[1]]) throw new CmdError("ERROR:  relation \"" + m[1] + "\" does not exist"); return grid([{ count: db.dbs[name][m[1]].length }], ["count"]); }
        if ((m = /^select\s+\*\s+from\s+(\w+)$/i.exec(sql))) { var rows = db.dbs[name][m[1]]; if (!rows) throw new CmdError("ERROR:  relation \"" + m[1] + "\" does not exist"); return grid(rows, rows.length ? Object.keys(rows[0]) : ["id"]); }
        if (/^select\s+1$/i.test(sql)) return grid([{ "?column?": 1 }], ["?column?"]);
        if ((m = /^insert\s+into\s+orders\s*(?:\(\s*item\s*\))?\s*values\s*\(\s*'([^']*)'\s*\)$/i.exec(sql))) { apps.postgres.tcp(p, 5432, { local: true, user: user, db: name, op: "insert", table: "orders", row: { item: m[1] } }); io.out("INSERT 0 1\n"); return; }
        throw new CmdError("ERROR:  this simulated psql understands: \\l, \\dt, SELECT 1, SELECT * FROM <table>, SELECT count(*) FROM <table>, INSERT INTO orders VALUES ('item')");
      }
    }
  };

  function parseDbUrl(url) {
    var m = /^postgres(?:ql)?:\/\/([^:@/]+)(?::([^@/]*))?@([^:/]+)(?::(\d+))?\/([^?]+)/.exec(url || "");
    return m ? { user: m[1], password: m[2] || "", host: m[3], port: +(m[4] || 5432), db: m[5] } : null;
  }
  function dbCall(p, msg) {
    var u = parseDbUrl(p.env.DATABASE_URL);
    if (!u) return { error: "invalid DATABASE_URL" };
    var ep;
    try { ep = p.sim.connect(p.origin, u.host, u.port); }
    catch (e) { if (!(e instanceof NetError)) throw e; return { error: netMsg(e, u.host, u.port) }; }
    if (ep.proc.app !== apps.postgres) return { error: "unexpected response from " + u.host + ":" + u.port + " (is that a PostgreSQL server?)" };
    return apps.postgres.tcp(ep.proc, u.port, Object.assign({ user: u.user, password: u.password, db: u.db }, msg));
  }
  function jlog(p, level, msg, extra) { p.log(JSON.stringify(Object.assign({ level: level, time: p.sim.iso(), msg: msg }, extra || {}))); }

  apps.shopapi = {
    mem: 120, cpu: 6, bins: ["node", "docker-entrypoint.sh", "npm"],
    start: function (p) {
      if (p.argv.indexOf("--version") >= 0 || p.argv.indexOf("-v") >= 0) { p.log("v24.9.0"); return { exit: 0 }; }
      if (!p.env.DATABASE_URL) {
        p.log("/app/config.js:12\n    throw new Error('DATABASE_URL is not set');\n    ^\n\nError: DATABASE_URL is not set\n    at loadConfig (/app/config.js:12:11)\n    at Object.<anonymous> (/app/server.js:4:16)\n\nNode.js v24.9.0");
        return { exit: 1 };
      }
      if (!parseDbUrl(p.env.DATABASE_URL)) {
        p.log("/app/config.js:17\n    throw new Error('DATABASE_URL is not a valid postgres:// URL');\n    ^\n\nError: DATABASE_URL is not a valid postgres:// URL\n    at loadConfig (/app/config.js:17:11)\n\nNode.js v24.9.0");
        return { exit: 1 };
      }
      var port = parseInt(p.env.PORT || "3000", 10);
      jlog(p, "info", "shop-api " + p.image.version + " listening", { port: port });
      return { listen: [port] };
    },
    http: function (p, req) {
      var json = function (status, body) { return { status: status, body: JSON.stringify(body) + "\n", type: "application/json" }; };
      var v11 = p.image.version !== "1.0";
      if (req.path === "/healthz") return { status: 200, body: "ok\n" };
      if (req.path === "/readyz") {
        var r0 = dbCall(p, { op: "ping" });
        if (r0.error) { jlog(p, "warn", "readiness check failed", { error: r0.error }); return { status: 503, body: "database unavailable: " + r0.error + "\n" }; }
        return { status: 200, body: "ready\n" };
      }
      if (req.path === "/version") return json(200, { service: "shop-api", version: p.image.version });
      if (req.path === "/products") {
        var r = dbCall(p, { op: "select", table: "products" });
        if (r.error) { jlog(p, "error", "GET /products failed", { error: r.error }); return json(500, { error: "database error: " + r.error }); }
        jlog(p, "info", "GET /products 200");
        return json(200, r.rows.map(function (x) { return v11 ? x : { id: x.id, name: x.name }; }));
      }
      if (req.path === "/orders") {
        var r2 = req.method === "POST" ? dbCall(p, { op: "insert", table: "orders", row: { item: (req.body || "item").replace(/^item=/, "") } }) : dbCall(p, { op: "select", table: "orders" });
        if (r2.error) { jlog(p, "error", req.method + " /orders failed", { error: r2.error }); return json(500, { error: "database error: " + r2.error }); }
        jlog(p, "info", req.method + " /orders " + (req.method === "POST" ? 201 : 200));
        return json(req.method === "POST" ? 201 : 200, req.method === "POST" ? r2.rows[0] : r2.rows);
      }
      return json(404, { error: "not found" });
    }
  };

  apps.shopweb = {
    mem: 60, cpu: 4, bins: ["node", "docker-entrypoint.sh", "npm"],
    start: function (p) {
      var name = p.image.appName || "web";
      if (p.argv.indexOf("--version") >= 0 || p.argv.indexOf("-v") >= 0) { p.log("v24.9.0"); return { exit: 0 }; }
      if (p.image.version === "1.2") {
        p.log("/app/server.js:21\nconst theme = config.ui.theme;\n                       ^\n\nTypeError: Cannot read properties of undefined (reading 'theme')\n    at Object.<anonymous> (/app/server.js:21:24)\n    at Module._compile (node:internal/modules/cjs/loader:1730:14)\n\nNode.js v24.9.0");
        return { exit: 1 };
      }
      var port = parseInt(p.env.PORT || "8080", 10);
      if (isNaN(port)) { p.log("RangeError [ERR_SOCKET_BAD_PORT]: options.port should be >= 0 and < 65536. Received type string ('" + p.env.PORT + "')."); return { exit: 1 }; }
      jlog(p, "info", "shop-" + name + " " + p.image.version + " listening", { port: port, api: p.env.API_URL || "http://api:3000" });
      return { listen: [port] };
    },
    http: function (p, req) {
      var v = p.image.version, name = p.image.appName || "web";
      if (req.path === "/healthz") return { status: 200, body: "ok\n" };
      if (req.path !== "/") { jlog(p, "info", req.method + " " + req.path + " 404"); return { status: 404, body: "Not found\n" }; }
      var head = "Shop " + name + " v" + v + (p.env.BANNER ? "\n" + p.env.BANNER : "") + "\nServed by: " + p.hostname + "\n";
      if (name !== "web") return { status: 200, body: head };
      var api = (p.env.API_URL || "http://api:3000").replace(/\/$/, ""), m = /^\w+:\/\/([^:/]+)(?::(\d+))?/.exec(api) || [], res;
      try { res = p.sim.request(p.origin, { url: api + "/products", method: "GET", headers: {} }); }
      catch (e) {
        if (!(e instanceof NetError)) throw e;
        var why = netMsg(e, m[1] || api, m[2] || 80);
        jlog(p, "error", "GET / 502", { error: why });
        return { status: 502, body: head + "Products: unavailable (" + why + ")\n" };
      }
      if (res.status !== 200) { jlog(p, "error", "GET / 502", { error: "api responded " + res.status }); return { status: 502, body: head + "Products: unavailable (api responded " + res.status + ": " + (res.body || "").trim() + ")\n" }; }
      jlog(p, "info", "GET / 200");
      var list = JSON.parse(res.body).map(function (x) { return x.name + (x.price && v !== "1.0" ? " ($" + x.price + ")" : ""); }).join(", ");
      return { status: 200, body: head + "Products: " + list + "\n" };
    }
  };

  /* Images built in the sandbox from a node base image: behaviour is derived from the files in the image. */
  apps.node = {
    mem: 48, cpu: 3, bins: ["node", "npm", "docker-entrypoint.sh"],
    start: function (p) {
      var argv = p.argv.filter(function (a) { return a !== "docker-entrypoint.sh"; }), wd = p.workdir || "/";
      var ver = "v" + (p.env.NODE_VERSION || "24.9.0");
      if (argv[0] === "node" && (argv[1] === "-v" || argv[1] === "--version")) { p.log(ver); return { exit: 0 }; }
      if (argv[0] === "npm") {
        var pkg; try { pkg = JSON.parse(p.fs.read(U.norm("package.json", wd)) || "null"); } catch (e) { pkg = null; }
        if (!pkg) { p.log("npm error code ENOENT\nnpm error syscall open\nnpm error path " + U.norm("package.json", wd) + "\nnpm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '" + U.norm("package.json", wd) + "'"); return { exit: 254 }; }
        var script = argv[1] === "start" ? (pkg.scripts && pkg.scripts.start) || "node server.js" : pkg.scripts && pkg.scripts[argv[2] || argv[1]];
        if (!script) { p.log("npm error Missing script: \"" + (argv[2] || argv[1]) + "\""); return { exit: 1 }; }
        p.log("\n> " + (pkg.name || "app") + "@" + (pkg.version || "1.0.0") + " " + argv[1] + "\n> " + script + "\n");
        argv = script.split(/\s+/);
      }
      if (argv[0] !== "node") return null;
      if (!argv[1]) return p.tty ? {} : { exit: 0 };
      var file = U.norm(argv[1], wd), src = p.fs.read(file);
      var fail = function (what) { p.log("node:internal/modules/cjs/loader:1386\n  throw err;\n  ^\n\nError: Cannot find module '" + what + "'" + (what === file ? "" : "\nRequire stack:\n- " + file) + "\n    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)\n    at Function._load (node:internal/modules/cjs/loader:1192:27) {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: [" + (what === file ? "" : " '" + file + "' ") + "]\n}\n\nNode.js " + ver); return { exit: 1 }; };
      if (src == null) return fail(file);
      var re = /require\(\s*['"]([^'"./][^'"]*)['"]\s*\)|from\s+['"]([^'"./][^'"]*)['"]/g, m;
      while ((m = re.exec(src))) {
        var mod = m[1] || m[2];
        if (/^node:/.test(mod) || ["http", "https", "fs", "os", "path", "url", "util", "events", "crypto", "net"].indexOf(mod) >= 0) continue;
        if (!p.fs.exists(U.norm("node_modules/" + mod, U.dirname(file)))) return fail(mod);
      }
      var sub = function (s) {
        return s.replace(/\$\{\s*process\.env\.(\w+)\s*(?:\|\|\s*['"]([^'"]*)['"]\s*)?\}/g, function (_, k, d) { return p.env[k] != null ? p.env[k] : d || "undefined"; })
          .replace(/\$\{\s*(?:os\.)?hostname\(\)\s*\}/g, p.hostname).replace(/\\n/g, "\n");
      };
      var logs = /console\.log\(\s*([`'"])((?:(?!\1).)*)\1/.exec(src);
      var lm = /\.listen\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d+|port|PORT)/.exec(src), port = null;
      if (lm) {
        var dm = /(?:port|PORT)\s*=\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d+)/.exec(src);
        var usesEnv = /process\.env\.PORT/.test(src);
        port = /^\d+$/.test(lm[1]) ? +lm[1] : dm ? +dm[1] : 3000;
        if (usesEnv && p.env.PORT) port = parseInt(p.env.PORT, 10);
      }
      var bm = /\.(?:end|send)\(\s*([`'"])((?:(?!\1)[\s\S])*)\1/.exec(src);
      p.state.body = bm ? sub(bm[2]) : "OK\n";
      if (logs) p.log(sub(logs[2]).replace(/\$\{\s*(?:port|PORT)\s*\}/g, port));
      return port ? { listen: [port] } : { exit: 0 };
    },
    http: function (p, req) { p.log("GET " + req.path); var b = p.state.body; return { status: 200, body: /\n$/.test(b) ? b : b + "\n" }; },
    tools: {
      node: function (a, io, sim, sc, p) { if (a[0] === "-v" || a[0] === "--version") io.out("v" + (p.env.NODE_VERSION || "24.9.0") + "\n"); else if (a[0] === "-e" || a[0] === "-p") io.out("(the sandbox can't evaluate JavaScript)\n"); else throw new CmdError("node: the sandbox can only start the script the image was built for"); },
      npm: function (a, io) { if (a[0] === "-v" || a[0] === "--version") io.out("11.6.0\n"); else throw new CmdError("npm: not available inside a running sandbox container; npm runs during docker build"); }
    }
  };

  /* Generic images that just run a command: alpine, busybox, ubuntu, curl... A tiny synchronous sh interpreter. */
  apps.shell = {
    mem: 1, cpu: 0,
    start: function (p) {
      var argv = p.argv.slice();
      if (argv[0] === "/entrypoint.sh") argv.shift();
      var sim = p.sim, total = 0, forever = false, code = 0;
      function one(a) {
        var name = a[0].replace(/^.*\//, "");
        if (name === "sleep") { if (a[1] === "infinity" || a[1] === "inf") forever = true; else total += parseFloat(a[1] || "0") * (/m$/.test(a[1]) ? 60 : /h$/.test(a[1]) ? 3600 : /d$/.test(a[1]) ? 86400 : 1); return 0; }
        if (name === "echo") { p.log(a.slice(1).join(" ")); return 0; }
        if (name === "true" || name === ":") return 0;
        if (name === "false") return 1;
        if (name === "exit") return { exit: parseInt(a[1] || "0", 10) };
        if (name === "date") { p.log(sim.date().toUTCString().replace("GMT", "UTC")); return 0; }
        if (name === "hostname") { p.log(p.hostname); return 0; }
        if (name === "env" || name === "printenv") { if (a[1]) { if (p.env[a[1]] == null) return 1; p.log(p.env[a[1]]); } else p.log(Object.keys(p.env).map(function (k) { return k + "=" + p.env[k]; }).join("\n")); return 0; }
        if (name === "cat" || name === "ls") {
          var rc = 0;
          a.slice(1).filter(function (x) { return x[0] !== "-"; }).concat(name === "ls" && a.length === 1 ? ["."] : []).forEach(function (f) {
            var q = U.norm(f, p.workdir || "/");
            if (name === "ls" && p.fs.isDir(q)) { p.log(p.fs.list(q).join("\n")); return; }
            var c = p.fs.read(q);
            if (c == null) { p.log(name + ": " + (name === "cat" ? "can't open '" + f + "'" : f) + ": No such file or directory"); rc = 1; } else p.log(name === "ls" ? f : c.replace(/\n$/, ""));
          });
          return rc;
        }
        if (name === "tail" && a.indexOf("-f") >= 0) { forever = true; return 0; }
        if (name === "wget" || name === "curl") {
          if (p.image.tools.indexOf(name) < 0) { p.log("sh: " + name + ": not found"); return 127; }
          var url = a.slice(1).filter(function (x) { return x[0] !== "-" && x !== "-" && !/^\d+$/.test(x); }).pop(), hm = /^(?:\w+:\/\/)?([^/:]+)(?::(\d+))?/.exec(url || "") || [];
          if (!url) { p.log(name === "curl" ? "curl: try 'curl --help' or 'curl --manual' for more information" : "Usage: wget [-qO-] URL"); return 2; }
          try {
            var res = sim.request(p.origin, { url: url, method: "GET", headers: {} });
            if (name === "wget" && res.status >= 400) { p.log("wget: server returned error: HTTP/1.1 " + res.status + " " + (S.STATUS[res.status] || "")); return 1; }
            p.log((res.body || "").replace(/\n$/, "")); return 0;
          } catch (e) {
            if (!(e instanceof NetError)) throw e;
            if (e.kind === "timeout") total += 10;
            if (name === "curl") { p.log(e.kind === "resolve" ? "curl: (6) Could not resolve host: " + hm[1] : e.kind === "timeout" ? "curl: (28) Failed to connect to " + hm[1] + " port " + (hm[2] || 80) + " after 10001 ms: Timeout was reached" : "curl: (7) Failed to connect to " + hm[1] + " port " + (hm[2] || 80) + " after 0 ms: Could not connect to server"); return e.kind === "resolve" ? 6 : e.kind === "timeout" ? 28 : 7; }
            p.log(e.kind === "resolve" ? "wget: bad address '" + hm[1] + (hm[2] ? ":" + hm[2] : "") + "'" : e.kind === "timeout" ? "wget: download timed out" : "wget: can't connect to remote host (" + (e.detail || hm[1]) + "): Connection refused"); return 1;
          }
        }
        if (name === "nslookup") { try { var ep = sim.resolve(p.origin, a[1], 0); p.log("Name:\t" + (ep.fqdn || a[1]) + "\nAddress: " + ep.ip); return 0; } catch (e2) { if (!(e2 instanceof NetError)) throw e2; p.log("** server can't find " + a[1] + ": NXDOMAIN"); return 1; } }
        if (name === "python" || name === "python3") { if (a[1] === "-V" || a[1] === "--version") { p.log("Python 3.13.7"); return 0; } return 0; }
        if (name === "sh" || name === "bash" || name === "ash") {
          if (name === "bash" && p.image.tools.indexOf("bash") < 0) return { notFound: a[0] };
          if (a[1] === "-c") return script(a[2] || "");
          if (a.length === 1) { if (p.tty) forever = true; return 0; }
          var f = p.fs.read(U.norm(a[1], p.workdir || "/"));
          if (f == null) { p.log(name + ": can't open '" + a[1] + "': No such file or directory"); return 2; }
          return script(f.replace(/^#!.*\n/, "").split("\n").filter(function (l) { return l.trim() && l.trim()[0] !== "#"; }).join("; "));
        }
        if (p.image.tools.indexOf(name) >= 0) return 0;
        return { notFound: a[0] };
      }
      function script(text) {
        var rc = 0, loop = /\bwhile\s+(true|:|\[\s*1\s*\])\s*;?\s*do\b/.test(text);
        text = text.replace(/\bwhile\s+(true|:|\[\s*1\s*\])\s*;?\s*do\b/g, "").replace(/;?\s*\bdone\b/g, "");
        var parts = text.split(/(&&|\|\||;|\n)/), prev = ";";
        for (var i = 0; i < parts.length; i += 2) {
          var seg = parts[i].trim();
          if (seg && !((prev === "&&" && rc !== 0) || (prev === "||" && rc === 0))) {
            var toks; try { toks = S.tokenize(seg.replace(/\s*>\s*\/dev\/null|2>&1/g, ""), p.env).filter(function (t) { return t.v != null; }).map(function (t) { return t.v; }); } catch (e) { toks = seg.split(/\s+/); }
            if (toks.length) {
              var r = one(toks);
              if (r && r.exit != null) return r;
              if (r && r.notFound) { p.log("sh: " + r.notFound + ": not found"); rc = 127; } else rc = r;
            }
          }
          prev = parts[i + 1] || ";";
          if (forever) break;
        }
        if (loop) forever = true;
        return rc;
      }
      if (!argv.length) return { exit: 0 };
      var r = one(argv);
      if (r && r.notFound) return { notFound: r.notFound };
      if (r && r.exit != null) code = r.exit; else code = r || 0;
      if (forever) return {};
      return total > 0 ? { exit: code, after: total } : { exit: code };
    }
  };

  /* ---------- container processes ---------- */
  var SHELL_BINS = ["sh", "bash", "ash", "sleep", "echo", "cat", "ls", "env", "printenv", "true", "false", "date", "hostname", "wget", "curl", "nslookup", "tail", "/bin/sh", "/bin/bash", "/bin/ash", "python", "python3"];
  S.proc = {
    /* opts: { image, argv, env, mounts, origin, hostname, ip, tty, workdir, memLimitMi, user } */
    create: function (sim, o) {
      var p = {
        sim: sim, image: o.image, argv: o.argv, env: o.env, fs: new S.ProcFs(o.image.files, o.mounts), origin: o.origin, hostname: o.hostname, ip: o.ip || null,
        tty: !!o.tty, workdir: o.workdir || o.image.config.WorkingDir || "/", memLimitMi: o.memLimitMi || 0, user: o.user || o.image.config.User || "root",
        logs: [], state: {}, running: false, listen: [], exitAt: null, exitCode: null, startedAt: null, finishedAt: null, oom: false,
        app: apps[o.image.app] || apps.shell
      };
      p.log = function (text) { String(text).split("\n").forEach(function (l) { p.logs.push({ t: sim.now, s: l }); }); };
      p.origin.proc = p;
      return p;
    },
    /* Returns null on success or an error string when the executable can't be started. */
    start: function (sim, p) {
      p.running = false; p.listen = []; p.exitAt = null; p.exitCode = null; p.oom = false; p.state = {};
      var app = p.app, r;
      if (!p.argv[0]) return "no command specified";
      // shell-form CMD ("/bin/sh -c node server.js") that just launches the image's own program
      if (p.argv.length === 3 && /^(\/bin\/)?(sh|bash)$/.test(p.argv[0]) && p.argv[1] === "-c" && !/[;&|<>]/.test(p.argv[2]) && app.bins && app.bins.indexOf(p.argv[2].trim().split(/\s+/)[0]) >= 0) p.argv = p.argv[2].trim().split(/\s+/);
      if (app === apps.shell && /entrypoint\.sh$/.test(p.argv[0]) && p.argv.length > 1) p.argv = p.argv.slice(1);   // the entrypoint script just execs its arguments
      var bin = p.argv[0];
      var base = bin.replace(/^.*\//, "");
      var isAppBin = app.bins && (app.bins.indexOf(bin) >= 0 || app.bins.indexOf(base) >= 0);
      if (app.any) isAppBin = true;
      if (isAppBin) r = app.start(p);
      if (!isAppBin || r === null) {
        if (SHELL_BINS.indexOf(bin) < 0 && p.image.tools.indexOf(base) < 0) return "exec: \"" + bin + "\": executable file not found in $PATH";
        if ((base === "bash" && p.image.tools.indexOf("bash") < 0) || !p.image.tools.length) return "exec: \"" + bin + "\": executable file not found in $PATH";
        r = apps.shell.start(p);
        if (r.notFound) return "exec: \"" + r.notFound + "\": executable file not found in $PATH";
      }
      p.startedAt = sim.now; p.running = true; p.finishedAt = null;
      p.mem = (app.mem || 1); p.cpu = app.cpu || 0;
      if (r.exit != null) { p.exitAt = sim.now + (r.after || 0) * 1000; p.exitCode = r.exit; }
      else if (p.memLimitMi && p.mem > p.memLimitMi) { p.exitAt = sim.now + 2000; p.exitCode = 137; p.oom = true; p.mem = p.memLimitMi; }
      p.listen = r.listen || [];
      if (p.exitAt != null && p.exitAt <= sim.now) S.proc.finish(sim, p);
      return null;
    },
    finish: function (sim, p) { p.running = false; p.listen = []; p.finishedAt = sim.now; p.exitAt = null; },
    poll: function (sim, p) { if (p.running && p.exitAt != null && p.exitAt <= sim.now) S.proc.finish(sim, p); return p.running; },
    kill: function (sim, p, code) { if (!p.running) return; p.exitCode = code == null ? 137 : code; S.proc.finish(sim, p); },
    /* A shell scope for `docker exec` / `kubectl exec`. */
    scope: function (sim, p, opts) {
      opts = opts || {};
      var tools = p.image.tools, appTools = p.app.tools || {};
      var sc = {
        type: "proc", proc: p, fs: p.fs, cwd: opts.workdir || p.workdir, user: opts.user || p.user || "root", hostname: p.hostname, ip: p.ip, origin: p.origin, dns: opts.dns,
        env: Object.assign({ HOSTNAME: p.hostname, HOME: (opts.user || p.user) && (opts.user || p.user) !== "root" ? "/home/" + (opts.user || p.user) : "/root" }, p.env, opts.env || {}, { "?": "0" }),
        find: function (name) {
          var base = name.replace(/^.*\//, "");
          if (appTools[base] && tools.indexOf(base) >= 0) return function (a, io, s, scope) { var r = appTools[base](a, io, s, scope, p); return r && r.exit != null ? r.exit : 0; };
          if (base === "ps") return function (a, io) { io.out("PID   USER     TIME  COMMAND\n    1 " + (p.user || "root").padEnd(8) + " 0:00 " + p.argv.join(" ") + "\n   " + (20 + Math.floor(sim.rand() * 60)) + " " + sc.user.padEnd(8) + " 0:00 ps\n"); };
          if (base === "apk" || base === "apt-get" || base === "apt") return function () { throw new CmdError(base + ": the sandbox has no internet access, so packages can't be installed inside a container. Use an image that already contains the tool (for example busybox or curlimages/curl)."); };
          if (tools.indexOf(base) < 0) return null;
          return S.builtins[base] || null;
        },
        missing: function (name) { return (tools.indexOf("bash") >= 0 ? "bash: " + name + ": command not found" : "sh: " + name + ": not found"); },
        prompt: function () { return (sc.user === "root" ? "" : "") + (tools.indexOf("bash") >= 0 ? sc.user + "@" + p.hostname + ":" + sc.cwd + (sc.user === "root" ? "# " : "$ ") : sc.cwd + (sc.user === "root" ? " # " : " $ ")); }
      };
      return sc;
    },
    has: function (p, name) { var base = name.replace(/^.*\//, ""); return p.image.tools.indexOf(base) >= 0 || base === "ps"; }
  };
})(typeof window !== "undefined" ? window : globalThis);
