/* infra-sim — the `kubectl` CLI, part 1: get, describe, logs, exec, apply, create, delete, run. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, K8 = S.k8s, BY_KIND = K8.BY_KIND, BY_NAME = K8.BY_NAME;
  var kc = S.kubectl = { cmds: {} }, cmds = kc.cmds;
  function kerr(msg, code) { return new CmdError(msg, code == null ? 1 : code); }
  kc.err = kerr;
  var GLOBAL = { str: "n namespace context kubeconfig as as-group cluster user s server request-timeout v", bool: "A all-namespaces", alias: { n: "namespace", A: "all-namespaces" } };
  function spec(extra) {
    return { str: GLOBAL.str + " " + (extra.str || ""), bool: GLOBAL.bool + " " + (extra.bool || ""), multi: extra.multi || "", alias: Object.assign({}, GLOBAL.alias, extra.alias), stop: extra.stop,
      unknown: function (x) { return "error: unknown " + (/shorthand/.test(x) ? x.replace("unknown ", "") : "flag: " + x) + "\nSee 'kubectl " + (extra.cmd || "") + " --help' for usage."; } };
  }
  kc.spec = spec;
  /* Request context: namespace, impersonation, helpers. */
  function ctx(sim, f) {
    var K = sim.k8s, c = { sim: sim, K: K, ns: f.namespace || K.currentNs, all: !!f["all-namespaces"], user: f.as || K.user, f: f };
    if (f.context && f.context !== "sandbox") throw kerr("error: context \"" + f.context + "\" does not exist");
    c.can = function (verb, k, ns, name, sub) {
      if (K.can(c.user, verb, k, ns, name, sub)) return;
      throw kerr("Error from server (Forbidden): " + K8.qual(k) + (name ? " \"" + name + "\"" : "") + " is forbidden: User \"" + c.user + "\" cannot " + verb + " resource \"" + k.plural + (sub ? "/" + sub : "") + "\" in API group \"" + k.group + "\"" + (k.namespaced && ns != null ? " in the namespace \"" + ns + "\"" : " at the cluster scope"));
    };
    return c;
  }
  kc.ctx = ctx;
  function kindOf(name) {
    var k = BY_NAME[name.toLowerCase()];
    if (!k) throw kerr("error: the server doesn't have a resource type \"" + name + "\"");
    return k;
  }
  kc.kindOf = kindOf;
  function notFound(k, name) { return kerr("Error from server (NotFound): " + K8.qual(k) + " \"" + name + "\" not found"); }
  kc.notFound = notFound;
  function fromServer(e, prefix) {   // turn an API error into kubectl's wording
    if (!(e instanceof CmdError) || !e.status) return e;
    if (e.status === "Invalid" && /^The /.test(e.message)) return kerr(e.message);
    if (/^error:/.test(e.message)) return kerr(e.message);
    return kerr("Error from server (" + e.status + "): " + (prefix || "") + e.message);
  }
  kc.fromServer = fromServer;
  function getOne(c, k, name, verb) {
    var ns = k.namespaced ? c.ns : null;
    c.can(verb || "get", k, ns, name);
    var o = c.K.get(k.kind, ns, name);
    if (!o) throw notFound(k, name);
    return o;
  }
  kc.getOne = getOne;
  /* "pod/x", "deploy x y", "pods,svc" → [{k, names:[...]}] */
  function parseTargets(args) {
    if (!args.length) return [];
    if (args.every(function (a) { return a.indexOf("/") > 0; })) return args.map(function (a) { var p = a.split("/"); return { k: kindOf(p[0]), names: [p.slice(1).join("/")] }; });
    if (args.some(function (a, i) { return i > 0 && a.indexOf("/") > 0; }) || (args[0].indexOf("/") > 0 && args.length > 1)) throw kerr("error: there is no need to specify a resource type as a separate argument when passing arguments in resource/name form (e.g. 'kubectl get resource/<resource_name>' instead of 'kubectl get resource resource/<resource_name>'");
    var types = args[0].split(",").filter(Boolean), names = args.slice(1), out = [];
    types.forEach(function (t) {
      if (t.toLowerCase() === "all") ["Pod", "Service", "DaemonSet", "Deployment", "ReplicaSet", "StatefulSet", "CronJob", "Job"].forEach(function (kd) { out.push({ k: BY_KIND[kd], names: names, viaAll: true }); });
      else out.push({ k: kindOf(t), names: names });
    });
    return out;
  }
  kc.parseTargets = parseTargets;
  function age(sim, o) { return U.age(sim.now - (o.metadata._created == null ? 0 : o.metadata._created)); }
  function clean(o) {
    if (Array.isArray(o)) return o.map(clean);
    if (o && typeof o === "object") { var r = {}; Object.keys(o).forEach(function (k) { if (k[0] !== "_" && o[k] !== undefined && typeof o[k] !== "function") r[k] = clean(o[k]); }); return r; }
    return o;
  }
  kc.clean = clean;
  function ref(k, o) { return k.singular + (k.group ? "." + k.group : "") + "/" + o.metadata.name; }
  kc.ref = ref;

  /* ---------- printers ---------- */
  function podState(sim, p) {
    var st = p.status || {}, cs = st.containerStatuses || [], ics = st.initContainerStatuses || [], total = p.spec.containers.length;
    var reason = st.reason || st.phase || "Pending", restarts = 0, lastFin = null, initializing = false, ready = 0, i;
    for (i = 0; i < ics.length; i++) {
      var ic = ics[i]; restarts += ic.restartCount; if (ic._lastFin != null) lastFin = Math.max(lastFin || 0, ic._lastFin);
      if (ic.state.terminated && ic.state.terminated.exitCode === 0) continue;
      if (ic.state.terminated) reason = "Init:" + (ic.state.terminated.reason || "ExitCode:" + ic.state.terminated.exitCode);
      else if (ic.state.waiting && ic.state.waiting.reason && ic.state.waiting.reason !== "PodInitializing") reason = "Init:" + ic.state.waiting.reason;
      else reason = "Init:" + i + "/" + ics.length;
      initializing = true; break;
    }
    if (!initializing) {
      var hasRunning = false; restarts = ics.reduce(function (n, x) { return n + x.restartCount; }, 0);
      for (i = cs.length - 1; i >= 0; i--) {
        var c = cs[i]; restarts += c.restartCount; if (c.ready) ready++; if (c._lastFin != null) lastFin = Math.max(lastFin || 0, c._lastFin);
        if (c.state.waiting && c.state.waiting.reason) reason = c.state.waiting.reason;
        else if (c.state.terminated && c.state.terminated.reason) reason = c.state.terminated.reason;
        else if (c.state.terminated) reason = "ExitCode:" + c.state.terminated.exitCode;
        else if (c.ready && c.state.running) hasRunning = true;
      }
      if (reason === "Completed" && hasRunning) reason = K8.isReady(p) ? "Running" : "NotReady";
    }
    if (p.metadata.deletionTimestamp) reason = "Terminating";
    return { ready: ready + "/" + total, status: reason, restarts: restarts + (restarts && lastFin != null ? " (" + U.age(sim.now - lastFin) + " ago)" : "") };
  }
  kc.podState = podState;
  function images(tpl) { return tpl.spec.containers.map(function (c) { return c.image; }).join(","); }
  function conts(tpl) { return tpl.spec.containers.map(function (c) { return c.name; }).join(","); }
  function svcPorts(s) { return (s.spec.ports || []).map(function (p) { return p.port + (p.nodePort ? ":" + p.nodePort : "") + "/" + p.protocol; }).join(",") || "<none>"; }
  function extIp(s) { if (s.spec.type === "LoadBalancer") { var i = (s.status.loadBalancer || {}).ingress; return i && i.length ? i.map(function (x) { return x.ip; }).join(",") : "<pending>"; } if (s.spec.type === "ExternalName") return s.spec.externalName; return "<none>"; }
  function epText(e) {
    var out = [];
    (e.subsets || []).forEach(function (s) { (s.addresses || []).forEach(function (a) { (s.ports || []).forEach(function (p) { out.push(a.ip + ":" + p.port); }); }); });
    if (!out.length) return "<none>";
    return out.length > 3 ? out.slice(0, 3).join(",") + " + " + (out.length - 3) + " more..." : out.join(",");
  }
  kc.epText = epText;
  function modes(a) { return (a || []).map(function (m) { return { ReadWriteOnce: "RWO", ReadOnlyMany: "ROX", ReadWriteMany: "RWX", ReadWriteOncePod: "RWOP" }[m] || m; }).join(","); }
  function nodeStatus(n) { var r = n.status.conditions.some(function (c) { return c.type === "Ready" && c.status === "True"; }) ? "Ready" : "NotReady"; return r + (n.spec.unschedulable ? ",SchedulingDisabled" : ""); }
  function nodeRoles(n) { var r = Object.keys(n.metadata.labels).filter(function (l) { return l.indexOf("node-role.kubernetes.io/") === 0; }).map(function (l) { return l.split("/")[1]; }); return r.join(",") || "<none>"; }
  kc.nodeStatus = nodeStatus; kc.nodeRoles = nodeRoles;
  function jobDuration(sim, j) { var st = j.status; if (st._start == null) return ""; return U.age((st._end != null ? st._end : sim.now) - st._start); }
  function jobStatus(j) { var c = j.status.conditions || []; return c.some(function (x) { return x.type === "Complete" && x.status === "True"; }) ? "Complete" : c.some(function (x) { return x.type === "Failed" && x.status === "True"; }) ? "Failed" : j.spec.suspend ? "Suspended" : "Running"; }
  function quotaCols(q) {
    var hard = (q.spec || {}).hard || {}, used = (q.status || {}).used || {}, req = [], lim = [];
    Object.keys(hard).sort().forEach(function (k) { (/^limits\./.test(k) ? lim : req).push(k + ": " + (used[k] == null ? "0" : used[k]) + "/" + hard[k]); });
    return [req.join(", "), lim.join(", ")];
  }
  var P = kc.printers = {
    Pod: { cols: ["NAME", "READY", "STATUS", "RESTARTS", "AGE"], wide: ["IP", "NODE", "NOMINATED NODE", "READINESS GATES"], row: function (sim, p) { var s = podState(sim, p); return [p.metadata.name, s.ready, s.status, s.restarts, age(sim, p)]; }, wrow: function (sim, p) { return [p.status.podIP || "<none>", p.spec.nodeName || "<none>", "<none>", "<none>"]; } },
    Deployment: { cols: ["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"], row: function (sim, d) { var s = d.status; return [d.metadata.name, (s.readyReplicas || 0) + "/" + d.spec.replicas, s.updatedReplicas || 0, s.availableReplicas || 0, age(sim, d)]; }, wrow: function (sim, d) { return [conts(d.spec.template), images(d.spec.template), K8.selText(d.spec.selector)]; } },
    ReplicaSet: { cols: ["NAME", "DESIRED", "CURRENT", "READY", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"], row: function (sim, r) { var s = r.status || {}; return [r.metadata.name, r.spec.replicas, s.replicas || 0, s.readyReplicas || 0, age(sim, r)]; }, wrow: function (sim, d) { return [conts(d.spec.template), images(d.spec.template), K8.selText(d.spec.selector)]; } },
    StatefulSet: { cols: ["NAME", "READY", "AGE"], wide: ["CONTAINERS", "IMAGES"], row: function (sim, s) { return [s.metadata.name, ((s.status || {}).readyReplicas || 0) + "/" + s.spec.replicas, age(sim, s)]; }, wrow: function (sim, d) { return [conts(d.spec.template), images(d.spec.template)]; } },
    DaemonSet: { cols: ["NAME", "DESIRED", "CURRENT", "READY", "UP-TO-DATE", "AVAILABLE", "NODE SELECTOR", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"], row: function (sim, d) { var s = d.status || {}; return [d.metadata.name, s.desiredNumberScheduled || 0, s.currentNumberScheduled || 0, s.numberReady || 0, s.updatedNumberScheduled || 0, s.numberAvailable || 0, K8.selText(d.spec.template.spec.nodeSelector), age(sim, d)]; }, wrow: function (sim, d) { return [conts(d.spec.template), images(d.spec.template), K8.selText(d.spec.selector)]; } },
    Service: { cols: ["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"], wide: ["SELECTOR"], row: function (sim, s) { return [s.metadata.name, s.spec.type, s.spec.clusterIP || "<none>", extIp(s), svcPorts(s), age(sim, s)]; }, wrow: function (sim, s) { return [K8.selText(s.spec.selector)]; } },
    Endpoints: { cols: ["NAME", "ENDPOINTS", "AGE"], row: function (sim, e) { return [e.metadata.name, epText(e), age(sim, e)]; } },
    Node: { cols: ["NAME", "STATUS", "ROLES", "AGE", "VERSION"], wide: ["INTERNAL-IP", "EXTERNAL-IP", "OS-IMAGE", "KERNEL-VERSION", "CONTAINER-RUNTIME"], row: function (sim, n) { return [n.metadata.name, nodeStatus(n), nodeRoles(n), age(sim, n), n.status.nodeInfo.kubeletVersion]; }, wrow: function (sim, n) { var i = n.status.nodeInfo; return [n.status.addresses[0].address, "<none>", i.osImage, i.kernelVersion, i.containerRuntimeVersion]; } },
    Namespace: { cols: ["NAME", "STATUS", "AGE"], row: function (sim, n) { return [n.metadata.name, n.metadata.deletionTimestamp ? "Terminating" : "Active", age(sim, n)]; } },
    ConfigMap: { cols: ["NAME", "DATA", "AGE"], row: function (sim, c) { return [c.metadata.name, Object.keys(c.data || {}).length, age(sim, c)]; } },
    Secret: { cols: ["NAME", "TYPE", "DATA", "AGE"], row: function (sim, c) { return [c.metadata.name, c.type, Object.keys(c.data || {}).length, age(sim, c)]; } },
    ServiceAccount: { cols: ["NAME", "SECRETS", "AGE"], row: function (sim, c) { return [c.metadata.name, 0, age(sim, c)]; } },
    Ingress: { cols: ["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"], row: function (sim, i) { var hosts = (i.spec.rules || []).map(function (r) { return r.host || "*"; }); return [i.metadata.name, i.spec.ingressClassName || "<none>", hosts.join(",") || "*", (((i.status || {}).loadBalancer || {}).ingress || []).map(function (x) { return x.ip; }).join(","), i.spec.tls ? "80, 443" : "80", age(sim, i)]; } },
    IngressClass: { cols: ["NAME", "CONTROLLER", "PARAMETERS", "AGE"], row: function (sim, i) { return [i.metadata.name, i.spec.controller, "<none>", age(sim, i)]; } },
    PersistentVolumeClaim: { cols: ["NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "VOLUMEATTRIBUTESCLASS", "AGE"], wide: ["VOLUMEMODE"], row: function (sim, c) { var b = c.status.phase === "Bound"; return [c.metadata.name, c.metadata.deletionTimestamp ? "Terminating" : c.status.phase, c.spec.volumeName || "", b ? c.status.capacity.storage : "", b ? modes(c.status.accessModes) : "", c.spec.storageClassName || "", "<unset>", age(sim, c)]; }, wrow: function (sim, c) { return [c.spec.volumeMode]; } },
    PersistentVolume: { cols: ["NAME", "CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "STORAGECLASS", "VOLUMEATTRIBUTESCLASS", "REASON", "AGE"], row: function (sim, v) { return [v.metadata.name, v.spec.capacity.storage, modes(v.spec.accessModes), v.spec.persistentVolumeReclaimPolicy, v.status.phase, v.spec.claimRef ? v.spec.claimRef.namespace + "/" + v.spec.claimRef.name : "", v.spec.storageClassName || "", "<unset>", "", age(sim, v)]; } },
    StorageClass: { cols: ["NAME", "PROVISIONER", "RECLAIMPOLICY", "VOLUMEBINDINGMODE", "ALLOWVOLUMEEXPANSION", "AGE"], row: function (sim, c) { return [c.metadata.name + ((c.metadata.annotations || {})["storageclass.kubernetes.io/is-default-class"] === "true" ? " (default)" : ""), c.provisioner, c.reclaimPolicy || "Delete", c.volumeBindingMode || "Immediate", String(!!c.allowVolumeExpansion), age(sim, c)]; } },
    Job: { cols: ["NAME", "STATUS", "COMPLETIONS", "DURATION", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"], row: function (sim, j) { return [j.metadata.name, jobStatus(j), (j.status.succeeded || 0) + "/" + (j.spec.completions == null ? 1 : j.spec.completions), jobDuration(sim, j), age(sim, j)]; }, wrow: function (sim, j) { return [conts(j.spec.template), images(j.spec.template), "batch.kubernetes.io/controller-uid=" + j.metadata.uid]; } },
    CronJob: { cols: ["NAME", "SCHEDULE", "TIMEZONE", "SUSPEND", "ACTIVE", "LAST SCHEDULE", "AGE"], row: function (sim, c) { var act = sim.k8s.owned(c, "Job").filter(function (j) { return jobStatus(j) === "Running"; }).length; return [c.metadata.name, c.spec.schedule, c.spec.timeZone || "<none>", c.spec.suspend ? "True" : "False", act, c.status && c.status._last != null ? U.age(sim.now - c.status._last) : "<none>", age(sim, c)]; } },
    Event: { cols: ["LAST SEEN", "TYPE", "REASON", "OBJECT", "MESSAGE"], row: function (sim, e) { return [U.age(sim.now - e._last), e.type, e.reason, e.involvedObject.kind.toLowerCase() + "/" + e.involvedObject.name, e.message]; } },
    Role: { cols: ["NAME", "CREATED AT"], row: function (sim, r) { return [r.metadata.name, r.metadata.creationTimestamp]; } },
    ClusterRole: { cols: ["NAME", "CREATED AT"], row: function (sim, r) { return [r.metadata.name, r.metadata.creationTimestamp]; } },
    RoleBinding: { cols: ["NAME", "ROLE", "AGE"], wide: ["USERS", "GROUPS", "SERVICEACCOUNTS"], row: function (sim, r) { return [r.metadata.name, r.roleRef.kind + "/" + r.roleRef.name, age(sim, r)]; }, wrow: bindingSubjects },
    ClusterRoleBinding: { cols: ["NAME", "ROLE", "AGE"], wide: ["USERS", "GROUPS", "SERVICEACCOUNTS"], row: function (sim, r) { return [r.metadata.name, r.roleRef.kind + "/" + r.roleRef.name, age(sim, r)]; }, wrow: bindingSubjects },
    NetworkPolicy: { cols: ["NAME", "POD-SELECTOR", "AGE"], row: function (sim, n) { return [n.metadata.name, K8.selText(n.spec.podSelector), age(sim, n)]; } },
    ResourceQuota: { cols: ["NAME", "REQUEST", "LIMIT", "AGE"], row: function (sim, q) { var c = quotaCols(q); return [q.metadata.name, c[0], c[1], age(sim, q)]; } },
    LimitRange: { cols: ["NAME", "CREATED AT"], row: function (sim, r) { return [r.metadata.name, r.metadata.creationTimestamp]; } },
    Application: { cols: ["NAME", "SYNC STATUS", "HEALTH STATUS"], row: function (sim, a) { var s = a.status || {}; return [a.metadata.name, (s.sync || {}).status || "", (s.health || {}).status || ""]; } },
    AppProject: { cols: ["NAME", "AGE"], row: function (sim, a) { return [a.metadata.name, age(sim, a)]; } }
  };
  function bindingSubjects(sim, r) { var s = r.subjects || [], pick = function (k) { return s.filter(function (x) { return x.kind === k; }).map(function (x) { return (k === "ServiceAccount" ? (x.namespace || r.metadata.namespace) + "/" : "") + x.name; }).join(", "); }; return [pick("User"), pick("Group"), pick("ServiceAccount")]; }
  function generic(sim, o) { return [o.metadata.name, age(sim, o)]; }

  /* ---------- jsonpath ---------- */
  function jpPath(expr) {
    var steps = [], i = 0, m;
    expr = expr.trim().replace(/^\$/, "");
    while (i < expr.length) {
      var rest = expr.slice(i);
      if ((m = /^\.\.?((?:[\w-]|\\.)+)/.exec(rest))) { steps.push({ key: m[1].replace(/\\(.)/g, "$1") }); i += m[0].length; }
      else if ((m = /^\['([^']+)'\]/.exec(rest)) || (m = /^\["([^"]+)"\]/.exec(rest))) { steps.push({ key: m[1] }); i += m[0].length; }
      else if ((m = /^\[\*\]/.exec(rest)) || (m = /^\.\*/.exec(rest))) { steps.push({ all: true }); i += m[0].length; }
      else if ((m = /^\[(-?\d+)\]/.exec(rest))) { steps.push({ idx: +m[1] }); i += m[0].length; }
      else if ((m = /^\[(-?\d*):(-?\d*)\]/.exec(rest))) { steps.push({ slice: [m[1], m[2]] }); i += m[0].length; }
      else if ((m = /^\[\?\(\s*@\.([\w.-]+)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)'|([\w.-]+))\s*\)\]/.exec(rest))) { steps.push({ filter: { path: m[1].split("."), op: m[2], val: m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] } }); i += m[0].length; }
      else if (rest === "." || rest === "@") { i += 1; }
      else if (rest[0] === "@") i += 1;
      else throw kerr("error: error parsing jsonpath {" + expr + "}, unrecognized character in action: " + JSON.stringify(rest[0]));
    }
    return steps;
  }
  function jpEval(roots, steps) {
    var cur = roots;
    steps.forEach(function (s) {
      var next = [];
      cur.forEach(function (v) {
        if (v == null) return;
        if (s.key != null) { if (typeof v === "object" && v[s.key] !== undefined) next.push(v[s.key]); }
        else if (s.all) { (Array.isArray(v) ? v : Object.keys(v).map(function (k) { return v[k]; })).forEach(function (x) { next.push(x); }); }
        else if (s.idx != null) { if (Array.isArray(v)) { var x = v[s.idx < 0 ? v.length + s.idx : s.idx]; if (x !== undefined) next.push(x); else throw kerr("error: error executing jsonpath: Error executing template: array index out of bounds: index " + s.idx + ", length " + v.length); } }
        else if (s.slice) { if (Array.isArray(v)) v.slice(s.slice[0] === "" ? 0 : +s.slice[0], s.slice[1] === "" ? undefined : +s.slice[1]).forEach(function (x) { next.push(x); }); }
        else if (s.filter) { (Array.isArray(v) ? v : []).forEach(function (x) { var y = x; s.filter.path.forEach(function (p) { y = y == null ? undefined : y[p]; }); var hit = String(y) === s.filter.val; if (s.filter.op === "==" ? hit : !hit) next.push(x); }); }
      });
      cur = next;
    });
    return cur;
  }
  function jpStr(v) { return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); }
  function jsonpath(tpl, data) {
    var out = "", i = 0, stack = [{ data: [data], out: null }];
    tpl = tpl.replace(/^'|'$/g, "");
    function emit(t) { var top = stack[stack.length - 1]; if (top.buf != null) top.buf.push(t); else out += t; }
    var parts = [], m, re = /\{([^{}]*)\}/g, last = 0;
    while ((m = re.exec(tpl))) { if (m.index > last) parts.push({ text: tpl.slice(last, m.index) }); parts.push({ act: m[1].trim() }); last = re.lastIndex; }
    if (last < tpl.length) parts.push({ text: tpl.slice(last) });
    if (!parts.some(function (p) { return p.act != null; })) return tpl;
    function run(list, root) {
      var res = "";
      for (var n = 0; n < list.length; n++) {
        var p = list[n];
        if (p.text != null) { res += p.text; continue; }
        var a = p.act, sm;
        if ((sm = /^"((?:[^"\\]|\\.)*)"$/.exec(a)) || (sm = /^'((?:[^'\\]|\\.)*)'$/.exec(a))) { res += sm[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t"); continue; }
        if (/^range\b/.test(a)) {
          var depth = 1, e = n + 1;
          while (e < list.length && depth) { if (list[e].act != null && /^range\b/.test(list[e].act)) depth++; else if (list[e].act === "end") depth--; e++; }
          var body = list.slice(n + 1, e - 1), items = jpEval([root], jpPath(a.replace(/^range\s*/, "")));
          items.forEach(function (it) { res += run(body, it); });
          n = e - 1; continue;
        }
        if (a === "end") continue;
        res += jpEval([root], jpPath(a)).map(jpStr).join(" ");
      }
      return res;
    }
    return run(parts, data);
  }
  kc.jsonpath = jsonpath;

  function output(io, sim, f, objs, k, single) {
    var o = f.output || "";
    if (o === "yaml" || o === "json") {
      var data = single ? clean(objs[0]) : { apiVersion: "v1", items: objs.map(clean), kind: "List", metadata: { resourceVersion: "" } };
      io.out(o === "yaml" ? S.yamlDump(data, true) : JSON.stringify(sortObj(data), null, 4) + "\n");
      return true;
    }
    if (/^jsonpath(-as-json)?=/.test(o)) { io.out(jsonpath(o.replace(/^jsonpath(-as-json)?=/, ""), single ? clean(objs[0]) : { apiVersion: "v1", kind: "List", items: objs.map(clean) })); return true; }
    if (/^custom-columns=/.test(o)) {
      var cols = o.slice(15).split(",").map(function (c) { var i = c.indexOf(":"); return [c.slice(0, i), c.slice(i + 1)]; });
      var rows = objs.map(function (x) { return cols.map(function (c) { var v = jpEval([clean(x)], jpPath(c[1].replace(/^\{|\}$/g, ""))); return v.length ? v.map(jpStr).join(",") : "<none>"; }); });
      io.out(U.table((f["no-headers"] ? [] : [cols.map(function (c) { return c[0]; })]).concat(rows)) + "\n");
      return true;
    }
    if (o === "name") { if (objs.length) io.out(objs.map(function (x) { return ref(BY_KIND[x.kind], x); }).join("\n") + "\n"); return true; }
    if (o && o !== "wide") throw kerr("error: unable to match a printer suitable for the output format \"" + o + "\", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,name,template,templatefile,wide,yaml");
    return false;
  }
  kc.output = output;
  function sortObj(o) { if (Array.isArray(o)) return o.map(sortObj); if (o && typeof o === "object") { var r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = sortObj(o[k]); }); return r; } return o; }

  function rowsFor(sim, k, objs, f, prefix, withNs) {
    var pr = P[k.kind] || { cols: ["NAME", "AGE"], row: generic }, wide = f.output === "wide";
    var head = (withNs ? ["NAMESPACE"] : []).concat(pr.cols, wide && pr.wide ? pr.wide : [], (f["label-columns"] || []).join(",").split(",").filter(Boolean).map(function (l) { return l.split("/").pop().toUpperCase(); }), f["show-labels"] ? ["LABELS"] : []);
    var rows = objs.map(function (o) {
      var r = pr.row(sim, o); r[0] = (prefix ? k.singular + (k.group ? "." + k.group : "") + "/" : "") + r[0];
      if (wide && pr.wrow) r = r.concat(pr.wrow(sim, o));
      (f["label-columns"] || []).join(",").split(",").filter(Boolean).forEach(function (l) { r.push((o.metadata.labels || {})[l] || ""); });
      if (f["show-labels"]) r.push(Object.keys(o.metadata.labels || {}).map(function (l) { return l + "=" + o.metadata.labels[l]; }).join(",") || "<none>");
      return (withNs ? [o.metadata.namespace] : []).concat(r);
    });
    return { head: head, rows: rows };
  }
  function fieldMatch(o, sel) {
    return sel.split(",").every(function (p) {
      var m = /^([\w.]+)(!=|==|=)(.*)$/.exec(p.trim()); if (!m) throw kerr("error: invalid field selector \"" + p + "\"");
      var v = o; m[1].split(".").forEach(function (key) { v = v == null ? undefined : v[key]; });
      return (String(v == null ? "" : v) === m[3]) === (m[2] !== "!=");
    });
  }

  var GET_SPEC = spec({ cmd: "get", str: "o output l selector field-selector sort-by L label-columns chunk-size", bool: "w watch show-labels no-headers watch-only show-kind ignore-not-found show-managed-fields R recursive", multi: "f filename L label-columns", alias: { o: "output", l: "selector", w: "watch", f: "filename", L: "label-columns" } });
  function collect(c, targets, f) {
    var K = c.K, sim = c.sim, groups = [];
    var sel = f.selector ? K8.parseSelector(f.selector) : null;
    targets.forEach(function (t) {
      var k = t.k, ns = k.namespaced ? (c.all ? null : c.ns) : null, objs;
      if (t.names.length) {
        if (c.all && k.namespaced) throw kerr("error: a resource cannot be retrieved by name across all namespaces");
        objs = [];
        t.names.forEach(function (n) { c.can("get", k, ns, n); var o = K.get(k.kind, ns, n); if (!o) { if (!f["ignore-not-found"]) throw notFound(k, n); } else objs.push(o); });
      } else {
        try { c.can("list", k, ns, null); } catch (e) { if (t.viaAll) return; throw e; }
        objs = K.list(k.kind, ns, sel);
        if (f["field-selector"]) objs = objs.filter(function (o) { return fieldMatch(o, f["field-selector"]); });
        objs.sort(function (a, b) { return (a.metadata.namespace || "") < (b.metadata.namespace || "") ? -1 : (a.metadata.namespace || "") > (b.metadata.namespace || "") ? 1 : k.kind === "Event" ? a._last - b._last : a.metadata.name < b.metadata.name ? -1 : 1; });
      }
      if (f["sort-by"]) { var steps = jpPath(f["sort-by"].replace(/^\{|\}$/g, "")); var key = function (o) { var v = jpEval([o], steps)[0]; return v == null ? "" : v; }; objs.sort(function (a, b) { var x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; }); }
      groups.push({ k: k, objs: objs, named: t.names.length > 0, viaAll: t.viaAll });
    });
    return groups;
  }
  function tableText(sim, groups, f, c, multi) {
    var parts = [];
    groups.forEach(function (gp) {
      if (!gp.objs.length) return;
      var t = rowsFor(sim, gp.k, gp.objs, f, multi || f["show-kind"], c.all && gp.k.namespaced);
      parts.push(U.table((f["no-headers"] ? [] : [t.head]).concat(t.rows)));
    });
    return parts.join("\n\n");
  }
  cmds.get = async function (a, io, sim) {
    var f = U.flags(a, GET_SPEC), c = ctx(sim, f);
    if (f.filename) { var docs = kc.readManifests(sim, f.filename, sim.scope(), io); f._ = docs.map(function (d) { var k = c.K.prepare(d.obj, d.file); return k.singular + "/" + d.obj.metadata.name; }); }
    if (!f._.length) throw kerr("You must specify the type of resource to get. Use \"kubectl api-resources\" for a complete list of supported resources.\n\nerror: Required resource not specified.\nUse \"kubectl explain <resource>\" for a detailed description of that resource (e.g. kubectl explain pods).\nSee 'kubectl get -h' for help and examples");
    var targets = parseTargets(f._), groups = collect(c, targets, f), all = [], multi = targets.length > 1;
    groups.forEach(function (gp) { all = all.concat(gp.objs); });
    var single = targets.length === 1 && targets[0].names.length === 1 && all.length === 1;
    if (output(io, sim, f, all, targets[0].k, single)) return 0;
    if (!all.length) { if (!f["ignore-not-found"]) io.err("No resources found" + (targets.some(function (t) { return t.k.namespaced; }) && !c.all ? " in " + c.ns + " namespace" : "") + ".\n"); return 0; }
    var text = tableText(sim, groups, f, c, multi);
    io.out(text + "\n");
    if (f.watch) {
      var seen = {}, limit = sim.realtime ? Infinity : 15;
      text.split("\n").forEach(function (l) { seen[l] = 1; });
      try {
        while (limit-- > 0) {
          await sim.wait(1000);
          var f2 = Object.assign({}, f, { "no-headers": true }), t2 = tableText(sim, collect(c, targets, Object.assign({}, f, { "ignore-not-found": true })), f2, c, multi);
          var fresh = t2.split("\n").filter(function (l) { return l && !seen[l.replace(/\s+\S+$/, "")] && !seen[l]; });
          t2.split("\n").forEach(function (l) { seen[l] = 1; seen[l.replace(/\s+\S+$/, "")] = 1; });
          if (fresh.length) io.out(fresh.join("\n") + "\n");
        }
      } catch (e) { if (!(e instanceof CmdError) || e.code !== 130) throw e; return 0; }
    }
    return 0;
  };

  /* ---------- manifests ---------- */
  function yamlError(e, file) {
    var line = e.mark ? e.mark.line + 1 : 1, r = e.reason || e.message || "";
    var msg = /bad indentation of a mapping entry/.test(r) ? "did not find expected key" : /bad indentation of a sequence entry/.test(r) ? "did not find expected '-' indicator"
      : /multiline key|implicit key|can not read a block mapping entry/.test(r) ? "mapping values are not allowed in this context" : /tab characters/.test(r) ? "found character that cannot start any token"
      : /duplicated mapping key/.test(r) ? "mapping key \"" + ((/key \"?([^\"]*)\"?/.exec(e.message) || [])[1] || "") + "\" already defined" : /end of the stream or a document separator/.test(r) ? "did not find expected <document start>"
      : /unexpected end of the stream within a (double|single) quoted scalar/.test(r) ? "found unexpected end of stream" : /missed comma between flow collection entries/.test(r) ? "did not find expected ',' or ']'" : "could not find expected ':'";
    return kerr("error: error parsing " + file + ": error converting YAML to JSON: yaml: line " + line + ": " + msg);
  }
  kc.yamlError = yamlError;
  kc.parseDocs = function (text, file) {
    var docs;
    try { docs = S.YAML.loadAll(text); } catch (e) { throw yamlError(e, file); }
    var out = [];
    docs.forEach(function (d) { if (d == null) return; if (d.kind === "List" && Array.isArray(d.items)) d.items.forEach(function (i) { out.push({ obj: i, file: file }); }); else out.push({ obj: d, file: file }); });
    return out;
  };
  kc.readManifests = function (sim, files, sc, io, recursive) {
    var out = [];
    (Array.isArray(files) ? files : [files]).forEach(function (fn) {
      if (fn === "-") { if (io.stdin == null) throw kerr("error: no objects passed to apply"); out = out.concat(kc.parseDocs(io.stdin, "STDIN")); return; }
      if (/^https?:\/\//.test(fn)) throw kerr("error: unable to read URL \"" + fn + "\", server reported 000, status code=000 (the sandbox has no internet access; manifests must be local files)");
      var p = U.norm(fn, sc.cwd);
      if (sc.fs.isDir(p)) {
        var names = S.docker.walk(sc.fs, p).filter(function (e) { return /\.(ya?ml|json)$/.test(e[0]) && (recursive || e[0].indexOf("/") < 0); });
        if (!names.length) throw kerr("error: error reading [" + fn + "]: recognized file extensions are [.json .yaml .yml]");
        names.forEach(function (e) { out = out.concat(kc.parseDocs(e[1], (fn.replace(/\/$/, "") + "/" + e[0]))); });
        return;
      }
      var text = sc.fs.read(p);
      if (text == null) throw kerr("error: the path \"" + fn + "\" does not exist");
      out = out.concat(kc.parseDocs(text, fn));
    });
    return out;
  };
  var LAST = "kubectl.kubernetes.io/last-applied-configuration";
  function merge3(last, want, live) {   // simplified three-way merge used by `kubectl apply`
    if (want === undefined) return undefined;
    if (!want || typeof want !== "object" || Array.isArray(want) || !live || typeof live !== "object" || Array.isArray(live)) return U.clone(want);
    var out = {}, l = last && typeof last === "object" && !Array.isArray(last) ? last : {};
    Object.keys(live).forEach(function (k) { if (!(k in want) && !(k in l)) out[k] = live[k]; });
    Object.keys(want).forEach(function (k) { out[k] = merge3(l[k], want[k], live[k]); });
    return out;
  }
  kc.applyOne = function (c, obj, file, opts) {
    opts = opts || {};
    var K = c.K, k;
    if (obj && obj.metadata && !obj.metadata.namespace && K8.BY_KIND[obj.kind] && K8.BY_KIND[obj.kind].namespaced) obj.metadata.namespace = c.ns;
    k = K.prepare(obj, file);
    if (c.f.namespace && k.namespaced) { if (obj._nsFromFile && obj.metadata.namespace !== c.f.namespace) throw kerr("error: the namespace from the provided object \"" + obj.metadata.namespace + "\" does not match the namespace \"" + c.f.namespace + "\". You must pass '--namespace=" + obj.metadata.namespace + "' to perform this operation."); obj.metadata.namespace = c.f.namespace; }
    var ns = k.namespaced ? obj.metadata.namespace : null, name = obj.metadata.name, where = file ? "error when " + (opts.create ? "creating" : "creating") + " \"" + file + "\": " : "";
    if (!name && !obj.metadata.generateName) throw kerr("error: error validating \"" + file + "\": error validating data: metadata.name: Required value: name is required");
    var live = name ? K.get(k.kind, ns, name) : null, id = ref(k, obj);
    var dry = c.f["dry-run"] && c.f["dry-run"] !== "none" ? " (" + (c.f["dry-run"] === "server" ? "server dry run" : "dry run") + ")" : "";
    try {
      if (!live) {
        c.can("create", k, ns, name);
        var fresh = U.clone(obj);
        if (!opts.create) { fresh.metadata.annotations = Object.assign({}, fresh.metadata.annotations); fresh.metadata.annotations[LAST] = JSON.stringify(sortObj(clean(obj))) + "\n"; }
        if (dry) { var probe = U.clone(fresh); K.validate(probe, k, null); if (k.namespaced && !K.get("Namespace", null, ns)) throw K8.apiError("NotFound", "namespaces \"" + ns + "\" not found"); return ref(k, obj) + " created" + dry; }
        K.create(fresh);
        return ref(k, fresh) + " created";
      }
      if (opts.create) throw K8.apiError("AlreadyExists", K8.qual(k) + " \"" + name + "\" already exists");
      c.can("patch", k, ns, name);
      var lastTxt = (live.metadata.annotations || {})[LAST], last = null, warn = "";
      if (lastTxt) { try { last = JSON.parse(lastTxt); } catch (e) { last = null; } }
      else warn = "Warning: resource " + k.plural + "/" + name + " is missing the " + LAST + " annotation which is required by kubectl apply. kubectl apply should only be used on resources created declaratively by either kubectl create --save-config or kubectl apply. The missing annotation will be patched automatically.\n";
      var next = clean(live), liveClean = clean(live);
      ["spec", "data", "rules", "subjects", "roleRef", "type", "provisioner", "reclaimPolicy", "volumeBindingMode"].forEach(function (key) {
        if (obj[key] !== undefined || (last && last[key] !== undefined)) { var m = merge3(last ? last[key] : undefined, obj[key], liveClean[key]); if (m === undefined) delete next[key]; else next[key] = m; }
      });
      if (obj.stringData) next.stringData = obj.stringData;
      ["labels", "annotations"].forEach(function (key) {
        var m = merge3(last ? (last.metadata || {})[key] : undefined, obj.metadata[key] || {}, liveClean.metadata[key] || {});
        if (m && Object.keys(m).length) next.metadata[key] = m; else delete next.metadata[key];
      });
      next.metadata.annotations = next.metadata.annotations || {};
      next.metadata.annotations[LAST] = JSON.stringify(sortObj(clean(obj))) + "\n";
      next.status = live.status; next.metadata._created = live.metadata._created;
      var probe2 = U.clone(next); probe2.status = live.status;
      K.validate(probe2, k, live); K.applyDefaults(probe2);
      var same = K8.eq(clean({ s: probe2.spec, d: probe2.data, r: probe2.rules, sub: probe2.subjects, l: probe2.metadata.labels, a: stripLast(probe2.metadata.annotations) }), clean({ s: live.spec, d: live.data, r: live.rules, sub: live.subjects, l: live.metadata.labels, a: stripLast(live.metadata.annotations) }));
      if (dry) return warn + id + (same ? " unchanged" : " configured") + dry;
      if (same) { live.metadata.annotations = next.metadata.annotations; return warn + id + " unchanged"; }
      Object.keys(live).forEach(function (key) { if (key[0] === "_") next[key] = live[key]; });
      K.update(next, live);
      return warn + id + " configured";
    } catch (e) {
      if (e instanceof CmdError && e.status) {
        if (e.status === "Invalid" && /^The /.test(e.message)) throw kerr(e.message);
        if (/^error:/.test(e.message)) throw kerr(e.message);
        throw kerr("Error from server (" + e.status + "): " + (file ? "error when " + (live ? "applying patch to" : "creating") + " \"" + file + "\": " : "") + e.message);
      }
      throw e;
    }
  };
  function stripLast(a) { var o = Object.assign({}, a); delete o[LAST]; delete o["deployment.kubernetes.io/revision"]; return o; }

  var APPLY_SPEC = spec({ cmd: "apply", str: "dry-run o output l selector field-manager validate cascade", bool: "R recursive force server-side prune wait overwrite save-config force-conflicts", multi: "f filename k kustomize", alias: { f: "filename", o: "output", R: "recursive", k: "kustomize" } });
  function applyLike(create) {
    return function (a, io, sim, sc) {
      var f = U.flags(a, APPLY_SPEC), c = ctx(sim, f), code = 0;
      if (f.kustomize) throw kerr("error: kustomize (-k) is not simulated in this sandbox; use -f with plain manifests");
      if (!f.filename) throw kerr("error: must specify one of -f and -k");
      var docs = kc.readManifests(sim, f.filename, sc, io, f.recursive);
      if (!docs.length) throw kerr("error: no objects passed to " + (create ? "create" : "apply"));
      docs.forEach(function (d) {
        try {
          if (d.obj && d.obj.metadata && d.obj.metadata.namespace) Object.defineProperty(d.obj, "_nsFromFile", { value: true, enumerable: false });
          var msg = kc.applyOne(c, d.obj, d.file, { create: create });
          if (f.output === "yaml") io.out(S.yamlDump(clean(d.obj), true)); else if (f.output === "name") io.out(msg.split(" ")[0] + "\n"); else io.out(msg + "\n");
        } catch (e) { if (!(e instanceof CmdError)) throw e; io.err(e.message + "\n"); code = 1; }
      });
      return code;
    };
  }
  cmds.apply = applyLike(false);

  /* ---------- create ---------- */
  function pairs(list, what) {
    var o = {};
    (list || []).forEach(function (kv) { var i = kv.indexOf("="); if (i < 1) throw kerr("error: invalid " + what + " " + kv + ", expected key=value"); o[kv.slice(0, i)] = kv.slice(i + 1); });
    return o;
  }
  function fromFiles(list, sc) {
    var o = {};
    (list || []).forEach(function (spec0) {
      var i = spec0.indexOf("="), key = i > 0 ? spec0.slice(0, i) : null, path = U.norm(i > 0 ? spec0.slice(i + 1) : spec0, sc.cwd);
      if (sc.fs.isDir(path)) { sc.fs.list(path).forEach(function (n) { var c = sc.fs.read(path + "/" + n); if (c != null) o[n] = c; }); return; }
      var c = sc.fs.read(path);
      if (c == null) throw kerr("error: error reading " + (i > 0 ? spec0.slice(i + 1) : spec0) + ": no such file or directory");
      o[key || U.basename(path)] = c;
    });
    return o;
  }
  function envFile(list, sc) {
    var o = {};
    (list || []).forEach(function (fn) { var c = sc.fs.read(U.norm(fn, sc.cwd)); if (c == null) throw kerr("error: open " + fn + ": no such file or directory"); S.lines(c).forEach(function (l) { l = l.trim(); if (!l || l[0] === "#") return; var i = l.indexOf("="); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); }); });
    return o;
  }
  var GEN = spec({ cmd: "create", str: "image replicas port dry-run o output type schedule from role clusterrole serviceaccount hard class restart docker-server docker-username docker-password docker-email save-config cert key default-backend field-manager validate annotation",
    bool: "command", multi: "from-literal from-file from-env-file tcp verb resource resource-name user group rule serviceaccount f filename env l labels", alias: { o: "output", f: "filename", r: "replicas", l: "labels" } });
  GEN.str += " r";
  function finish(c, io, obj, f) {
    obj.metadata = obj.metadata || {};
    if (!obj.metadata.namespace && K8.BY_KIND[obj.kind] && K8.BY_KIND[obj.kind].namespaced) obj.metadata.namespace = c.ns;
    var k = c.K.prepare(obj);
    if (f["dry-run"] && f["dry-run"] !== "none") {
      if (f.output === "yaml" || f.output === "json") { var d = clean(obj); if (k.namespaced && !f.namespace) delete d.metadata.namespace; d = stamp(d); io.out(f.output === "yaml" ? S.yamlDump(d, true) : JSON.stringify(sortObj(d), null, 4) + "\n"); return 0; }
      io.out(ref(k, obj) + " created (" + (f["dry-run"] === "server" ? "server dry run" : "dry run") + ")\n"); return 0;
    }
    c.can("create", k, k.namespaced ? obj.metadata.namespace : null, obj.metadata.name);
    try { c.K.create(obj); } catch (e) { throw fromServer(e); }
    if (f.output === "yaml") io.out(S.yamlDump(clean(obj), true)); else if (f.output === "name") io.out(ref(k, obj) + "\n"); else io.out(ref(k, obj) + " created\n");
    return 0;
  }
  kc.finish = finish;
  function stamp(d) {   // kubectl's generators emit empty creationTimestamp/status stanzas
    d.metadata = Object.assign({ creationTimestamp: null }, d.metadata);
    if (d.spec && d.spec.template) d.spec.template.metadata = Object.assign({ creationTimestamp: null }, d.spec.template.metadata);
    if (["Pod", "Deployment", "Job", "Service", "Namespace", "CronJob"].indexOf(d.kind) >= 0) d.status = d.kind === "Service" ? { loadBalancer: {} } : {};
    if (d.kind === "Deployment") d.spec.strategy = d.spec.strategy || {};
    return d;
  }
  var creators = {
    namespace: function (f, name) { return { apiVersion: "v1", kind: "Namespace", metadata: { name: name } }; },
    deployment: function (f, name, c, sc, rest) {
      if (!f.image) throw kerr("error: required flag(s) \"image\" not set");
      var cname = f.image.split("/").pop().split(/[:@]/)[0], cont = { name: cname, image: f.image, resources: {} };
      if (f.port) cont.ports = [{ containerPort: +f.port }];
      if (rest && rest.length) { if (f.command) cont.command = rest; else cont.command = rest; }
      return { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: name, labels: { app: name } }, spec: { replicas: +(f.replicas || f.r || 1), selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers: [cont] } } } };
    },
    configmap: function (f, name, c, sc) { var data = Object.assign({}, fromFiles(f["from-file"], sc), envFile(f["from-env-file"], sc), pairs(f["from-literal"], "literal source")); var o = { apiVersion: "v1", kind: "ConfigMap", metadata: { name: name } }; if (Object.keys(data).length) o.data = data; return o; },
    serviceaccount: function (f, name) { return { apiVersion: "v1", kind: "ServiceAccount", metadata: { name: name } }; },
    job: function (f, name, c, sc, rest) {
      if (f.from) {
        var m = /^cronjob(?:s|\.batch)?\/(.+)$/.exec(f.from); if (!m) throw kerr("error: from must be an existing cronjob");
        var cj = getOne(c, BY_KIND.CronJob, m[1]);
        return { apiVersion: "batch/v1", kind: "Job", metadata: { name: name, annotations: { "cronjob.kubernetes.io/instantiate": "manual" }, ownerReferences: [c.K.ownerRef(cj)] }, spec: U.clone(clean(cj.spec.jobTemplate.spec)) };
      }
      if (!f.image) throw kerr("error: required flag(s) \"image\" not set");
      var cont = { name: name, image: f.image, resources: {} }; if (rest && rest.length) cont.command = rest;
      return { apiVersion: "batch/v1", kind: "Job", metadata: { name: name }, spec: { template: { metadata: {}, spec: { containers: [cont], restartPolicy: "Never" } } } };
    },
    cronjob: function (f, name, c, sc, rest) {
      if (!f.image) throw kerr("error: required flag(s) \"image\" not set"); if (!f.schedule) throw kerr("error: required flag(s) \"schedule\" not set");
      var cont = { name: name, image: f.image, resources: {} }; if (rest && rest.length) cont.command = rest;
      return { apiVersion: "batch/v1", kind: "CronJob", metadata: { name: name }, spec: { schedule: f.schedule, jobTemplate: { metadata: { name: name }, spec: { template: { metadata: {}, spec: { containers: [cont], restartPolicy: f.restart || "OnFailure" } } } } } };
    },
    role: function (f, name) { return { apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", metadata: { name: name }, rules: rules(f) }; },
    clusterrole: function (f, name) { return { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: { name: name }, rules: rules(f) }; },
    rolebinding: function (f, name, c) { return binding("RoleBinding", f, name, c); },
    clusterrolebinding: function (f, name, c) { return binding("ClusterRoleBinding", f, name, c); },
    quota: function (f, name) { var hard = {}; (f.hard || "").split(",").filter(Boolean).forEach(function (kv) { var p = kv.split("="); hard[p[0]] = p[1]; }); return { apiVersion: "v1", kind: "ResourceQuota", metadata: { name: name }, spec: { hard: hard } }; },
    ingress: function (f, name) {
      var rulesBy = {}, order = [];
      (f.rule || []).forEach(function (r) {
        var m = /^([^/=]*)(\/[^=]*)?=([^:]+):(\w+)$/.exec(r); if (!m) throw kerr("error: rule " + r + " is invalid and should be in format host/path=svcname:svcport[,tls[=secret]]");
        var host = m[1], path = m[2] || "/", exact = !/\*$/.test(path);
        if (!rulesBy[host]) { rulesBy[host] = { http: { paths: [] } }; if (host) rulesBy[host].host = host; order.push(host); }
        rulesBy[host].http.paths.push({ path: path.replace(/\*$/, "") || "/", pathType: exact ? "Exact" : "Prefix", backend: { service: { name: m[3], port: /^\d+$/.test(m[4]) ? { number: +m[4] } : { name: m[4] } } } });
      });
      var o = { apiVersion: "networking.k8s.io/v1", kind: "Ingress", metadata: { name: name }, spec: { rules: order.map(function (h) { return rulesBy[h]; }) } };
      if (f["class"]) o.spec.ingressClassName = f["class"];
      return o;
    }
  };
  creators.ns = creators.namespace; creators.deploy = creators.deployment; creators.cm = creators.configmap; creators.sa = creators.serviceaccount; creators.cj = creators.cronjob; creators.resourcequota = creators.quota; creators.ing = creators.ingress;
  function rules(f) {
    if (!f.verb) throw kerr("error: at least one verb must be specified");
    if (!f.resource) throw kerr("error: at least one resource must be specified");
    var verbs = f.verb.join(",").split(","), by = {};
    f.resource.join(",").split(",").forEach(function (r) { var base = r.split("/")[0], k = kindOf(base.split(".")[0]), full = k.plural + (r.indexOf("/") > 0 ? "/" + r.split("/")[1] : ""); (by[k.group] = by[k.group] || []).push(full); });
    return Object.keys(by).map(function (grp) { var r = { apiGroups: [grp], resources: by[grp], verbs: verbs }; if (f["resource-name"]) r.resourceNames = f["resource-name"]; return r; });
  }
  function binding(kind, f, name, c) {
    if (!f.role && !f.clusterrole) throw kerr("error: exactly one of clusterrole or role must be specified");
    var subjects = [];
    (f.user || []).forEach(function (u) { subjects.push({ apiGroup: "rbac.authorization.k8s.io", kind: "User", name: u }); });
    (f.group || []).forEach(function (u) { subjects.push({ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: u }); });
    [].concat(f.serviceaccount || []).forEach(function (s) { var p = s.split(":"); if (p.length !== 2) throw kerr("error: serviceaccount must be <namespace>:<name>"); subjects.push({ kind: "ServiceAccount", name: p[1], namespace: p[0] }); });
    return { apiVersion: "rbac.authorization.k8s.io/v1", kind: kind, metadata: { name: name }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: f.clusterrole ? "ClusterRole" : "Role", name: f.clusterrole || f.role }, subjects: subjects };
  }
  cmds.create = function (a, io, sim, sc) {
    var f = U.flags(a, Object.assign({}, GEN, { multi: GEN.multi.replace(" serviceaccount", " serviceaccount") })), c = ctx(sim, f);
    if (f.filename) return applyLike(true)(a, io, sim, sc);
    var what = f._[0];
    if (!what) throw kerr("error: must specify one of -f and -k");
    var obj;
    if (what === "secret") {
      var st = f._[1], name = f._[2];
      if (!name) throw kerr("error: exactly one NAME is required, got 0\nSee 'kubectl create secret " + (st || "generic") + " -h' for help and examples");
      if (st === "generic") { var data = Object.assign({}, fromFiles(f["from-file"], sc), envFile(f["from-env-file"], sc), pairs(f["from-literal"], "literal source")), enc = {}; Object.keys(data).forEach(function (k) { enc[k] = U.b64e(data[k]); }); obj = { apiVersion: "v1", kind: "Secret", metadata: { name: name } }; if (Object.keys(enc).length) obj.data = enc; if (f.type) obj.type = f.type; }
      else if (st === "docker-registry") {
        if (!f["docker-username"] || !f["docker-password"]) throw kerr("error: either --from-file or the combination of --docker-username, --docker-password and --docker-server is required");
        var server = f["docker-server"] || "https://index.docker.io/v1/", auths = {}; auths[server] = { username: f["docker-username"], password: f["docker-password"], auth: U.b64e(f["docker-username"] + ":" + f["docker-password"]) }; if (f["docker-email"]) auths[server].email = f["docker-email"];
        obj = { apiVersion: "v1", kind: "Secret", metadata: { name: name }, type: "kubernetes.io/dockerconfigjson", data: { ".dockerconfigjson": U.b64e(JSON.stringify({ auths: auths })) } };
      } else if (st === "tls") obj = { apiVersion: "v1", kind: "Secret", metadata: { name: name }, type: "kubernetes.io/tls", data: { "tls.crt": U.b64e("(certificate)"), "tls.key": U.b64e("(key)") } };
      else throw kerr("error: unknown command \"" + st + "\" for \"kubectl create secret\"");
    } else if (what === "service" || what === "svc") {
      var type = { clusterip: "ClusterIP", nodeport: "NodePort", loadbalancer: "LoadBalancer" }[(f._[1] || "").toLowerCase()], sname = f._[2];
      if (!type || !sname) throw kerr("error: usage: kubectl create service clusterip|nodeport|loadbalancer NAME --tcp=port:targetPort");
      if (!f.tcp) throw kerr("error: at least one tcp port specifier must be provided");
      obj = { apiVersion: "v1", kind: "Service", metadata: { name: sname, labels: { app: sname } }, spec: { type: type, selector: { app: sname }, ports: f.tcp.map(function (t) { var p = t.split(":"); return { name: t.replace(":", "-"), port: +p[0], protocol: "TCP", targetPort: /^\d+$/.test(p[1] || p[0]) ? +(p[1] || p[0]) : p[1] }; }) } };
    } else {
      var mk = creators[what.toLowerCase()];
      if (!mk) throw kerr("error: unknown command \"" + what + "\" for \"kubectl create\"\n(simulated: namespace, deployment, configmap, secret, service, serviceaccount, job, cronjob, role, rolebinding, clusterrole, clusterrolebinding, quota, ingress, or -f FILE)");
      if (!f._[1]) throw kerr("error: exactly one NAME is required, got 0\nSee 'kubectl create " + what + " -h' for help and examples");
      obj = mk(f, f._[1], c, sc, f.rest);
    }
    return finish(c, io, obj, f);
  };

  /* ---------- delete ---------- */
  cmds["delete"] = async function (a, io, sim, sc) {
    var f = U.flags(a, spec({ cmd: "delete", str: "l selector grace-period cascade timeout field-selector o output dry-run", bool: "all force now ignore-not-found wait R recursive", multi: "f filename", alias: { f: "filename", l: "selector", o: "output", R: "recursive" } })), c = ctx(sim, f), K = c.K, code = 0, todo = [];
    if (f.filename) {
      kc.readManifests(sim, f.filename, sc, io, f.recursive).forEach(function (d) {
        try { var k = K.prepare(d.obj, d.file); if (f.namespace && k.namespaced) d.obj.metadata.namespace = f.namespace; var o = K.get(k.kind, d.obj.metadata.namespace, d.obj.metadata.name); if (!o) { if (!f["ignore-not-found"]) throw kerr("Error from server (NotFound): error when deleting \"" + d.file + "\": " + K8.qual(k) + " \"" + d.obj.metadata.name + "\" not found"); } else todo.push({ k: k, o: o }); }
        catch (e) { if (!(e instanceof CmdError)) throw e; io.err(e.message + "\n"); code = 1; }
      });
    } else {
      if (!f._.length) throw kerr("error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   '-f rsrc.yaml'\n   '--filename=rsrc.json'\n   '<resource> <name>'\n   '<resource>'");
      var targets = parseTargets(f._);
      targets.forEach(function (t) {
        var k = t.k, ns = k.namespaced ? (c.all ? null : c.ns) : null;
        if (t.names.length) t.names.forEach(function (n) { var o = K.get(k.kind, ns, n); if (!o) { if (!f["ignore-not-found"]) { io.err(notFound(k, n).message + "\n"); code = 1; } } else todo.push({ k: k, o: o }); });
        else if (f.all || f.selector) K.list(k.kind, ns, f.selector ? K8.parseSelector(f.selector) : null).forEach(function (o) { if (k.kind === "Service" && o.metadata.name === "kubernetes" && t.viaAll) return; todo.push({ k: k, o: o }); });
        else throw kerr("error: resource(s) were provided, but no name was specified");
      });
      if (!todo.length && !code && (f.all || f.selector)) { io.err("No resources found" + (c.all ? "" : " in " + c.ns + " namespace.") + "\n"); return 0; }
    }
    var pods = 0;
    todo.forEach(function (t) {
      try {
        c.can("delete", t.k, t.k.namespaced ? t.o.metadata.namespace : null, t.o.metadata.name);
        if (!K.get(t.k.kind, t.o.metadata.namespace, t.o.metadata.name)) return;   // already removed by cascade
        if (t.k.kind === "Namespace" && ["default", "kube-system", "kube-public", "kube-node-lease"].indexOf(t.o.metadata.name) >= 0) throw kerr("Error from server (Forbidden): namespaces \"" + t.o.metadata.name + "\" is forbidden: this namespace may not be deleted");
        if (f["dry-run"] && f["dry-run"] !== "none") { io.out(t.k.singular + (t.k.group ? "." + t.k.group : "") + " \"" + t.o.metadata.name + "\" deleted (dry run)\n"); return; }
        if (t.k.kind === "Pod") pods++;
        K.remove(t.o, { cascade: f.cascade === "orphan" || f.cascade === "false" ? false : true });
        io.out(t.k.singular + (t.k.group ? "." + t.k.group : "") + " \"" + t.o.metadata.name + "\" deleted" + (t.k.namespaced ? " from " + t.o.metadata.namespace + " namespace" : "") + "\n");
      } catch (e) { if (!(e instanceof CmdError)) throw e; io.err(e.message + "\n"); code = 1; }
    });
    if (pods && !f.force && !f.now && f["grace-period"] !== "0" && f.wait !== false) await sim.wait(1000);
    return code;
  };

  /* ---------- pods: resolve, logs, exec, run ---------- */
  kc.podFor = function (c, target, verb, sub) {   // "name", "pod/name", "deploy/name", "svc/name" ...
    var K = c.K, m = /^([^/]+)\/(.+)$/.exec(target), pk = BY_KIND.Pod;
    if (!m || BY_NAME[m[1].toLowerCase()] === pk) { var name = m ? m[2] : target; c.can(verb || "get", pk, c.ns, name, sub); var p = K.get("Pod", c.ns, name); if (!p) throw notFound(pk, name); return p; }
    var k = kindOf(m[1]), o = getOne(c, k, m[2]), sel = k.kind === "Service" ? o.spec.selector : k.kind === "Job" ? { matchLabels: { "job-name": o.metadata.name } } : o.spec.selector;
    if (!sel) throw kerr("error: cannot attach to " + k.kind + ": no selector");
    var pods = K.list("Pod", c.ns, sel).sort(function (x, y) { return (K8.isReady(y) ? 1 : 0) - (K8.isReady(x) ? 1 : 0) || x.metadata._created - y.metadata._created; });
    if (!pods.length) throw kerr("error: timed out waiting for the condition");
    c.can(verb || "get", pk, c.ns, pods[0].metadata.name, sub);
    pods[0]._picked = pods.length > 1 ? pods.length : 0;
    return pods[0];
  };
  function containerOf(c, pod, name, io) {
    var rt = c.K.rt.get(pod.metadata.uid), all = (pod.spec.initContainers || []).concat(pod.spec.containers);
    var def = (pod.metadata.annotations || {})["kubectl.kubernetes.io/default-container"];
    var cn = name || def || pod.spec.containers[0].name, spec0 = all.filter(function (x) { return x.name === cn; })[0];
    if (!spec0) throw kerr("Error from server (BadRequest): container " + cn + " is not valid for pod " + pod.metadata.name);
    if (!name && !def && pod.spec.containers.length > 1 && io) io.err("Defaulted container \"" + cn + "\" out of: " + all.map(function (x) { return x.name + ((pod.spec.initContainers || []).indexOf(x) >= 0 ? " (init)" : ""); }).join(", ") + "\n");
    var cs = rt ? rt.all().filter(function (x) { return x.name === cn; })[0] : null;
    return { spec: spec0, cs: cs, name: cn };
  }
  kc.containerOf = containerOf;
  cmds.logs = async function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "logs", str: "c container tail since since-time l selector max-log-requests limit-bytes", bool: "f follow p previous timestamps all-containers prefix ignore-errors all-pods", alias: { c: "container", f: "follow", p: "previous", l: "selector" } })), c = ctx(sim, f), K = c.K, pods;
    if (f.selector) { c.can("list", BY_KIND.Pod, c.ns); pods = K.list("Pod", c.ns, K8.parseSelector(f.selector)); if (!pods.length) { io.err("No resources found in " + c.ns + " namespace.\n"); return 0; } }
    else {
      if (!f._.length) throw kerr("error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command\nSee 'kubectl logs -h' for help and examples");
      pods = [kc.podFor(c, f._[0], "get", "log")];
      if (pods[0]._picked) io.err("Found " + pods[0]._picked + " pods, using pod/" + pods[0].metadata.name + "\n");
      if (f._[1] && !f.container) f.container = f._[1];
    }
    var code = 0, follow = [];
    pods.forEach(function (pod) {
      var names = f["all-containers"] ? pod.spec.containers.map(function (x) { return x.name; }) : [f.container || null];
      names.forEach(function (nm) {
        try {
          var t = containerOf(c, pod, nm, pods.length === 1 && !f["all-containers"] ? io : null), cs = t.cs, lines;
          if (f.previous) { if (!cs || !cs.prevLogs) throw kerr("Error from server (BadRequest): previous terminated container \"" + t.name + "\" in pod \"" + pod.metadata.name + "\" not found"); lines = cs.prevLogs; }
          else {
            if (!cs || !cs.proc) {
              var why = cs ? cs.reason : "ContainerCreating";
              if (!pod.spec.nodeName) why = "PodInitializing";
              throw kerr("Error from server (BadRequest): container \"" + t.name + "\" in pod \"" + pod.metadata.name + "\" is waiting to start: " + (why === "ImagePullBackOff" || why === "ErrImagePull" ? "trying and failing to pull image" : why === "InvalidImageName" ? "InvalidImageName" : why || "ContainerCreating"));
            }
            lines = cs.proc.logs; follow.push({ cs: cs, seen: lines.length, prefix: "" });
          }
          var tail = f.tail != null ? +f.tail : (f.selector ? 10 : -1);
          if (tail >= 0) lines = tail ? lines.slice(-tail) : [];
          var pre = f.prefix ? "[pod/" + pod.metadata.name + "/" + t.name + "] " : "";
          if (lines.length) io.out(lines.map(function (x) { return pre + (f.timestamps ? sim.date(x.t).toISOString().replace("Z", "000000Z") + " " : "") + x.s; }).join("\n") + "\n");
        } catch (e) { if (!(e instanceof CmdError)) throw e; io.err(e.message + "\n"); code = 1; }
      });
    });
    if (f.follow && follow.length) {
      var limit = sim.realtime ? Infinity : 15;
      try {
        while (limit-- > 0 && follow.some(function (x) { return x.cs.proc && x.cs.proc.running; })) {
          await sim.wait(1000);
          follow.forEach(function (x) { if (!x.cs.proc) return; var l = x.cs.proc.logs.slice(x.seen); x.seen = x.cs.proc.logs.length; if (l.length) io.out(l.map(function (y) { return y.s; }).join("\n") + "\n"); });
        }
      } catch (e) { if (!(e instanceof CmdError) || e.code !== 130) throw e; }
    }
    return code;
  };
  cmds.exec = async function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "exec", str: "c container pod-running-timeout", bool: "i stdin t tty q quiet", alias: { c: "container", i: "stdin", t: "tty" }, stop: false })), c = ctx(sim, f);
    if (!f._.length) throw kerr("error: pod, type/name or --filename must be specified");
    var argv = f.rest;
    if (!argv) { if (f._.length > 1) throw kerr("error: exec [POD] [COMMAND] is not supported anymore. Use exec [POD] -- [COMMAND] instead\nSee 'kubectl exec -h' for help and examples"); throw kerr("error: you must specify at least one command for the container"); }
    if (!argv.length) throw kerr("error: you must specify at least one command for the container");
    var pod = kc.podFor(c, f._[0], "create", "exec");
    if (pod.status.phase === "Succeeded" || pod.status.phase === "Failed") throw kerr("error: cannot exec into a container in a completed pod; current phase is " + pod.status.phase);
    var t = containerOf(c, pod, f.container, io), cs = t.cs;
    if (!cs || cs.state !== "running" || !cs.proc || !cs.proc.running) throw kerr(pod.spec.nodeName ? "error: Internal error occurred: unable to upgrade connection: container not found (\"" + t.name + "\")" : "Error from server (BadRequest): pod " + pod.metadata.name + " does not have a host assigned");
    if (!S.proc.has(cs.proc, argv[0])) throw kerr("error: Internal error occurred: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec \"" + sim.id(64) + "\": OCI runtime exec failed: exec failed: unable to start container process: exec: \"" + argv[0] + "\": executable file not found in $PATH: unknown", 1);
    var scope = S.proc.scope(sim, cs.proc, { dns: "10.96.0.10" });
    if ((f.stdin || f.tty) && argv.length === 1 && ["sh", "bash", "ash"].indexOf(argv[0].replace(/^.*\//, "")) >= 0) { sim.scopes.push(scope); return 0; }
    var code = await sim.execArgv(argv, io, scope);
    if (code) io.err("command terminated with exit code " + code + "\n");
    return code;
  };
  cmds.run = async function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "run", str: "image port restart dry-run o output overrides image-pull-policy serviceaccount pod-running-timeout", bool: "rm i stdin t tty command expose attach q quiet privileged", multi: "env l labels annotations requests limits", alias: { i: "stdin", t: "tty", o: "output", l: "labels" } })), c = ctx(sim, f), K = c.K;
    var name = f._[0];
    if (!name) throw kerr("error: NAME is required for run\nSee 'kubectl run -h' for help and examples");
    if (!f.image) throw kerr("error: required flag(s) \"image\" not set");
    var extra = (f.rest || []).concat(f._.slice(1).length && !f.rest ? f._.slice(1) : []), labels = { run: name };
    (f.labels || []).join(",").split(",").filter(Boolean).forEach(function (kv) { var p = kv.split("="); labels[p[0]] = p[1] || ""; if (kv.indexOf("=") > 0 && p[0] !== "run") delete labels.run; });
    if (f.labels && !/(^|,)run=/.test(f.labels.join(","))) delete labels.run;
    var cont = { name: name, image: f.image, resources: {} };
    if (extra.length) { if (f.command) cont.command = extra; else cont.args = extra; }
    if (f.env) cont.env = f.env.map(function (kv) { var i = kv.indexOf("="); if (i < 1) throw kerr("error: invalid env: " + kv); return { name: kv.slice(0, i), value: kv.slice(i + 1) }; });
    if (f.port) cont.ports = [{ containerPort: +f.port }];
    if (f["image-pull-policy"]) cont.imagePullPolicy = f["image-pull-policy"];
    var interactive = f.stdin || f.tty || f.attach;
    if (interactive) { cont.stdin = true; if (f.tty) cont.tty = true; }
    var restart = f.restart || "Always";
    if (f.rm && !interactive) throw kerr("error: --rm should only be used for attached containers");
    var pod = { apiVersion: "v1", kind: "Pod", metadata: { name: name, labels: labels }, spec: { containers: [cont], dnsPolicy: "ClusterFirst", restartPolicy: restart } };
    if (f.serviceaccount) pod.spec.serviceAccountName = f.serviceaccount;
    if (f["dry-run"] || !interactive) return finish(c, io, pod, f);
    pod.metadata.namespace = c.ns; K.prepare(pod); c.can("create", BY_KIND.Pod, pod.metadata.namespace, name);
    try { K.create(pod); } catch (e) { throw fromServer(e); }
    var limit = 60, rt, cs, shell = !extra.length || (extra.length === 1 && ["sh", "bash", "ash", "/bin/sh", "/bin/bash"].indexOf(extra[0]) >= 0);
    function cleanup() { if (f.rm) { var live = K.get("Pod", pod.metadata.namespace, name); if (live) K.remove(live); io.out("pod \"" + name + "\" deleted from " + pod.metadata.namespace + " namespace\n"); } }
    try {
      while (limit-- > 0) {
        sim.reconcile();
        rt = K.rt.get(pod.metadata.uid); cs = rt && rt.main[0];
        if (cs && (cs.state === "running" || cs.state === "terminated" || (cs.proc && !cs.proc.running))) break;
        if (cs && ["ErrImagePull", "ImagePullBackOff", "InvalidImageName", "CreateContainerConfigError", "RunContainerError", "CrashLoopBackOff"].indexOf(cs.reason) >= 0 && limit < 50) break;
        await sim.wait(1000);
      }
    } catch (e) { if (e instanceof CmdError && e.code === 130) { cleanup(); return 130; } throw e; }
    if (!cs || (!cs.proc && cs.state !== "terminated")) {
      var why = cs ? cs.reason : "Pending";
      io.err("error: timed out waiting for the condition\n" + (f.rm ? "" : "(the pod \"" + name + "\" still exists with status " + why + "; inspect it with kubectl describe pod " + name + ")\n"));
      cleanup(); return 1;
    }
    if (cs.state === "running" && cs.proc.running && shell && S.proc.has(cs.proc, "sh")) {
      io.err("If you don't see a command prompt, try pressing enter.\n");
      var scope = S.proc.scope(sim, cs.proc, { dns: "10.96.0.10" });
      scope.onExit = function (code) {
        cs.proc.exitCode = code; S.proc.finish(sim, cs.proc);
        if (f.rm) { var live = K.get("Pod", pod.metadata.namespace, name); if (live) K.remove(live); if (sim.ui.print) sim.ui.print("pod \"" + name + "\" deleted from " + pod.metadata.namespace + " namespace\n"); }
        else if (sim.ui.print) sim.ui.print("Session ended, resume using 'kubectl attach " + name + " -c " + name + " -i -t' command when the pod is running\n");
      };
      sim.scopes.push(scope);
      return 0;
    }
    // one-shot command: stream its output until it exits
    var seen = 0, wait = sim.realtime ? 600 : 30;
    function flush() { if (!cs.proc) return; var l = cs.proc.logs.slice(seen); seen = cs.proc.logs.length; if (l.length) io.out(l.map(function (x) { return x.s; }).join("\n") + "\n"); }
    try { flush(); while (cs.proc && cs.proc.running && wait-- > 0) { await sim.wait(1000); flush(); } } catch (e) { if (!(e instanceof CmdError) || e.code !== 130) throw e; }
    flush();
    var exit = cs.proc ? cs.proc.exitCode || 0 : 1;
    cleanup();
    if (exit) io.err("pod " + pod.metadata.namespace + "/" + name + " terminated (Error)\n");
    return exit;
  };

  /* ---------- entry point ---------- */
  var HELP = "kubectl controls the Kubernetes cluster manager.\n\nBasic Commands:\n  create        Create a resource from a file or from flags\n  expose        Expose a workload as a new Service\n  run           Run a particular image in a pod\n  set           Set specific features on objects (image, env, resources)\n  get           Display one or many resources\n  explain       Get documentation for a resource\n  edit          Edit a resource in the sandbox editor\n  delete        Delete resources\n\nDeploy Commands:\n  rollout       Manage the rollout of a resource (status, history, undo, restart, pause, resume)\n  scale         Set a new size for a deployment, replica set or stateful set\n\nCluster Management Commands:\n  cluster-info  Display cluster information\n  top           Display resource (CPU/memory) usage\n  cordon / uncordon / drain / taint   Manage nodes\n\nTroubleshooting and Debugging Commands:\n  describe      Show details of a specific resource, including its events\n  logs          Print the logs for a container in a pod\n  exec          Execute a command in a container\n  port-forward  Forward a local port to a pod or service\n  events        List events\n  auth          Inspect authorization (can-i, whoami)\n\nAdvanced Commands:\n  apply         Apply a configuration to a resource by file name or stdin\n  diff          Diff the live version against a would-be applied version\n  patch         Update fields of a resource\n  wait          Wait for a specific condition on one or many resources\n  label / annotate   Update labels or annotations\n\nOther Commands:\n  api-resources, api-versions, config, version\n\nUse \"kubectl <command> --help\" is not simulated; the lessons list the flags that work here.\n";
  S.commands.kubectl = S.commands.k = async function (a, io, sim, sc) {
    if (!a.length || a[0] === "--help" || a[0] === "-h" || a[0] === "help") { io.out(HELP); return 0; }
    // global flags may come before the command (kubectl -n shop get pods)
    var pre = [];
    while (a.length && a[0][0] === "-") { if (/^(-n|--namespace|--context|--as|--kubeconfig)$/.test(a[0])) { pre.push(a[0], a[1]); a = a.slice(2); } else { pre.push(a[0]); a = a.slice(1); } }
    var name = a[0], fn = cmds[name];
    if (!fn) throw kerr("error: unknown command \"" + name + "\" for \"kubectl\"" + (function () { var near = Object.keys(cmds).filter(function (k) { return k.indexOf(name) === 0 || name.indexOf(k) === 0 || (Math.abs(k.length - name.length) <= 1 && k.split("").filter(function (ch, i) { return name[i] === ch; }).length >= k.length - 1); }); return near.length ? "\n\nDid you mean this?\n\t" + near.join("\n\t") : ""; })());
    return fn(pre.concat(a.slice(1)), io, sim, sc);
  };
})(typeof window !== "undefined" ? window : globalThis);
