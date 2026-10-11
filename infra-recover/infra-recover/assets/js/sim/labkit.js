/* infra-sim — helpers shared by the scenarios (labs) and their tests. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util;
  S.labs = S.labs || {};
  S.lab = function (id, def) { def.id = id; S.labs[id] = def; };

  S.labHelpers = function (sim) {
    var K = sim.k8s;
    var h = {
      sim: sim, K: K, flags: {},
      sh: async function (script) { var out = ""; var code = await sim.run(script, { out: function (t) { out += t; }, err: function (t) { out += t; } }); return { out: out, code: code }; },
      write: function (path, content) { sim.fs.write(U.norm(path, "/home/learner"), content); },
      file: function (path) { return sim.fs.read(U.norm(path, "/home/learner")); },
      ran: function (re) { return sim.history.some(function (l) { return re.test(l); }); },
      /* docker */
      container: function (name) { return sim.docker.containers.filter(function (c) { return c.name === name; })[0] || null; },
      running: function (name) { var c = h.container(name); return !!c && c.state === "running"; },
      image: function (ref) { return S.docker.findImage(sim, ref); },
      http: function (url, from) { try { return sim.request(from || { type: "host" }, { url: url, method: "GET", headers: {} }); } catch (e) { if (e instanceof S.NetError) return { status: 0, body: "", error: e.kind }; throw e; } },
      ok: function (url, contains) { var r = h.http(url); return r.status === 200 && (!contains || (r.body || "").indexOf(contains) >= 0); },
      /* The page answers and its body contains the text, whatever the status code. */
      has: function (url, contains) { var r = h.http(url); return r.status > 0 && (r.body || "").indexOf(contains) >= 0; },
      orders: function (store) { try { var d = JSON.parse(store.read("/sim-cluster.json") || "null"); var n = 0; Object.keys(d.dbs).forEach(function (k) { n += (d.dbs[k].orders || []).length; }); return n; } catch (e) { return 0; } },
      /* kubernetes */
      get: function (kind, ns, name) { return K.get(kind, ns, name); },
      pods: function (ns, labels) { return K.list("Pod", ns, labels || null); },
      ready: function (ns, labels) { return h.pods(ns, labels).filter(S.k8s.isReady).length; },
      deployReady: function (ns, name, n) { var d = K.get("Deployment", ns, name); if (!d) return false; var s = d.status || {}; return d.spec.replicas > 0 && (s.readyReplicas || 0) === d.spec.replicas && (s.updatedReplicas || 0) === d.spec.replicas && (s.replicas || 0) === d.spec.replicas && (n == null || d.spec.replicas === n); },
      image0: function (ns, name) { var d = K.get("Deployment", ns, name); return d ? d.spec.template.spec.containers[0].image : ""; },
      /* An HTTP request made from inside the cluster (from a CoreDNS pod, or from a pod matching `labels` in `ns`). */
      inCluster: function (url, ns, labels) {
        var p = (ns ? h.pods(ns, labels) : K.list("Pod", "kube-system", { "k8s-app": "kube-dns" })).filter(S.k8s.isReady)[0];
        if (!p) return { status: 0, body: "", error: "nopod" };
        return h.http(url, { type: "pod", ns: p.metadata.namespace, name: p.metadata.name, uid: p.metadata.uid, ip: p.status.podIP });
      },
      shopOk: function (ns) { var r = h.inCluster("http://web." + ns + "/"); return r.status === 200 && /Keyboard/.test(r.body); },
      apply: function (objs, ns) {
        if (ns && !K.get("Namespace", null, ns)) K.create({ apiVersion: "v1", kind: "Namespace", metadata: { name: ns } });
        objs.forEach(function (o) { o = U.clone(o); o.metadata.namespace = S.k8s.BY_KIND[o.kind].namespaced ? (o.metadata.namespace || ns || "default") : undefined; K.create(o); });
      },
      settle: function (seconds) { sim.advance((seconds || 30) * 1000); },
      /* helm / argo */
      release: function (ns, name) { var r = sim.helm.releases[ns + "/" + name]; return r ? r.revisions[r.revisions.length - 1] : null; },
      app: function (name) { var a = K.get("Application", "argocd", name); return a ? a.status || {} : null; },
      appOk: function (name) { var s = h.app(name); return !!s && (s.sync || {}).status === "Synced" && (s.health || {}).status === "Healthy"; },
      yaml: function (o) { return Array.isArray(o) ? o.map(function (x) { return S.yamlDump(x); }).join("---\n") : S.yamlDump(o); }
    };
    return h;
  };

  /* The shop: web -> api -> db. Returns plain objects (no namespace) that labs can tweak before applying. */
  S.shop = function (opts) {
    opts = opts || {};
    var dep = S.git.deployment, svc = S.git.service;
    var db = dep("db", "postgres:17", 1, 5432, { POSTGRES_USER: "shop", POSTGRES_DB: "shop" }, { readinessProbe: { tcpSocket: { port: 5432 } } });
    db.spec.template.spec.containers[0].env.push({ name: "POSTGRES_PASSWORD", valueFrom: { secretKeyRef: { name: "db-auth", key: "password" } } });
    var api = dep("api", opts.apiImage || "shop/api:1.0", 1, 3000, { DATABASE_URL: "postgres://shop:secret@db:5432/shop" }, { readinessProbe: { httpGet: { path: "/readyz", port: 3000 } }, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { memory: "256Mi" } } });
    var web = dep("web", opts.webImage || "shop/web:1.0", opts.webReplicas || 2, 8080, { API_URL: "http://api:3000" }, { readinessProbe: { httpGet: { path: "/healthz", port: 8080 } }, resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { memory: "128Mi" } } });
    return {
      secret: { apiVersion: "v1", kind: "Secret", metadata: { name: "db-auth" }, type: "Opaque", stringData: { password: "secret" } },
      db: db, dbSvc: svc("db", 5432, 5432), api: api, apiSvc: svc("api", 3000, 3000), web: web, webSvc: svc("web", 80, 8080),
      list: function () { return [this.secret, this.db, this.dbSvc, this.api, this.apiSvc, this.web, this.webSvc]; }
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
