/* infra-sim — the `kubectl` CLI, part 2: describe, rollout, scale, set, expose, edit, patch, top, nodes, auth, port-forward, wait. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, K8 = S.k8s, BY_KIND = K8.BY_KIND, kc = S.kubectl, cmds = kc.cmds;
  var kerr = kc.err, spec = kc.spec, ctx = kc.ctx, ref = kc.ref, clean = kc.clean;

  /* ---------- describe ---------- */
  function rfc(sim, iso) { if (!iso) return "<unknown>"; var d = new Date(iso); return d.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.*) GMT$/, "$1, $2 $3 $4 $5 +0000"); }
  function kv(label, value, w) { return (label + ":").padEnd(w || 18) + value; }
  function mapLines(label, m, w) {
    var keys = Object.keys(m || {}).filter(function (k) { return k !== "kubectl.kubernetes.io/last-applied-configuration"; });
    if (!keys.length) return [kv(label, "<none>", w)];
    return keys.map(function (k, i) { return (i ? "" : label + ":").padEnd(w || 18) + k + (label === "Annotations" ? ": " : "=") + m[k]; });
  }
  function eventsBlock(sim, K, o) {
    var evs = K.eventsFor(o);
    if (!evs.length) return ["Events:" + " ".repeat(11) + "<none>"];
    var rows = [["Type", "Reason", "Age", "From", "Message"], ["----", "------", "----", "----", "-------"]].concat(evs.map(function (e) {
      return [e.type, e.reason, U.age(sim.now - e._last) + (e.count > 1 ? " (x" + e.count + " over " + U.age(sim.now - e._first) + ")" : ""), e.source.component, e.message];
    }));
    return ["Events:"].concat(U.table(rows, 2).split("\n").map(function (l) { return "  " + l; }));
  }
  function probeText(p) {
    var how = p.httpGet ? "http-get " + (p.httpGet.scheme || "HTTP").toLowerCase() + "://" + (p.httpGet.host || "") + ":" + p.httpGet.port + p.httpGet.path : p.tcpSocket ? "tcp-socket :" + p.tcpSocket.port : p.exec ? "exec [" + (p.exec.command || []).join(" ") + "]" : "grpc";
    return how + " delay=" + (p.initialDelaySeconds || 0) + "s timeout=" + p.timeoutSeconds + "s period=" + p.periodSeconds + "s #success=" + p.successThreshold + " #failure=" + p.failureThreshold;
  }
  function containerLines(sim, c, st, indent) {
    var L = [], pad = indent || "  ", w = 16;
    function line(k, v) { L.push(pad + "  " + (k + ":").padEnd(w) + v); }
    L.push(pad + c.name + ":");
    if (st) { line("Container ID", st.containerID || ""); }
    line("Image", c.image);
    if (st) line("Image ID", st.imageID || "");
    var ports = (c.ports || []).map(function (p) { return p.containerPort + "/" + (p.protocol || "TCP") + (p.name ? " (" + p.name + ")" : ""); });
    line(ports.length > 1 ? "Ports" : "Port", ports.join(", ") || "<none>");
    line(ports.length > 1 ? "Host Ports" : "Host Port", (c.ports || []).map(function (p) { return "0/" + (p.protocol || "TCP") + (p.name ? " (" + p.name + ")" : ""); }).join(", ") || "<none>");
    if (c.command) { L.push(pad + "  Command:"); c.command.forEach(function (x) { L.push(pad + "    " + x); }); }
    if (c.args) { L.push(pad + "  Args:"); c.args.forEach(function (x) { L.push(pad + "    " + x); }); }
    if (st) {
      var state = function (label, s) {
        if (s.running) { line(label, "Running"); L.push(pad + "    " + "Started:".padEnd(w - 2) + rfc(sim, s.running.startedAt)); }
        else if (s.terminated) { line(label, "Terminated"); L.push(pad + "    " + "Reason:".padEnd(w - 2) + s.terminated.reason); if (s.terminated.message) L.push(pad + "    " + "Message:".padEnd(w - 2) + s.terminated.message); L.push(pad + "    " + "Exit Code:".padEnd(w - 2) + s.terminated.exitCode); L.push(pad + "    " + "Started:".padEnd(w - 2) + rfc(sim, s.terminated.startedAt)); L.push(pad + "    " + "Finished:".padEnd(w - 2) + rfc(sim, s.terminated.finishedAt)); }
        else if (s.waiting) { line(label, "Waiting"); L.push(pad + "    " + "Reason:".padEnd(w - 2) + s.waiting.reason); if (s.waiting.message && /Error|InvalidImage/.test(s.waiting.reason)) L.push(pad + "    " + "Message:".padEnd(w - 2) + s.waiting.message); }
      };
      state("State", st.state);
      if (st.lastState && Object.keys(st.lastState).length) state("Last State", st.lastState);
      line("Ready", st.ready ? "True" : "False");
      line("Restart Count", st.restartCount);
    }
    var r = c.resources || {};
    ["limits", "requests"].forEach(function (k) { if (r[k] && Object.keys(r[k]).length) { L.push(pad + "  " + (k === "limits" ? "Limits" : "Requests") + ":"); Object.keys(r[k]).sort().forEach(function (x) { L.push(pad + "    " + (x + ":").padEnd(8) + r[k][x]); }); } });
    if (c.livenessProbe) line("Liveness", probeText(c.livenessProbe));
    if (c.readinessProbe) line("Readiness", probeText(c.readinessProbe));
    if (c.startupProbe) line("Startup", probeText(c.startupProbe));
    if (c.envFrom && c.envFrom.length) { L.push(pad + "  Environment Variables from:"); c.envFrom.forEach(function (e) { var cm = e.configMapRef, s = e.secretRef; L.push(pad + "    " + (cm || s).name + "  " + (cm ? "ConfigMap" : "Secret") + "  Optional: " + !!(cm || s).optional); }); }
    if (c.env && c.env.length) {
      L.push(pad + "  Environment:");
      c.env.forEach(function (e) {
        var v = e.value == null ? "" : e.value, vf = e.valueFrom;
        if (vf && vf.configMapKeyRef) v = "<set to the key '" + vf.configMapKeyRef.key + "' of config map '" + vf.configMapKeyRef.name + "'>  Optional: " + !!vf.configMapKeyRef.optional;
        if (vf && vf.secretKeyRef) v = "<set to the key '" + vf.secretKeyRef.key + "' in secret '" + vf.secretKeyRef.name + "'>  Optional: " + !!vf.secretKeyRef.optional;
        if (vf && vf.fieldRef) v = " (v1:" + vf.fieldRef.fieldPath + ")";
        L.push(pad + "    " + e.name + ":  " + v);
      });
    } else line("Environment", "<none>");
    if (c.volumeMounts && c.volumeMounts.length) { L.push(pad + "  Mounts:"); c.volumeMounts.forEach(function (m) { L.push(pad + "    " + m.mountPath + " from " + m.name + " (" + (m.readOnly ? "ro" : "rw") + (m.subPath ? ",path=\"" + m.subPath + "\"" : "") + ")"); }); }
    else line("Mounts", "<none>");
    return L;
  }
  function volumeLines(vols, pad) {
    var L = [];
    if (!vols || !vols.length) return [pad.slice(2) + "Volumes:" + " ".repeat(pad.length > 2 ? 2 : 13) + "<none>"];
    L.push(pad.slice(2) + "Volumes:");
    vols.forEach(function (v) {
      L.push(pad + v.name + ":");
      if (v.configMap) L.push(pad + "  Type:      ConfigMap (a volume populated by a ConfigMap)", pad + "  Name:      " + v.configMap.name, pad + "  Optional:  " + !!v.configMap.optional);
      else if (v.secret) L.push(pad + "  Type:        Secret (a volume populated by a Secret)", pad + "  SecretName:  " + v.secret.secretName, pad + "  Optional:    " + !!v.secret.optional);
      else if (v.persistentVolumeClaim) L.push(pad + "  Type:       PersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)", pad + "  ClaimName:  " + v.persistentVolumeClaim.claimName, pad + "  ReadOnly:   " + !!v.persistentVolumeClaim.readOnly);
      else if (v.emptyDir) L.push(pad + "  Type:       EmptyDir (a temporary directory that shares a pod's lifetime)", pad + "  Medium:     " + (v.emptyDir.medium || ""), pad + "  SizeLimit:  " + (v.emptyDir.sizeLimit || "<unset>"));
      else if (v.hostPath) L.push(pad + "  Type:          HostPath (bare host directory volume)", pad + "  Path:          " + v.hostPath.path, pad + "  HostPathType:  " + (v.hostPath.type || ""));
    });
    return L;
  }
  function tolerations(spec0, w) {
    var t = (spec0.tolerations || []).map(function (x) { return (x.key || "") + (x.value ? "=" + x.value : "") + (x.effect ? ":" + x.effect : "") + (x.operator === "Exists" ? " op=Exists" : "") + (x.tolerationSeconds ? " for " + x.tolerationSeconds + "s" : ""); });
    if (!t.length) return [kv("Tolerations", "<none>", w)];
    return t.map(function (x, i) { return (i ? "" : "Tolerations:").padEnd(w) + x; });
  }
  function templateLines(tpl) {
    var L = ["Pod Template:"];
    mapLines("  Labels", (tpl.metadata || {}).labels, 11).forEach(function (l) { L.push(l); });
    if ((tpl.metadata || {}).annotations && Object.keys(tpl.metadata.annotations).length) mapLines("  Annotations", tpl.metadata.annotations, 16).forEach(function (l) { L.push(l); });
    if (tpl.spec.serviceAccountName && tpl.spec.serviceAccountName !== "default") L.push("  Service Account:  " + tpl.spec.serviceAccountName);
    if (tpl.spec.initContainers && tpl.spec.initContainers.length) { L.push("  Init Containers:"); tpl.spec.initContainers.forEach(function (c) { containerLines(null, c, null, "   ").forEach(function (l) { L.push(l); }); }); }
    L.push("  Containers:");
    tpl.spec.containers.forEach(function (c) { containerLines(null, c, null, "   ").forEach(function (l) { L.push(l); }); });
    volumeLines(tpl.spec.volumes, "   ").forEach(function (l) { L.push(l.replace(/^ Volumes:\s+<none>/, "  Volumes:         <none>")); });
    L.push("  Node-Selectors:  " + (tpl.spec.nodeSelector ? K8.selText(tpl.spec.nodeSelector) : "<none>"));
    L.push("  Tolerations:     " + ((tpl.spec.tolerations || []).length ? tolerations(tpl.spec, 0).join(", ").replace(/Tolerations:/g, "") : "<none>"));
    return L;
  }
  var D = {
    Pod: function (sim, K, p) {
      var st = p.status, L = [], w = 18, owner = (p.metadata.ownerReferences || [])[0], node = p.spec.nodeName ? K.get("Node", null, p.spec.nodeName) : null;
      L.push(kv("Name", p.metadata.name, w), kv("Namespace", p.metadata.namespace, w), kv("Priority", p.spec.priorityClassName ? "2000001000" : "0", w));
      if (p.spec.priorityClassName) L.push(kv("Priority Class Name", p.spec.priorityClassName, w + 4));
      L.push(kv("Service Account", p.spec.serviceAccountName || "default", w), kv("Node", node ? node.metadata.name + "/" + node.status.addresses[0].address : "<none>", w));
      if (st.startTime) L.push(kv("Start Time", rfc(sim, st.startTime), w));
      mapLines("Labels", p.metadata.labels, w).concat(mapLines("Annotations", p.metadata.annotations, w)).forEach(function (l) { L.push(l); });
      L.push(kv("Status", p.metadata.deletionTimestamp ? "Terminating" : st.phase, w));
      if (st.reason) L.push(kv("Reason", st.reason, w)); if (st.message) L.push(kv("Message", st.message, w));
      L.push(kv("IP", st.podIP || "", w), "IPs:" + (st.podIP ? "" : " ".repeat(14) + "<none>"));
      if (st.podIP) L.push("  IP:           " + st.podIP);
      if (owner) L.push("Controlled By:  " + owner.kind + "/" + owner.name);
      if (p.spec.initContainers && p.spec.initContainers.length) { L.push("Init Containers:"); p.spec.initContainers.forEach(function (c, i) { containerLines(sim, c, (st.initContainerStatuses || [])[i], "  ").forEach(function (l) { L.push(l); }); }); }
      L.push("Containers:");
      p.spec.containers.forEach(function (c, i) { containerLines(sim, c, (st.containerStatuses || [])[i] || { state: { waiting: { reason: "ContainerCreating" } }, ready: false, restartCount: 0 }, "  ").forEach(function (l) { L.push(l); }); });
      var conds = (st.conditions || []).slice();
      if (conds.length) {
        L.push("Conditions:", "  Type                        Status");
        var order = ["PodReadyToStartContainers", "Initialized", "Ready", "ContainersReady", "PodScheduled"];
        if (p.spec.nodeName && st.podIP) conds.push({ type: "PodReadyToStartContainers", status: "True" });
        order.forEach(function (t) { var c = conds.filter(function (x) { return x.type === t; })[0]; if (c) L.push("  " + t.padEnd(28) + c.status); });
      }
      volumeLines(p.spec.volumes, "  ").forEach(function (l) { L.push(l.replace(/^Volumes:\s+<none>/, "Volumes:                     <none>")); });
      L.push(kv("QoS Class", st.qosClass || "BestEffort", 29), kv("Node-Selectors", p.spec.nodeSelector ? K8.selText(p.spec.nodeSelector) : "<none>", 29));
      tolerations({ tolerations: (p.spec.tolerations || []).concat(p.spec.hostNetwork ? [] : [{ key: "node.kubernetes.io/not-ready", effect: "NoExecute", operator: "Exists", tolerationSeconds: 300 }, { key: "node.kubernetes.io/unreachable", effect: "NoExecute", operator: "Exists", tolerationSeconds: 300 }]) }, 29).forEach(function (l) { L.push(l); });
      return L.concat(eventsBlock(sim, K, p));
    },
    Deployment: function (sim, K, d) {
      var s = d.status, w = 24, L = [kv("Name", d.metadata.name, w), kv("Namespace", d.metadata.namespace, w), kv("CreationTimestamp", rfc(sim, d.metadata.creationTimestamp), w)];
      mapLines("Labels", d.metadata.labels, w).concat(mapLines("Annotations", d.metadata.annotations, w)).forEach(function (l) { L.push(l); });
      L.push(kv("Selector", K8.selText(d.spec.selector), w), kv("Replicas", d.spec.replicas + " desired | " + (s.updatedReplicas || 0) + " updated | " + (s.replicas || 0) + " total | " + (s.availableReplicas || 0) + " available | " + (s.unavailableReplicas || 0) + " unavailable", w),
        kv("StrategyType", d.spec.strategy.type, w), kv("MinReadySeconds", d.spec.minReadySeconds || 0, w));
      if (d.spec.strategy.rollingUpdate) L.push(kv("RollingUpdateStrategy", d.spec.strategy.rollingUpdate.maxUnavailable + " max unavailable, " + d.spec.strategy.rollingUpdate.maxSurge + " max surge", w));
      templateLines(d.spec.template).forEach(function (l) { L.push(l); });
      L.push("Conditions:", "  Type           Status  Reason", "  ----           ------  ------");
      (s.conditions || []).forEach(function (c) { L.push("  " + c.type.padEnd(15) + c.status.padEnd(8) + c.reason); });
      var rss = K.owned(d, "ReplicaSet"), hash = K8.tplHash(sim, d.spec.template), cur = rss.filter(function (r) { return r.metadata.labels["pod-template-hash"] === hash; })[0], olds = rss.filter(function (r) { return r !== cur && r.spec.replicas > 0; });
      var rsText = function (r) { return r.metadata.name + " (" + ((r.status || {}).replicas || 0) + "/" + r.spec.replicas + " replicas created)"; };
      L.push(kv("OldReplicaSets", olds.length ? olds.map(rsText).join(", ") : "<none>", 17), kv("NewReplicaSet", cur ? rsText(cur) : "<none>", 17));
      return L.concat(eventsBlock(sim, K, d));
    },
    ReplicaSet: function (sim, K, r) {
      var w = 16, owner = (r.metadata.ownerReferences || [])[0], pods = K.owned(r, "Pod"), L = [kv("Name", r.metadata.name, w), kv("Namespace", r.metadata.namespace, w), kv("Selector", K8.selText(r.spec.selector), w)];
      mapLines("Labels", r.metadata.labels, w).concat(mapLines("Annotations", r.metadata.annotations, w)).forEach(function (l) { L.push(l); });
      if (owner) L.push("Controlled By:  " + owner.kind + "/" + owner.name);
      var ph = function (x) { return pods.filter(function (p) { return p.status.phase === x; }).length; };
      L.push(kv("Replicas", pods.length + " current / " + r.spec.replicas + " desired", w), kv("Pods Status", ph("Running") + " Running / " + ph("Pending") + " Waiting / " + ph("Succeeded") + " Succeeded / " + ph("Failed") + " Failed", w));
      return L.concat(templateLines(r.spec.template), eventsBlock(sim, K, r));
    },
    StatefulSet: function (sim, K, s) {
      var w = 20, pods = K.owned(s, "Pod"), L = [kv("Name", s.metadata.name, w), kv("Namespace", s.metadata.namespace, w), kv("CreationTimestamp", rfc(sim, s.metadata.creationTimestamp), w), kv("Selector", K8.selText(s.spec.selector), w)];
      mapLines("Labels", s.metadata.labels, w).forEach(function (l) { L.push(l); });
      var ph = function (x) { return pods.filter(function (p) { return p.status.phase === x; }).length; };
      L.push(kv("Replicas", s.spec.replicas + " desired | " + pods.length + " total", w), kv("Update Strategy", (s.spec.updateStrategy || {}).type || "RollingUpdate", w), kv("Pods Status", ph("Running") + " Running / " + ph("Pending") + " Waiting / " + ph("Succeeded") + " Succeeded / " + ph("Failed") + " Failed", w));
      L = L.concat(templateLines(s.spec.template));
      if ((s.spec.volumeClaimTemplates || []).length) { L.push("Volume Claims:"); s.spec.volumeClaimTemplates.forEach(function (t) { L.push("  Name:          " + t.metadata.name, "  StorageClass:  " + (t.spec.storageClassName || ""), "  Capacity:      " + t.spec.resources.requests.storage, "  Access Modes:  [" + t.spec.accessModes.join(" ") + "]"); }); } else L.push("Volume Claims:  <none>");
      return L.concat(eventsBlock(sim, K, s));
    },
    DaemonSet: function (sim, K, d) {
      var w = 16, s = d.status || {}, L = [kv("Name", d.metadata.name, w), kv("Namespace", d.metadata.namespace, w), kv("Selector", K8.selText(d.spec.selector), w), kv("Node-Selector", K8.selText(d.spec.template.spec.nodeSelector), w)];
      mapLines("Labels", d.metadata.labels, w).forEach(function (l) { L.push(l); });
      L.push("Desired Number of Nodes Scheduled: " + (s.desiredNumberScheduled || 0), "Current Number of Nodes Scheduled: " + (s.currentNumberScheduled || 0), "Number of Nodes Scheduled with Up-to-date Pods: " + (s.updatedNumberScheduled || 0), "Number of Nodes Scheduled with Available Pods: " + (s.numberAvailable || 0), "Number of Nodes Misscheduled: 0");
      return L.concat(templateLines(d.spec.template), eventsBlock(sim, K, d));
    },
    Job: function (sim, K, j) {
      var w = 18, st = j.status, L = [kv("Name", j.metadata.name, w), kv("Namespace", j.metadata.namespace, w), kv("Selector", "batch.kubernetes.io/controller-uid=" + j.metadata.uid, w)];
      mapLines("Labels", j.metadata.labels, w).forEach(function (l) { L.push(l); });
      L.push(kv("Parallelism", j.spec.parallelism, w), kv("Completions", j.spec.completions == null ? "<unset>" : j.spec.completions, w), kv("Backoff Limit", j.spec.backoffLimit, w));
      if (st.startTime) L.push(kv("Start Time", rfc(sim, st.startTime), w)); if (st.completionTime) L.push(kv("Completed At", rfc(sim, st.completionTime), w));
      L.push(kv("Pods Statuses", (st.active || 0) + " Active (" + (st.ready || 0) + " Ready) / " + (st.succeeded || 0) + " Succeeded / " + (st.failed || 0) + " Failed", w));
      return L.concat(templateLines(j.spec.template), eventsBlock(sim, K, j));
    },
    Service: function (sim, K, s) {
      var w = 26, ep = K.get("Endpoints", s.metadata.namespace, s.metadata.name), L = [kv("Name", s.metadata.name, w), kv("Namespace", s.metadata.namespace, w)];
      mapLines("Labels", s.metadata.labels, w).concat(mapLines("Annotations", s.metadata.annotations, w)).forEach(function (l) { L.push(l); });
      L.push(kv("Selector", K8.selText(s.spec.selector), w), kv("Type", s.spec.type, w), kv("IP Family Policy", "SingleStack", w), kv("IP Families", "IPv4", w), kv("IP", s.spec.clusterIP || "", w), kv("IPs", s.spec.clusterIP || "<none>", w));
      var lb = ((s.status.loadBalancer || {}).ingress || [])[0]; if (lb) L.push(kv("LoadBalancer Ingress", lb.ip + " (VIP)", w));
      (s.spec.ports || []).forEach(function (p, i) {
        L.push(kv("Port", (p.name || "<unset>") + "  " + p.port + "/" + p.protocol, w), kv("TargetPort", p.targetPort + "/" + p.protocol, w));
        if (p.nodePort) L.push(kv("NodePort", (p.name || "<unset>") + "  " + p.nodePort + "/" + p.protocol, w));
        var addrs = [], sub = ep && ep.subsets[0];
        if (sub && sub.ports[i]) (sub.addresses || []).forEach(function (a) { addrs.push(a.ip + ":" + sub.ports[i].port); });
        L.push(kv("Endpoints", addrs.length > 3 ? addrs.slice(0, 3).join(",") + " + " + (addrs.length - 3) + " more..." : addrs.join(",") || "<none>", w));
      });
      L.push(kv("Session Affinity", s.spec.sessionAffinity || "None", w));
      if (s.spec.type !== "ClusterIP") L.push(kv("External Traffic Policy", "Cluster", w));
      L.push(kv("Internal Traffic Policy", "Cluster", w));
      return L.concat(eventsBlock(sim, K, s));
    },
    Endpoints: function (sim, K, e) {
      var L = [kv("Name", e.metadata.name, 14), kv("Namespace", e.metadata.namespace, 14)]; mapLines("Labels", e.metadata.labels, 14).forEach(function (l) { L.push(l); });
      L.push("Subsets:");
      (e.subsets || []).forEach(function (s) { L.push("  Addresses:          " + ((s.addresses || []).map(function (a) { return a.ip; }).join(",") || "<none>"), "  NotReadyAddresses:  " + ((s.notReadyAddresses || []).map(function (a) { return a.ip; }).join(",") || "<none>"), "  Ports:", "    Name     Port  Protocol", "    ----     ----  --------"); (s.ports || []).forEach(function (p) { L.push("    " + (p.name || "<unset>").padEnd(9) + String(p.port).padEnd(6) + p.protocol); }); });
      return L.concat(["", "Events:  <none>"]);
    },
    Ingress: function (sim, K, i) {
      var w = 18, ns = i.metadata.namespace, L = [kv("Name", i.metadata.name, w)]; mapLines("Labels", i.metadata.labels, w).forEach(function (l) { L.push(l); });
      L.push(kv("Namespace", ns, w), kv("Address", (((i.status || {}).loadBalancer || {}).ingress || []).map(function (x) { return x.ip; }).join(","), w), kv("Ingress Class", i.spec.ingressClassName || "<none>", w), kv("Default backend", "<default>", w), "Rules:", "  Host        Path  Backends", "  ----        ----  --------");
      (i.spec.rules || []).forEach(function (r) {
        L.push("  " + (r.host || "*"));
        ((r.http || {}).paths || []).forEach(function (p) {
          var b = p.backend.service, svc = K.get("Service", ns, b.name), ep = K.get("Endpoints", ns, b.name), port = b.port.number != null ? b.port.number : b.port.name;
          var eps = !svc ? "<error: services \"" + b.name + "\" not found>" : kc.epText(ep || { subsets: [] }).replace("<none>", "");
          L.push("              " + (p.path || "/") + "   " + b.name + ":" + port + " (" + eps + ")");
        });
      });
      mapLines("Annotations", i.metadata.annotations, w).forEach(function (l) { L.push(l); });
      return L.concat(eventsBlock(sim, K, i));
    },
    Node: function (sim, K, n) {
      var w = 20, use = K.nodeUsage(n), alloc = n.status.allocatable, L = [kv("Name", n.metadata.name, w), kv("Roles", kc.nodeRoles(n), w)];
      mapLines("Labels", n.metadata.labels, w).forEach(function (l) { L.push(l); });
      L.push(kv("Annotations", "node.alpha.kubernetes.io/ttl: 0", w), kv("CreationTimestamp", rfc(sim, n.metadata.creationTimestamp), w));
      var taints = (n.spec.taints || []).map(function (t) { return t.key + (t.value ? "=" + t.value : "") + ":" + t.effect; }).concat(n.spec.unschedulable ? ["node.kubernetes.io/unschedulable:NoSchedule"] : []);
      taints.length ? taints.forEach(function (t, i) { L.push((i ? "" : "Taints:").padEnd(w) + t); }) : L.push(kv("Taints", "<none>", w));
      L.push(kv("Unschedulable", String(!!n.spec.unschedulable), w), "Conditions:", "  Type             Status  Reason                       Message", "  ----             ------  ------                       -------");
      n.status.conditions.forEach(function (c) { L.push("  " + c.type.padEnd(17) + c.status.padEnd(8) + c.reason.padEnd(29) + c.message); });
      L.push("Addresses:"); n.status.addresses.forEach(function (a) { L.push("  " + (a.type + ":").padEnd(13) + a.address); });
      L.push("Capacity:", "  cpu:     " + n.status.capacity.cpu, "  memory:  " + n.status.capacity.memory, "  pods:    " + n.status.capacity.pods, "Allocatable:", "  cpu:     " + alloc.cpu, "  memory:  " + alloc.memory, "  pods:    " + alloc.pods);
      var i = n.status.nodeInfo; L.push("System Info:", "  Kernel Version:             " + i.kernelVersion, "  OS Image:                   " + i.osImage, "  Operating System:           linux", "  Architecture:               amd64", "  Container Runtime Version:  " + i.containerRuntimeVersion, "  Kubelet Version:            " + i.kubeletVersion, "PodCIDR:                      " + n.spec.podCIDR);
      var pods = K.list("Pod").filter(function (p) { return p.spec.nodeName === n.metadata.name && p.status.phase !== "Succeeded" && p.status.phase !== "Failed"; });
      L.push("Non-terminated Pods:          (" + pods.length + " in total)");
      var pc = function (v, t) { return v + " (" + Math.floor(100 * parseFloat(v) * (/m$/.test(v) ? 1 : 1000) / t) + "%)"; }, ac = K8.cpu(alloc.cpu), am = K8.mem(alloc.memory);
      var mp = function (b) { return (b ? K8.fmtMem(b) : "0") + " (" + Math.floor(100 * b / am) + "%)"; };
      var rows = [["Namespace", "Name", "CPU Requests", "CPU Limits", "Memory Requests", "Memory Limits", "Age"], ["---------", "----", "------------", "----------", "---------------", "-------------", "---"]];
      pods.forEach(function (p) { var r = K.podRequests(p); rows.push([p.metadata.namespace, p.metadata.name, pc(K8.fmtCpu(r.cpu), ac), pc(K8.fmtCpu(r.limitsCpu), ac), mp(r.memory), mp(r.limitsMemory), U.age(sim.now - p.metadata._created)]); });
      U.table(rows, 2).split("\n").forEach(function (l) { L.push("  " + l); });
      L.push("Allocated resources:", "  (Total limits may be over 100 percent, i.e., overcommitted.)", "  Resource           Requests      Limits", "  --------           --------      ------",
        "  cpu                " + pc(K8.fmtCpu(use.cpu), ac).padEnd(14) + pc(K8.fmtCpu(use.limitsCpu), ac), "  memory             " + mp(use.memory).padEnd(14) + mp(use.limitsMemory));
      return L.concat(eventsBlock(sim, K, n));
    },
    ConfigMap: function (sim, K, c) {
      var L = [kv("Name", c.metadata.name, 14), kv("Namespace", c.metadata.namespace, 14)]; mapLines("Labels", c.metadata.labels, 14).concat(mapLines("Annotations", c.metadata.annotations, 14)).forEach(function (l) { L.push(l); });
      L.push("", "Data", "====");
      Object.keys(c.data || {}).forEach(function (k) { L.push(k + ":", "----", c.data[k].replace(/\n$/, ""), ""); });
      L.push("", "BinaryData", "====", "", "Events:  <none>");
      return L;
    },
    Secret: function (sim, K, c) {
      var L = [kv("Name", c.metadata.name, 14), kv("Namespace", c.metadata.namespace, 14)]; mapLines("Labels", c.metadata.labels, 14).concat(mapLines("Annotations", c.metadata.annotations, 14)).forEach(function (l) { L.push(l); });
      L.push("", "Type:  " + c.type, "", "Data", "====");
      Object.keys(c.data || {}).forEach(function (k) { L.push(k + ":  " + U.b64d(c.data[k]).length + " bytes"); });
      return L;
    },
    PersistentVolumeClaim: function (sim, K, c) {
      var w = 15, b = c.status.phase === "Bound", L = [kv("Name", c.metadata.name, w), kv("Namespace", c.metadata.namespace, w), kv("StorageClass", c.spec.storageClassName || "", w), kv("Status", c.metadata.deletionTimestamp ? "Terminating (lasts " + U.age(sim.now - Date.parse(c.metadata.deletionTimestamp) + sim.epoch) + ")" : c.status.phase, w), kv("Volume", c.spec.volumeName || "", w)];
      mapLines("Labels", c.metadata.labels, w).concat(mapLines("Annotations", c.metadata.annotations, w)).forEach(function (l) { L.push(l); });
      L.push(kv("Finalizers", "[kubernetes.io/pvc-protection]", w), kv("Capacity", b ? c.status.capacity.storage : "", w), kv("Access Modes", b ? c.status.accessModes.map(function (m) { return { ReadWriteOnce: "RWO", ReadOnlyMany: "ROX", ReadWriteMany: "RWX" }[m] || m; }).join(",") : "", w), kv("VolumeMode", c.spec.volumeMode, w));
      var users = K.list("Pod", c.metadata.namespace).filter(function (p) { return (p.spec.volumes || []).some(function (v) { return v.persistentVolumeClaim && v.persistentVolumeClaim.claimName === c.metadata.name; }); }).map(function (p) { return p.metadata.name; });
      L.push(kv("Used By", users.join("\n" + " ".repeat(w)) || "<none>", w));
      return L.concat(eventsBlock(sim, K, c));
    },
    Namespace: function (sim, K, n) {
      var L = [kv("Name", n.metadata.name, 14)]; mapLines("Labels", n.metadata.labels, 14).concat(mapLines("Annotations", n.metadata.annotations, 14)).forEach(function (l) { L.push(l); });
      L.push(kv("Status", "Active", 14), "");
      var qs = K.list("ResourceQuota", n.metadata.name);
      if (!qs.length) L.push("No resource quota.");
      qs.forEach(function (q) { L.push("Resource Quotas", "  Name:     " + q.metadata.name, "  Resource  Used  Hard", "  --------  ---   ---"); Object.keys(q.spec.hard).forEach(function (k) { L.push("  " + k.padEnd(10) + String(((q.status || {}).used || {})[k] || 0).padEnd(6) + q.spec.hard[k]); }); });
      L.push("", K.list("LimitRange", n.metadata.name).length ? "Resource Limits: see kubectl describe limitrange" : "No LimitRange resource.");
      return L;
    },
    ResourceQuota: function (sim, K, q) {
      var L = [kv("Name", q.metadata.name, 12), kv("Namespace", q.metadata.namespace, 12)], rows = [["Resource", "Used", "Hard"], ["--------", "----", "----"]];
      Object.keys(q.spec.hard).sort().forEach(function (k) { rows.push([k, ((q.status || {}).used || {})[k] || 0, q.spec.hard[k]]); });
      return L.concat(U.table(rows, 2).split("\n"));
    },
    NetworkPolicy: function (sim, K, n) {
      var L = [kv("Name", n.metadata.name, 14), kv("Namespace", n.metadata.namespace, 14), kv("Created on", rfc(sim, n.metadata.creationTimestamp), 14)]; mapLines("Labels", n.metadata.labels, 14).forEach(function (l) { L.push(l); });
      L.push("Spec:", "  PodSelector:     " + (K8.selText(n.spec.podSelector) === "<none>" ? "<none> (Allowing the specific traffic to all pods in this namespace)" : K8.selText(n.spec.podSelector)));
      var rules = n.spec.ingress;
      if (!rules || !rules.length) L.push("  Allowing ingress traffic:", "    <none> (Selected pods are isolated for ingress connectivity)");
      else { L.push("  Allowing ingress traffic:"); rules.forEach(function (r) { L.push("    To Port: " + ((r.ports || []).map(function (p) { return p.port + "/" + (p.protocol || "TCP"); }).join(", ") || "<any> (traffic allowed to all ports)")); if (!r.from || !r.from.length) L.push("    From: <any> (traffic not restricted by source)"); else { L.push("    From:"); r.from.forEach(function (f) { if (f.namespaceSelector) L.push("      NamespaceSelector: " + K8.selText(f.namespaceSelector)); if (f.podSelector) L.push("      PodSelector: " + K8.selText(f.podSelector)); }); } }); }
      L.push("  Not affecting egress traffic", "  Policy Types: " + (n.spec.policyTypes || ["Ingress"]).join(", "));
      return L;
    }
  };
  function describeGeneric(sim, K, o) {
    var w = 14, L = [kv("Name", o.metadata.name, w)]; if (o.metadata.namespace) L.push(kv("Namespace", o.metadata.namespace, w));
    mapLines("Labels", o.metadata.labels, w).concat(mapLines("Annotations", o.metadata.annotations, w)).forEach(function (l) { L.push(l); });
    L.push(kv("API Version", o.apiVersion, w), kv("Kind", o.kind, w));
    var rest = clean(o); delete rest.metadata; delete rest.apiVersion; delete rest.kind;
    Object.keys(rest).forEach(function (k) { if (rest[k] && typeof rest[k] === "object" && !Object.keys(rest[k]).length) return; L.push(k[0].toUpperCase() + k.slice(1) + ":"); S.yamlDump(rest[k]).replace(/\n$/, "").split("\n").forEach(function (l) { L.push("  " + l); }); });
    return L.concat(eventsBlock(sim, K, o));
  }
  cmds.describe = function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "describe", str: "l selector", bool: "show-events", multi: "f filename", alias: { l: "selector" } })), c = ctx(sim, f), K = c.K;
    if (!f._.length) throw kerr("You must specify the type of resource to describe. Use \"kubectl api-resources\" for a complete list of supported resources.\n\nerror: Required resource not specified.");
    var targets = kc.parseTargets(f._), blocks = [], code = 0;
    targets.forEach(function (t) {
      var k = t.k, ns = k.namespaced ? (c.all ? null : c.ns) : null, objs = [];
      if (t.names.length) t.names.forEach(function (n) {
        c.can("get", k, ns, n);
        var o = K.get(k.kind, ns, n);
        if (!o) { var pre = K.list(k.kind, ns).filter(function (x) { return x.metadata.name.indexOf(n) === 0; }); if (pre.length) objs = objs.concat(pre); else { io.err("Error from server (NotFound): " + K8.qual(k) + " \"" + n + "\" not found\n"); code = 1; } }
        else objs.push(o);
      });
      else { c.can("list", k, ns, null); objs = K.list(k.kind, ns, f.selector ? K8.parseSelector(f.selector) : null); }
      objs.forEach(function (o) { blocks.push((D[k.kind] || describeGeneric)(sim, K, o).join("\n")); });
      if (!t.names.length && !objs.length) io.err("No resources found in " + c.ns + " namespace.\n");
    });
    if (blocks.length) io.out(blocks.join("\n\n\n") + "\n");
    return code;
  };

  /* ---------- helpers for mutating commands ---------- */
  function workload(c, target, extra) {   // "deploy/web", "deployment web"
    var t = kc.parseTargets(target)[0];
    if (!t || !t.names.length) throw kerr("error: required resource not specified");
    return { k: t.k, o: kc.getOne(c, t.k, t.names[0], "patch"), names: t.names };
  }
  function save(c, k, o, mutate, verb) {
    var next = clean(o); next.metadata._created = o.metadata._created;
    Object.keys(o).forEach(function (key) { if (key[0] === "_") next[key] = o[key]; });
    next.status = o.status;
    mutate(next);
    try { c.K.update(next, o); } catch (e) { throw kc.fromServer(e); }
    return next;
  }
  kc.save = save;
  function tplOf(o) { return o.kind === "Pod" ? o : o.kind === "CronJob" ? o.spec.jobTemplate.spec.template : o.spec.template; }

  cmds.scale = function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "scale", str: "replicas current-replicas timeout l selector", bool: "all", multi: "f filename", alias: { l: "selector" } })), c = ctx(sim, f);
    if (f.replicas == null) throw kerr("error: required flag(s) \"replicas\" not set");
    if (!/^\d+$/.test(f.replicas)) throw kerr("error: invalid argument \"" + f.replicas + "\" for \"--replicas\" flag: strconv.ParseInt: parsing \"" + f.replicas + "\": invalid syntax");
    var targets = kc.parseTargets(f._);
    if (!targets.length) throw kerr("error: resource(s) were provided, but no name was specified");
    targets.forEach(function (t) {
      if (["Deployment", "ReplicaSet", "StatefulSet"].indexOf(t.k.kind) < 0) throw kerr("error: no kind \"" + t.k.kind + "\" is registered for the internal version of group \"autoscaling\" (this resource cannot be scaled)");
      var list = t.names.length ? t.names.map(function (n) { return kc.getOne(c, t.k, n, "patch"); }) : (f.all ? c.K.list(t.k.kind, c.ns) : []);
      if (!list.length) throw kerr("error: resource(s) were provided, but no name was specified");
      list.forEach(function (o) { save(c, t.k, o, function (n) { n.spec.replicas = +f.replicas; }); io.out(ref(t.k, o) + " scaled\n"); });
    });
  };

  var setCmds = {
    image: function (c, io, f) {
      var changes = f._.slice(1).filter(function (x) { return x.indexOf("=") > 0; }), tgt = f._.slice(1).filter(function (x) { return x.indexOf("=") < 0; });
      if (!tgt.length || !changes.length) throw kerr("error: one or more resources must be specified as <resource> <name> or <resource>/<name>");
      var w = workload(c, tgt), found = false;
      var next = save(c, w.k, w.o, function (n) {
        changes.forEach(function (ch) {
          var i = ch.indexOf("="), cn = ch.slice(0, i), img = ch.slice(i + 1), list = tplOf(n).spec.containers.concat(tplOf(n).spec.initContainers || []);
          list.forEach(function (x) { if (cn === "*" || x.name === cn) { x.image = img; found = true; } });
          if (!found) throw kerr("error: unable to find container named \"" + cn + "\"");
        });
      });
      io.out(ref(w.k, w.o) + (K8.eq(next.spec, w.o.spec) ? " image updated" : " image updated") + "\n");
    },
    env: function (c, io, f) {
      var args = f._.slice(1), envs = args.filter(function (x) { return /^[A-Za-z_]\w*(=|-$)/.test(x); }), tgt = args.filter(function (x) { return envs.indexOf(x) < 0; });
      if (!tgt.length) throw kerr("error: one or more resources must be specified as <resource> <name> or <resource>/<name>");
      var w = workload(c, tgt);
      if (f.list) { tplOf(w.o).spec.containers.forEach(function (x) { io.out("# " + w.k.singular + "/" + w.o.metadata.name + ", container " + x.name + "\n" + (x.env || []).map(function (e) { return e.valueFrom ? "# " + e.name + " from " + (e.valueFrom.secretKeyRef ? "secret " + e.valueFrom.secretKeyRef.name : e.valueFrom.configMapKeyRef ? "configmap " + e.valueFrom.configMapKeyRef.name : "field") + ", key " + ((e.valueFrom.secretKeyRef || e.valueFrom.configMapKeyRef || {}).key || "") : e.name + "=" + e.value; }).join("\n") + "\n"); }); return; }
      if (!envs.length && !f.from) throw kerr("error: at least one environment variable must be provided");
      save(c, w.k, w.o, function (n) {
        tplOf(n).spec.containers.forEach(function (x) {
          if (f.containers && f.containers !== "*" && f.containers !== x.name) return;
          if (f.from) { var m = /^(configmap|secret|cm)\/(.+)$/.exec(f.from); if (!m) throw kerr("error: --from must be configmap/NAME or secret/NAME"); var kind = m[1] === "secret" ? "Secret" : "ConfigMap", src = kc.getOne(c, BY_KIND[kind], m[2]); x.env = x.env || []; Object.keys(src.data || {}).forEach(function (key) { var nm = (f.prefix || "") + key.toUpperCase().replace(/[^A-Z0-9_]/g, "_"), vf = {}; vf[kind === "Secret" ? "secretKeyRef" : "configMapKeyRef"] = { name: m[2], key: key }; x.env = x.env.filter(function (e) { return e.name !== nm; }).concat([{ name: nm, valueFrom: vf }]); }); }
          envs.forEach(function (e) {
            x.env = x.env || [];
            if (/-$/.test(e)) { x.env = x.env.filter(function (y) { return y.name !== e.slice(0, -1); }); return; }
            var i = e.indexOf("="), name = e.slice(0, i), cur = x.env.filter(function (y) { return y.name === name; })[0];
            if (cur) { cur.value = e.slice(i + 1); delete cur.valueFrom; } else x.env.push({ name: name, value: e.slice(i + 1) });
          });
          if (x.env && !x.env.length) delete x.env;
        });
      });
      io.out(ref(w.k, w.o) + " env updated\n");
    },
    resources: function (c, io, f) {
      var w = workload(c, f._.slice(1)), parse = function (s) { var o = {}; (s || "").split(",").filter(Boolean).forEach(function (kv2) { var p = kv2.split("="); o[p[0]] = p[1]; }); return o; };
      if (!f.limits && !f.requests) throw kerr("error: you must specify an update to requests or limits (in the form of --requests/--limits)");
      save(c, w.k, w.o, function (n) { tplOf(n).spec.containers.forEach(function (x) { if (f.containers && f.containers !== "*" && f.containers !== x.name) return; x.resources = x.resources || {}; if (f.limits) x.resources.limits = Object.assign({}, x.resources.limits, parse(f.limits)); if (f.requests) x.resources.requests = Object.assign({}, x.resources.requests, parse(f.requests)); ["limits", "requests"].forEach(function (k) { Object.keys(x.resources[k] || {}).forEach(function (r) { if (x.resources[k][r] === "0") delete x.resources[k][r]; }); }); }); });
      io.out(ref(w.k, w.o) + " resource requirements updated\n");
    },
    serviceaccount: function (c, io, f) { var args = f._.slice(1), sa = args.pop(), w = workload(c, args); save(c, w.k, w.o, function (n) { tplOf(n).spec.serviceAccountName = sa; delete tplOf(n).spec.serviceAccount; }); io.out(ref(w.k, w.o) + " serviceaccount updated\n"); },
    selector: function (c, io, f) { var args = f._.slice(1), sel = args.pop(), w = workload(c, args); save(c, w.k, w.o, function (n) { n.spec.selector = {}; sel.split(",").forEach(function (p) { var x = p.split("="); n.spec.selector[x[0]] = x[1]; }); }); io.out(ref(w.k, w.o) + " selector updated\n"); }
  };
  setCmds.sa = setCmds.serviceaccount;
  cmds.set = function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "set", str: "c containers from prefix limits requests l selector dry-run o output", bool: "list all overwrite local record", alias: { c: "containers", l: "selector", o: "output" } })), c = ctx(sim, f), sub = setCmds[f._[0]];
    if (!sub) throw kerr("error: unknown command \"" + (f._[0] || "") + "\" for \"kubectl set\" (simulated: image, env, resources, serviceaccount, selector)");
    return sub(c, io, f);
  };

  /* ---------- rollout ---------- */
  function revOf(r) { return +((r.metadata.annotations || {})["deployment.kubernetes.io/revision"] || 0); }
  var rollout = {
    status: async function (c, io, f, w) {
      var sim = c.sim, K = c.K, d = w.o, name = d.metadata.name, last = "", timeout = f.timeout ? parseDur(f.timeout) : Infinity, waited = 0, cap = sim.realtime ? Infinity : 240;
      if (d.kind !== "Deployment" && d.kind !== "StatefulSet" && d.kind !== "DaemonSet") throw kerr("error: no rollout status viewer has been implemented for " + d.kind);
      for (;;) {
        sim.reconcile();
        d = K.get(d.kind, d.metadata.namespace, name);
        if (!d) throw kerr("Error from server (NotFound): " + K8.qual(w.k) + " \"" + name + "\" not found");
        var s = d.status || {}, msg = null, want = d.kind === "DaemonSet" ? s.desiredNumberScheduled : d.spec.replicas;
        if (d.kind === "Deployment") {
          var prog = (s.conditions || []).filter(function (x) { return x.type === "Progressing"; })[0];
          if (prog && prog.reason === "ProgressDeadlineExceeded") throw kerr("error: deployment \"" + name + "\" exceeded its progress deadline");
          if ((s.observedGeneration || 0) < d.metadata.generation) msg = "Waiting for deployment spec update to be observed...";
          else if ((s.updatedReplicas || 0) < want) msg = "Waiting for deployment \"" + name + "\" rollout to finish: " + (s.updatedReplicas || 0) + " out of " + want + " new replicas have been updated...";
          else if ((s.replicas || 0) > (s.updatedReplicas || 0)) msg = "Waiting for deployment \"" + name + "\" rollout to finish: " + ((s.replicas || 0) - (s.updatedReplicas || 0)) + " old replicas are pending termination...";
          else if ((s.availableReplicas || 0) < (s.updatedReplicas || 0)) msg = "Waiting for deployment \"" + name + "\" rollout to finish: " + (s.availableReplicas || 0) + " of " + (s.updatedReplicas || 0) + " updated replicas are available...";
          else { io.out("deployment \"" + name + "\" successfully rolled out\n"); return 0; }
        } else if (d.kind === "StatefulSet") {
          if ((s.readyReplicas || 0) < want || (s.updatedReplicas || 0) < want) msg = "Waiting for " + (want - Math.min(s.readyReplicas || 0, s.updatedReplicas || 0)) + " pods to be ready...";
          else { io.out("statefulset rolling update complete " + want + " pods at revision " + s.currentRevision + "...\n"); return 0; }
        } else {
          if ((s.updatedNumberScheduled || 0) < want) msg = "Waiting for daemon set \"" + name + "\" rollout to finish: " + (s.updatedNumberScheduled || 0) + " out of " + want + " new pods have been updated...";
          else if ((s.numberAvailable || 0) < want) msg = "Waiting for daemon set \"" + name + "\" rollout to finish: " + (s.numberAvailable || 0) + " of " + want + " updated pods are available...";
          else { io.out("daemon set \"" + name + "\" successfully rolled out\n"); return 0; }
        }
        if (msg !== last) { io.out(msg + "\n"); last = msg; }
        if (f.watch === false) return 0;
        if (waited >= timeout || waited >= cap) throw kerr("error: timed out waiting for the condition");
        await sim.wait(1000); waited += 1;
      }
    },
    history: function (c, io, f, w) {
      var d = w.o, rss = c.K.owned(d, "ReplicaSet").sort(function (x, y) { return revOf(x) - revOf(y); });
      if (d.kind !== "Deployment") throw kerr("error: rollout history is only simulated for deployments");
      if (f.revision) {
        var r = rss.filter(function (x) { return revOf(x) === +f.revision; })[0];
        if (!r) throw kerr("error: unable to find the specified revision");
        var L = [ref(w.k, d) + " with revision #" + f.revision, "Pod Template:"], tpl = r.spec.template;
        Object.keys(tpl.metadata.labels).forEach(function (k, i) { L.push((i ? "\t" : "  Labels:\t") + k + "=" + tpl.metadata.labels[k]); });
        L.push("  Containers:");
        tpl.spec.containers.forEach(function (x) { L.push("   " + x.name + ":", "    Image:\t" + x.image, "    Port:\t" + ((x.ports || []).map(function (p) { return p.containerPort + "/" + p.protocol; }).join(", ") || "<none>"), "    Host Port:\t" + ((x.ports || []).map(function (p) { return "0/" + p.protocol; }).join(", ") || "<none>"), "    Environment:\t" + ((x.env || []).length ? "" : "<none>")); (x.env || []).forEach(function (e) { L.push("      " + e.name + ":\t" + (e.value == null ? "<from reference>" : e.value)); }); L.push("    Mounts:\t<none>"); });
        L.push("  Volumes:\t<none>");
        io.out(L.join("\n") + "\n\n"); return;
      }
      io.out(ref(w.k, d) + " \nREVISION  CHANGE-CAUSE\n" + rss.map(function (r) { return String(revOf(r)).padEnd(10) + ((r.metadata.annotations || {})["kubernetes.io/change-cause"] || "<none>"); }).join("\n") + "\n\n");
    },
    undo: function (c, io, f, w) {
      var d = w.o, rss = c.K.owned(d, "ReplicaSet").sort(function (x, y) { return revOf(y) - revOf(x); });
      if (d.kind !== "Deployment") throw kerr("error: rollout undo is only simulated for deployments");
      var to = f["to-revision"] && f["to-revision"] !== "0" ? rss.filter(function (r) { return revOf(r) === +f["to-revision"]; })[0] : rss[1];
      if (f["to-revision"] && f["to-revision"] !== "0" && !to) throw kerr("error: unable to find specified revision " + f["to-revision"] + " in history");
      if (!to) throw kerr("error: no rollout history found for deployment \"" + d.metadata.name + "\"");
      if (to === rss[0]) { io.out(ref(w.k, d) + " skipped rollback (current template already matches revision " + revOf(to) + ")\n"); return; }
      kc.save(c, w.k, d, function (n) { var tpl = U.clone(clean(to.spec.template)); delete tpl.metadata.labels["pod-template-hash"]; n.spec.template = tpl; var cause = (to.metadata.annotations || {})["kubernetes.io/change-cause"]; n.metadata.annotations = n.metadata.annotations || {}; if (cause) n.metadata.annotations["kubernetes.io/change-cause"] = cause; else delete n.metadata.annotations["kubernetes.io/change-cause"]; });
      io.out(ref(w.k, d) + " rolled back\n");
    },
    restart: function (c, io, f, w) {
      if (["Deployment", "StatefulSet", "DaemonSet"].indexOf(w.o.kind) < 0) throw kerr("error: " + w.k.plural + " \"" + w.o.metadata.name + "\" restarting is not supported");
      kc.save(c, w.k, w.o, function (n) { n.spec.template.metadata = n.spec.template.metadata || {}; n.spec.template.metadata.annotations = Object.assign({}, n.spec.template.metadata.annotations, { "kubectl.kubernetes.io/restartedAt": c.sim.iso() }); });
      io.out(ref(w.k, w.o) + " restarted\n");
    },
    pause: function (c, io, f, w) { if (w.o.spec.paused) throw kerr("error: " + K8.qual(w.k) + " \"" + w.o.metadata.name + "\" is already paused"); kc.save(c, w.k, w.o, function (n) { n.spec.paused = true; }); io.out(ref(w.k, w.o) + " paused\n"); },
    resume: function (c, io, f, w) { if (!w.o.spec.paused) throw kerr("error: " + K8.qual(w.k) + " \"" + w.o.metadata.name + "\" is not paused"); kc.save(c, w.k, w.o, function (n) { delete n.spec.paused; }); io.out(ref(w.k, w.o) + " resumed\n"); }
  };
  function parseDur(s) { var m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(s)); if (!m) throw kerr("error: invalid argument \"" + s + "\" for \"--timeout\" flag: time: invalid duration \"" + s + "\""); return parseFloat(m[1]) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[m[2] || "s"]); }
  kc.parseDur = parseDur;
  cmds.rollout = function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "rollout", str: "revision to-revision timeout l selector", bool: "w watch", alias: { w: "watch", l: "selector" } })), c = ctx(sim, f), sub = rollout[f._[0]];
    if (!sub) throw kerr("error: unknown command \"" + (f._[0] || "") + "\" for \"kubectl rollout\"\nAvailable Commands: history, pause, restart, resume, status, undo");
    if (f._.length < 2) throw kerr("error: required resource not specified");
    return sub(c, io, f, workload(c, f._.slice(1)));
  };

  /* ---------- expose, label, annotate, patch, edit, diff ---------- */
  cmds.expose = function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "expose", str: "port target-port type name protocol selector dry-run o output cluster-ip l labels external-ip", bool: "", alias: { o: "output", l: "labels" } })), c = ctx(sim, f);
    var t = kc.parseTargets(f._)[0];
    if (!t || !t.names.length) throw kerr("error: you must provide one or more resources by argument or filename");
    var o = kc.getOne(c, t.k, t.names[0]), sel, port = f.port, tpl = o.kind === "Pod" ? o : o.spec.template;
    if (o.kind === "Pod") { sel = o.metadata.labels; if (!sel || !Object.keys(sel).length) throw kerr("error: couldn't retrieve selectors via --selector flag or introspection: the pod has no labels and cannot be exposed"); }
    else if (o.kind === "Service") sel = o.spec.selector;
    else if (o.spec.selector) { if (o.spec.selector.matchExpressions) throw kerr("error: couldn't retrieve selectors via --selector flag or introspection: invalid deployment: no selectors, therefore cannot be exposed"); sel = o.spec.selector.matchLabels; }
    else throw kerr("error: cannot expose a " + o.kind);
    if (f.selector) { sel = {}; f.selector.split(",").forEach(function (p) { var x = p.split("="); sel[x[0]] = x[1]; }); }
    if (!port) { var cp = tpl && tpl.spec.containers[0].ports; if (!cp || !cp.length) throw kerr("error: couldn't find port via --port flag or introspection\nSee 'kubectl expose -h' for help and examples"); port = cp[0].containerPort; }
    var sp = { port: +port, protocol: f.protocol || "TCP", targetPort: f["target-port"] ? (/^\d+$/.test(f["target-port"]) ? +f["target-port"] : f["target-port"]) : +port };
    var svc = { apiVersion: "v1", kind: "Service", metadata: { name: f.name || o.metadata.name, labels: o.metadata.labels ? Object.assign({}, o.metadata.labels) : undefined }, spec: { ports: [sp], selector: Object.assign({}, sel) } };
    if (f.type) svc.spec.type = f.type;
    if (f["dry-run"]) return kc.finish(c, io, svc, f);
    svc.metadata.namespace = c.ns; c.K.prepare(svc); c.can("create", BY_KIND.Service, svc.metadata.namespace, svc.metadata.name);
    try { c.K.create(svc); } catch (e) { throw kc.fromServer(e); }
    io.out("service/" + svc.metadata.name + " exposed\n");
  };
  function labeler(field, word) {
    return function (a, io, sim) {
      var f = U.flags(a, spec({ cmd: field, str: "l selector o output dry-run", bool: "overwrite all list", alias: { l: "selector", o: "output" } })), c = ctx(sim, f);
      var changes = f._.filter(function (x) { return /^[\w./-]+=/.test(x) || /^[\w./-]+-$/.test(x); }), rest = f._.filter(function (x) { return changes.indexOf(x) < 0; });
      if (!rest.length) throw kerr("error: one or more resources must be specified as <resource> <name> or <resource>/<name>");
      if (!changes.length && !f.list) throw kerr("error: at least one " + field.slice(0, -1) + " update is required");
      kc.parseTargets(rest).forEach(function (t) {
        var objs = t.names.length ? t.names.map(function (n) { return kc.getOne(c, t.k, n, "patch"); }) : c.K.list(t.k.kind, t.k.namespaced ? c.ns : null, f.selector ? K8.parseSelector(f.selector) : null);
        if (!t.names.length && !f.all && !f.selector) throw kerr("error: resource(s) were provided, but no name was specified");
        objs.forEach(function (o) {
          var m = Object.assign({}, o.metadata[field]), changed = false;
          changes.forEach(function (ch) {
            if (/-$/.test(ch) && ch.indexOf("=") < 0) { var key = ch.slice(0, -1); if (m[key] === undefined) { io.out(field.slice(0, -1) + " \"" + key + "\" not found.\n"); return; } delete m[key]; changed = true; return; }
            var i = ch.indexOf("="), k2 = ch.slice(0, i), v = ch.slice(i + 1);
            if (m[k2] !== undefined && m[k2] !== v && !f.overwrite) throw kerr("error: '" + k2 + "' already has a value (" + m[k2] + "), and --overwrite is false");
            if (field === "labels" && v && !/^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/.test(v)) throw kerr("error: invalid label value: \"" + ch + "\": a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character");
            if (m[k2] !== v) changed = true; m[k2] = v;
          });
          if (changed) { o.metadata[field] = m; c.K.put(o); }
          io.out(ref(t.k, o) + " " + (changed ? word : "not " + word) + "\n");
        });
      });
    };
  }
  cmds.label = labeler("labels", "labeled"); cmds.annotate = labeler("annotations", "annotated");

  function mergePatch(dst, patch, strategic) {
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v === null) { delete dst[k]; return; }
      if (strategic && Array.isArray(v) && Array.isArray(dst[k]) && v.every(function (x) { return x && typeof x === "object" && x.name != null; })) {
        v.forEach(function (item) { var cur = dst[k].filter(function (x) { return x && x.name === item.name; })[0]; if (cur) mergePatch(cur, item, true); else dst[k].push(item); });
        return;
      }
      if (v && typeof v === "object" && !Array.isArray(v) && dst[k] && typeof dst[k] === "object" && !Array.isArray(dst[k])) mergePatch(dst[k], v, strategic);
      else dst[k] = v;
    });
  }
  function jsonPatch(doc, ops) {
    ops.forEach(function (op) {
      var parts = String(op.path || "").split("/").slice(1).map(function (p) { return p.replace(/~1/g, "/").replace(/~0/g, "~"); }), cur = doc;
      for (var i = 0; i < parts.length - 1; i++) { cur = cur[parts[i]]; if (cur == null) throw kerr("The request is invalid: the server rejected our request due to an error in our request"); }
      var last = parts[parts.length - 1];
      if (op.op === "remove") { if (Array.isArray(cur)) cur.splice(+last, 1); else delete cur[last]; }
      else if (op.op === "add" && Array.isArray(cur)) { if (last === "-") cur.push(op.value); else cur.splice(+last, 0, op.value); }
      else if (op.op === "add" || op.op === "replace") cur[last] = op.value;
      else throw kerr("error: unsupported JSON patch operation \"" + op.op + "\"");
    });
  }
  cmds.patch = function (a, io, sim, sc) {
    var f = U.flags(a, spec({ cmd: "patch", str: "p patch type patch-file o output dry-run subresource", bool: "", multi: "f filename", alias: { p: "patch", o: "output" } })), c = ctx(sim, f);
    var text = f.patch != null ? f.patch : f["patch-file"] ? sc.fs.read(U.norm(f["patch-file"], sc.cwd)) : null;
    if (text == null) throw kerr("error: must specify -p or --patch-file to patch resource");
    var patch; try { patch = S.YAML.load(text); } catch (e) { throw kerr("error: unable to parse \"" + text + "\": yaml: did not find expected node content"); }
    var w = workload(c, f._), type = f.type || "strategic";
    if (["strategic", "merge", "json"].indexOf(type) < 0) throw kerr("error: --type must be one of [json merge strategic], not \"" + type + "\"");
    var before = JSON.stringify(clean(w.o));
    var next = kc.save(c, w.k, w.o, function (n) { if (type === "json") jsonPatch(n, patch); else mergePatch(n, patch, type === "strategic"); });
    io.out(ref(w.k, w.o) + (JSON.stringify(clean(next)) === before ? " patched (no change)" : " patched") + "\n");
  };
  cmds.edit = async function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "edit", str: "o output", bool: "", multi: "f filename", alias: { o: "output" } })), c = ctx(sim, f);
    var w = workload(c, f._);
    if (!sim.ui.edit) throw kerr("error: no editor is available here");
    var before = "# Please edit the object below. Lines beginning with a '#' will be ignored,\n# and an empty file will abort the edit. If an error occurs while saving this file will be\n# reopened with the relevant failures.\n#\n" + S.yamlDump(clean(strip(w.o)), true);
    var text = await sim.ui.edit(w.k.singular + "-" + w.o.metadata.name + ".yaml", before);
    if (text == null || text.trim() === before.trim() || !text.replace(/^#.*$/gm, "").trim()) { io.out("Edit cancelled, no changes made.\n"); return 0; }
    var obj; try { obj = S.YAML.load(text); } catch (e) { throw kc.yamlError(e, "edited file"); }
    if (!obj || obj.kind !== w.o.kind || !obj.metadata || obj.metadata.name !== w.o.metadata.name) throw kerr("error: At least one of apiVersion, kind and name was changed");
    kc.save(c, w.k, w.o, function (n) { ["spec", "data", "stringData", "rules", "subjects", "type"].forEach(function (k) { if (obj[k] !== undefined) n[k] = obj[k]; else if (k !== "stringData") delete n[k]; }); n.metadata.labels = obj.metadata.labels; n.metadata.annotations = Object.assign({}, obj.metadata.annotations, keepLast(w.o)); });
    io.out(ref(w.k, w.o) + " edited\n");
  };
  function strip(o) { var x = clean(o); if (x.metadata.annotations) { delete x.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]; if (!Object.keys(x.metadata.annotations).length) delete x.metadata.annotations; } return x; }
  function keepLast(o) { var v = (o.metadata.annotations || {})["kubectl.kubernetes.io/last-applied-configuration"]; return v ? { "kubectl.kubernetes.io/last-applied-configuration": v } : {}; }
  function lineDiff(a, b) {   // minimal unified-style diff (LCS)
    var n = a.length, m = b.length, t = [], i, j, out = [];
    for (i = 0; i <= n; i++) { t[i] = []; for (j = 0; j <= m; j++) t[i][j] = 0; }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    i = 0; j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) { out.push(" " + a[i]); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) out.push("-" + a[i++]); else out.push("+" + b[j++]); }
    while (i < n) out.push("-" + a[i++]); while (j < m) out.push("+" + b[j++]);
    return out;
  }
  kc.lineDiff = lineDiff;
  kc.diffText = function (aName, bName, aText, bText, ctxLines) {
    var d = lineDiff(aText === "" ? [] : aText.split("\n"), bText === "" ? [] : bText.split("\n")), keep = {}, n = ctxLines == null ? 3 : ctxLines;
    if (!d.some(function (l) { return l[0] !== " "; })) return "";
    d.forEach(function (l, i) { if (l[0] !== " ") for (var k = Math.max(0, i - n); k <= Math.min(d.length - 1, i + n); k++) keep[k] = 1; });
    var out = ["--- " + aName, "+++ " + bName], la = 0, lb = 0, hunk = null;
    function flush() { if (hunk) { out.push("@@ -" + (hunk.ac ? hunk.a : hunk.a - 1) + (hunk.ac === 1 ? "" : "," + hunk.ac) + " +" + (hunk.bc ? hunk.b : hunk.b - 1) + (hunk.bc === 1 ? "" : "," + hunk.bc) + " @@"); out = out.concat(hunk.lines); hunk = null; } }
    d.forEach(function (l, i) {
      var isA = l[0] !== "+", isB = l[0] !== "-";
      if (keep[i]) { if (!hunk) hunk = { a: la + 1, b: lb + 1, ac: 0, bc: 0, lines: [] }; hunk.lines.push(l); if (isA) hunk.ac++; if (isB) hunk.bc++; } else flush();
      if (isA) la++; if (isB) lb++;
    });
    flush();
    return out.join("\n") + "\n";
  };
  cmds.diff = function (a, io, sim, sc) {
    var f = U.flags(a, spec({ cmd: "diff", str: "", bool: "R recursive server-side", multi: "f filename", alias: { f: "filename", R: "recursive" } })), c = ctx(sim, f), K = c.K, any = false;
    if (!f.filename) throw kerr("error: must specify one of -f and -k");
    kc.readManifests(sim, f.filename, sc, io, f.recursive).forEach(function (d) {
      var k = K.prepare(d.obj, d.file), live = K.get(k.kind, d.obj.metadata.namespace, d.obj.metadata.name), want = U.clone(d.obj);
      try { K.validate(U.clone(want), k, live); } catch (e) { throw kc.fromServer(e); }
      var merged = live ? clean(strip(live)) : null;
      if (live) { ["spec", "data", "rules", "subjects"].forEach(function (key) { if (want[key] !== undefined) merged[key] = mergeDeep(U.clone(merged[key]), want[key]); }); if (want.metadata.labels) merged.metadata.labels = Object.assign({}, merged.metadata.labels, want.metadata.labels); K.applyDefaults(merged); delete merged.status; }
      else { merged = want; K.applyDefaults(merged); }
      var liveC = live ? clean(strip(live)) : null; if (liveC) delete liveC.status;
      var t = kc.diffText("live/" + k.plural + "/" + d.obj.metadata.name, "merged/" + k.plural + "/" + d.obj.metadata.name, liveC ? S.yamlDump(liveC, true).replace(/\n$/, "") : "", S.yamlDump(clean(merged), true).replace(/\n$/, ""));
      if (t) { io.out(t); any = true; }
    });
    return any ? 1 : 0;
  };
  function mergeDeep(dst, src) {
    if (!src || typeof src !== "object" || Array.isArray(src) || !dst || typeof dst !== "object" || Array.isArray(dst)) {
      if (Array.isArray(src) && Array.isArray(dst) && src.every(function (x) { return x && typeof x === "object" && x.name != null; })) return src.map(function (x) { var cur = dst.filter(function (y) { return y && y.name === x.name; })[0]; return cur ? mergeDeep(cur, x) : x; });
      return src;
    }
    Object.keys(src).forEach(function (k) { dst[k] = mergeDeep(dst[k], src[k]); });
    return dst;
  }

  /* ---------- top, events, wait ---------- */
  cmds.top = function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "top", str: "l selector sort-by", bool: "containers no-headers sum", alias: { l: "selector" } })), c = ctx(sim, f), K = c.K;
    var ms = K.list("Pod", "kube-system").filter(function (p) { return (p.metadata.labels || {})["k8s-app"] === "metrics-server" && K8.isReady(p); });
    if (!ms.length) throw kerr("error: Metrics API not available");
    function usage(p) { var rt = K.rt.get(p.metadata.uid), cpu = 0, mem = 0, per = []; if (rt) rt.main.forEach(function (cs) { if (cs.state === "running" && cs.proc) { cpu += cs.proc.cpu || 1; mem += cs.proc.mem || 1; per.push([cs.name, cs.proc.cpu || 1, cs.proc.mem || 1]); } }); return { cpu: cpu, mem: mem, per: per }; }
    if (/^no/.test(f._[0] || "")) {
      var rows = [["NAME", "CPU(cores)", "CPU(%)", "MEMORY(bytes)", "MEMORY(%)"]];
      K.list("Node").forEach(function (n) { var cpu = 60, mem = 420; K.list("Pod").forEach(function (p) { if (p.spec.nodeName === n.metadata.name) { var u = usage(p); cpu += u.cpu; mem += u.mem; } }); rows.push([n.metadata.name, cpu + "m", Math.round(100 * cpu / K8.cpu(n.status.allocatable.cpu)) + "%", mem + "Mi", Math.round(100 * mem * 1048576 / K8.mem(n.status.allocatable.memory)) + "%"]); });
      io.out(U.table(rows) + "\n"); return;
    }
    if (!/^po/.test(f._[0] || "")) throw kerr("error: unknown command \"" + (f._[0] || "") + "\" for \"kubectl top\"\nAvailable Commands: node, pod");
    var pods = (f._[1] ? [kc.getOne(c, BY_KIND.Pod, f._[1])] : K.list("Pod", c.all ? null : c.ns, f.selector ? K8.parseSelector(f.selector) : null)).filter(function (p) { return usage(p).per.length; });
    if (!pods.length) { io.err("No resources found" + (c.all ? "" : " in " + c.ns + " namespace.") + "\n"); return; }
    var head = (c.all ? ["NAMESPACE"] : []).concat(f.containers ? ["POD", "NAME"] : ["NAME"], ["CPU(cores)", "MEMORY(bytes)"]), out = [head];
    pods.forEach(function (p) { var u = usage(p), pre = c.all ? [p.metadata.namespace] : []; if (f.containers) u.per.forEach(function (x) { out.push(pre.concat([p.metadata.name, x[0], x[1] + "m", x[2] + "Mi"])); }); else out.push(pre.concat([p.metadata.name, u.cpu + "m", u.mem + "Mi"])); });
    if (f["sort-by"]) { var col = out[0].indexOf(f["sort-by"] === "cpu" ? "CPU(cores)" : "MEMORY(bytes)"); out = [out[0]].concat(out.slice(1).sort(function (x, y) { return parseInt(y[col], 10) - parseInt(x[col], 10); })); }
    io.out(U.table(f["no-headers"] ? out.slice(1) : out) + "\n");
  };
  cmds.events = function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "events", str: "for types o output", bool: "w watch no-headers", alias: { w: "watch", o: "output" } })), c = ctx(sim, f), K = c.K;
    c.can("list", BY_KIND.Event, c.all ? null : c.ns);
    var evs = K.list("Event", c.all ? null : c.ns).sort(function (x, y) { return x._last - y._last; });
    if (f["for"]) { var p = f["for"].split("/"), k = kc.kindOf(p[0]); evs = evs.filter(function (e) { return e.involvedObject.kind === k.kind && e.involvedObject.name === p[1]; }); }
    if (f.types) evs = evs.filter(function (e) { return f.types.split(",").indexOf(e.type) >= 0; });
    if (!evs.length) { io.err("No events found in " + c.ns + " namespace.\n"); return; }
    io.out(U.table([(c.all ? ["NAMESPACE"] : []).concat(["LAST SEEN", "TYPE", "REASON", "OBJECT", "MESSAGE"])].concat(evs.map(function (e) { return (c.all ? [e.metadata.namespace] : []).concat([U.age(sim.now - e._last) + (e.count > 1 ? " (x" + e.count + " over " + U.age(sim.now - e._first) + ")" : ""), e.type, e.reason, e.involvedObject.kind + "/" + e.involvedObject.name, e.message]); }))) + "\n");
  };
  cmds.wait = async function (a, io, sim) {
    var f = U.flags(a, spec({ cmd: "wait", str: "for timeout l selector o output", bool: "all", multi: "f filename", alias: { l: "selector", o: "output" } })), c = ctx(sim, f), K = c.K;
    if (!f["for"]) throw kerr("error: You must provide one or more resources by argument or filename.\n(and --for=condition=NAME, --for=delete or --for=jsonpath='{.path}'=value)");
    var timeout = f.timeout ? kc.parseDur(f.timeout) : 30, targets = kc.parseTargets(f._), m = /^condition=([\w-]+)(?:=(\w+))?$/i.exec(f["for"]), del = f["for"] === "delete", jp = /^jsonpath=(.+?)(?:=(.*))?$/.exec(f["for"]);
    if (!m && !del && !jp) throw kerr("error: unrecognized condition: \"" + f["for"] + "\"");
    if (!targets.length) throw kerr("error: You must provide one or more resources by argument or filename.");
    function list() {
      var out = [];
      targets.forEach(function (t) { var ns = t.k.namespaced ? c.ns : null; if (t.names.length) t.names.forEach(function (n) { var o = K.get(t.k.kind, ns, n); if (!o && !del) throw kc.notFound(t.k, n); if (o) out.push({ k: t.k, o: o }); }); else K.list(t.k.kind, ns, f.selector ? K8.parseSelector(f.selector) : null).forEach(function (o) { out.push({ k: t.k, o: o }); }); });
      return out;
    }
    function met(o) {
      if (jp) { var v = kc.jsonpath(jp[1], clean(o)); return jp[2] == null ? v !== "" : v === jp[2]; }
      var want = (m[2] || "true").toLowerCase(), cond = ((o.status || {}).conditions || []).filter(function (x) { return x.type.toLowerCase() === m[1].toLowerCase(); })[0];
      return !!cond && cond.status.toLowerCase() === want;
    }
    var first = list(), done = {}, waited = 0;
    if (!first.length && !del) throw kerr("error: no matching resources found");
    for (;;) {
      sim.reconcile();
      var cur = list(), pending = 0;
      if (del) { first.forEach(function (x) { var id = ref(x.k, x.o); if (!done[id] && !cur.some(function (y) { return y.o.metadata.uid === x.o.metadata.uid; })) { done[id] = 1; io.out(id + " condition met\n"); } }); pending = first.length - Object.keys(done).length; }
      else cur.forEach(function (x) { var id = ref(x.k, x.o); if (done[id]) return; if (met(x.o)) { done[id] = 1; io.out(id + " condition met\n"); } else pending++; });
      if (!pending) return 0;
      if (waited >= timeout) {
        (del ? first : cur).forEach(function (x) { var id = ref(x.k, x.o); if (!done[id]) io.err("error: timed out waiting for the condition on " + x.k.plural + "/" + x.o.metadata.name + "\n"); });
        return 1;
      }
      await sim.wait(1000); waited++;
    }
  };

  /* ---------- cluster, nodes, config, auth ---------- */
  cmds["cluster-info"] = function (a, io) { io.out("Kubernetes control plane is running at https://192.168.49.2:6443\nCoreDNS is running at https://192.168.49.2:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\n\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.\n"); };
  cmds.version = function (a, io) { var f = U.flags(a, spec({ str: "o output", bool: "client short" })); io.out("Client Version: v1.37.0\nKustomize Version: v5.7.1\n" + (f.client ? "" : "Server Version: v1.37.0\n")); };
  cmds["api-resources"] = function (a, io) {
    var f = U.flags(a, spec({ str: "api-group o output sort-by verbs", bool: "namespaced no-headers" }));
    var list = K8.KINDS.filter(function (k) { return (f.namespaced === undefined || k.namespaced === (f.namespaced !== false)) && (f["api-group"] == null || k.group === f["api-group"]); }).sort(function (x, y) { return x.group < y.group ? -1 : x.group > y.group ? 1 : x.plural < y.plural ? -1 : 1; });
    io.out(U.table([["NAME", "SHORTNAMES", "APIVERSION", "NAMESPACED", "KIND"]].concat(list.map(function (k) { return [k.plural, k.short, k.api, String(k.namespaced), k.kind]; }))) + "\n");
  };
  cmds["api-versions"] = function (a, io) { var s = {}; K8.KINDS.forEach(function (k) { s[k.api] = 1; }); io.out(Object.keys(s).sort().join("\n") + "\n"); };
  var EXPLAIN = {
    pods: "Pod is a collection of containers that can run on a host. This resource is created by clients and scheduled onto hosts.",
    deployments: "Deployment enables declarative updates for Pods and ReplicaSets.", services: "Service is a named abstraction of software service (for example, mysql) consisting of local port (for example 3306) that the proxy listens on, and the selector that determines which pods will answer requests sent through the proxy.",
    configmaps: "ConfigMap holds configuration data for pods to consume.", secrets: "Secret holds secret data of a certain type. The total bytes of the values in the Data field must be less than MaxSecretSize bytes.",
    ingresses: "Ingress is a collection of rules that allow inbound connections to reach the endpoints defined by a backend.", statefulsets: "StatefulSet represents a set of pods with consistent identities.", jobs: "Job represents the configuration of a single job.", persistentvolumeclaims: "PersistentVolumeClaim is a user's request for and claim to a persistent volume"
  };
  cmds.explain = function (a, io) {
    var f = U.flags(a, spec({ str: "api-version output", bool: "recursive" }));
    if (!f._[0]) throw kerr("error: You must specify the type of resource to explain. Use \"kubectl api-resources\" for a complete list of supported resources.");
    var parts = f._[0].split("."), k = kc.kindOf(parts[0]), sch = S.k8s.schemaFor ? S.k8s.schemaFor(k.kind) : null, node = sch;
    for (var i = 1; i < parts.length && node; i++) { node = Array.isArray(node) ? node[0] : node; node = node && typeof node === "object" ? node[parts[i]] : null; if (node === undefined || node === null) throw kerr("error: field \"" + parts[i] + "\" does not exist"); }
    if (Array.isArray(node)) node = node[0];
    var L = [(k.group ? "GROUP:      " + k.group + "\n" : "") + "KIND:       " + k.kind, "VERSION:    " + k.api.split("/").pop(), ""];
    if (parts.length > 1) L.push("FIELD: " + parts[parts.length - 1], ""); else L.push("DESCRIPTION:", "    " + (EXPLAIN[k.plural] || k.kind + " objects are managed through the " + (k.group || "core") + " API group."), "");
    if (node && typeof node === "object") { L.push("FIELDS:"); Object.keys(node).sort().forEach(function (n) { var t = node[n]; L.push("  " + n + "\t<" + (Array.isArray(t) ? "[]Object" : t && typeof t === "object" ? "Object" : t === "*" ? "Object" : "value") + ">"); }); }
    else if (parts.length === 1) L.push("FIELDS:", "  apiVersion\t<string>", "  kind\t<string>", "  metadata\t<ObjectMeta>", "  spec\t<Object>", "  status\t<Object>");
    else L.push("    (a leaf field: see the Kubernetes API reference for its type and meaning)");
    io.out(L.join("\n") + "\n\n");
  };
  function nodeOf(c, name, verb) { return kc.getOne(c, BY_KIND.Node, name, verb || "patch"); }
  cmds.cordon = function (a, io, sim) { var f = U.flags(a, spec({})), c = ctx(sim, f); f._.forEach(function (n) { var node = nodeOf(c, n); if (node.spec.unschedulable) { io.out("node/" + n + " already cordoned\n"); return; } node.spec.unschedulable = true; io.out("node/" + n + " cordoned\n"); }); };
  cmds.uncordon = function (a, io, sim) { var f = U.flags(a, spec({})), c = ctx(sim, f); f._.forEach(function (n) { var node = nodeOf(c, n); if (!node.spec.unschedulable) { io.out("node/" + n + " already uncordoned\n"); return; } delete node.spec.unschedulable; io.out("node/" + n + " uncordoned\n"); }); };
  cmds.drain = async function (a, io, sim) {
    var f = U.flags(a, spec({ str: "grace-period timeout pod-selector", bool: "ignore-daemonsets delete-emptydir-data force disable-eviction" })), c = ctx(sim, f), K = c.K;
    if (!f._.length) throw kerr("error: USAGE: drain NODE [flags]");
    var node = nodeOf(c, f._[0]), name = node.metadata.name;
    io.out("node/" + name + (node.spec.unschedulable ? " already cordoned\n" : " cordoned\n")); node.spec.unschedulable = true;
    var pods = K.list("Pod").filter(function (p) { return p.spec.nodeName === name; }), ds = [], bare = [], local = [], evict = [];
    pods.forEach(function (p) {
      var owner = (p.metadata.ownerReferences || [])[0], id = p.metadata.namespace + "/" + p.metadata.name;
      if (owner && owner.kind === "DaemonSet") { ds.push(id); return; }
      if (!owner) { if (p.metadata.namespace === "kube-system" && p.spec.hostNetwork) return; bare.push(id); }
      if ((p.spec.volumes || []).some(function (v) { return v.emptyDir; })) local.push(id);
      evict.push(p);
    });
    var errs = [];
    if (ds.length && !f["ignore-daemonsets"]) errs.push("cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): " + ds.join(", "));
    if (bare.length && !f.force) errs.push("cannot delete cannot delete Pods that declare no controller (use --force to override): " + bare.join(", "));
    if (local.length && !f["delete-emptydir-data"]) errs.push("cannot delete Pods with local storage (use --delete-emptydir-data to override): " + local.join(", "));
    if (errs.length) throw kerr("error: unable to drain node \"" + name + "\" due to error: " + (errs.length > 1 ? "[" + errs.join(", ") + "]" : errs[0]) + ", continuing command...\nThere are pending nodes to be drained:\n " + name + "\n" + errs.join("\n"));
    if (ds.length) io.err("Warning: ignoring DaemonSet-managed Pods: " + ds.join(", ") + "\n");
    evict.forEach(function (p) { io.out("evicting pod " + p.metadata.namespace + "/" + p.metadata.name + "\n"); });
    await sim.wait(1000);
    evict.forEach(function (p) { K.remove(p); io.out("pod/" + p.metadata.name + " evicted\n"); });
    io.out("node/" + name + " drained\n");
  };
  cmds.taint = function (a, io, sim) {
    var f = U.flags(a, spec({ str: "l selector", bool: "all overwrite" })), c = ctx(sim, f);
    if (!/^no/.test(f._[0] || "") || f._.length < 3) throw kerr("error: at least one taint update is required\nUsage: kubectl taint nodes NODE KEY[=VALUE]:EFFECT | KEY[:EFFECT]-");
    var node = nodeOf(c, f._[1]), changed = false, removed = false;
    f._.slice(2).forEach(function (t) {
      var rm = /-$/.test(t), m = /^([\w./-]+?)(?:=([\w.-]*))?(?::(\w+))?$/.exec(rm ? t.slice(0, -1) : t);
      if (!m) throw kerr("error: invalid taint spec: " + t);
      var taints = node.spec.taints || [];
      if (rm) { var before = taints.length; node.spec.taints = taints.filter(function (x) { return !(x.key === m[1] && (!m[3] || x.effect === m[3])); }); if (node.spec.taints.length === before) throw kerr("error: taint \"" + m[1] + (m[3] ? ":" + m[3] : "") + "\" not found"); removed = true; if (!node.spec.taints.length) delete node.spec.taints; return; }
      if (["NoSchedule", "PreferNoSchedule", "NoExecute"].indexOf(m[3]) < 0) throw kerr("error: invalid taint effect: " + (m[3] || "") + ", unsupported taint effect");
      if (taints.some(function (x) { return x.key === m[1] && x.effect === m[3]; }) && !f.overwrite) throw kerr("error: node " + node.metadata.name + " already has " + m[1] + " taint(s) with same effect(s) and --overwrite is false");
      var nt = { key: m[1], effect: m[3] }; if (m[2]) nt.value = m[2];
      node.spec.taints = taints.filter(function (x) { return !(x.key === m[1] && x.effect === m[3]); }).concat([nt]); changed = true;
      if (m[3] === "NoExecute") c.K.list("Pod").forEach(function (p) { if (p.spec.nodeName === node.metadata.name && !(p.spec.tolerations || []).some(function (x) { return x.operator === "Exists" && (!x.key || x.key === m[1]); }) && !(p.metadata.namespace === "kube-system" && p.spec.hostNetwork)) c.K.remove(p); });
    });
    io.out("node/" + node.metadata.name + (changed ? " tainted" : removed ? " untainted" : " modified") + "\n");
  };
  cmds.config = function (a, io, sim) {
    var f = U.flags(a, spec({ str: "o output", bool: "current minify raw flatten" })), K = sim.k8s, sub = f._[0];
    if (sub === "current-context") io.out("sandbox\n");
    else if (sub === "get-contexts") io.out(U.table([["CURRENT", "NAME", "CLUSTER", "AUTHINFO", "NAMESPACE"], ["*", "sandbox", "sandbox", "kubernetes-admin", K.currentNs === "default" ? "" : K.currentNs]]) + "\n");
    else if (sub === "use-context") { if (f._[1] !== "sandbox") throw kerr("error: no context exists with the name: \"" + f._[1] + "\""); io.out("Switched to context \"sandbox\".\n"); }
    else if (sub === "set-context") {
      if (!f.current && f._[1] !== "sandbox") throw kerr("error: the sandbox has a single context named \"sandbox\"; use: kubectl config set-context --current --namespace=NAME");
      if (f.namespace) K.currentNs = f.namespace;
      io.out("Context \"sandbox\" modified.\n");
    } else if (sub === "view") io.out("apiVersion: v1\nclusters:\n- cluster:\n    certificate-authority-data: DATA+OMITTED\n    server: https://192.168.49.2:6443\n  name: sandbox\ncontexts:\n- context:\n    cluster: sandbox\n" + (K.currentNs !== "default" ? "    namespace: " + K.currentNs + "\n" : "") + "    user: kubernetes-admin\n  name: sandbox\ncurrent-context: sandbox\nkind: Config\npreferences: {}\nusers:\n- name: kubernetes-admin\n  user:\n    client-certificate-data: DATA+OMITTED\n    client-key-data: DATA+OMITTED\n");
    else throw kerr("error: unknown command \"" + (sub || "") + "\" for \"kubectl config\" (simulated: current-context, get-contexts, use-context, set-context --current --namespace=NS, view)");
  };
  cmds.auth = function (a, io, sim) {
    var f = U.flags(a, spec({ str: "subresource", bool: "list q quiet" })), c = ctx(sim, f), K = c.K;
    if (f._[0] === "whoami") { io.out(U.table([["ATTRIBUTE", "VALUE"], ["Username", c.user], ["Groups", c.user === "kubernetes-admin" ? "[kubeadm:cluster-admins system:authenticated]" : "[system:authenticated]"]]) + "\n"); return 0; }
    if (f._[0] !== "can-i") throw kerr("error: unknown command \"" + (f._[0] || "") + "\" for \"kubectl auth\" (simulated: can-i, whoami)");
    if (f.list) {
      var rows = [["Resources", "Non-Resource URLs", "Resource Names", "Verbs"]];
      K8.KINDS.forEach(function (k) { var vs = ["get", "list", "watch", "create", "update", "patch", "delete"].filter(function (v) { return K.can(c.user, v, k, k.namespaced ? c.ns : null, null); }); if (vs.length) rows.push([k.plural + (k.group ? "." + k.group : ""), "[]", "[]", "[" + vs.join(" ") + "]"]); });
      io.out(U.table(rows) + "\n"); return 0;
    }
    if (f._.length < 3) throw kerr("error: you must specify two arguments: verb resource or verb resource/resourceName.");
    var verb = f._[1], parts = f._[2].split("/"), k = parts[0] === "*" ? null : kc.kindOf(parts[0].split(".")[0]), name = f._[3] || parts[1] || null;
    var ok = k ? K.can(c.user, verb, k, k.namespaced ? (c.all ? null : c.ns) : null, name, f.subresource) : c.user === "kubernetes-admin";
    if (!f.q && !f.quiet) io.out((ok ? "yes" : "no") + "\n");
    return ok ? 0 : 1;
  };

  /* ---------- port-forward (runs in the background in the sandbox) ---------- */
  cmds["port-forward"] = function (a, io, sim) {
    var f = U.flags(a, spec({ str: "address pod-running-timeout" })), c = ctx(sim, f), K = c.K;
    if (f._.length < 2) throw kerr("error: TYPE/NAME and list of ports are required for port-forward\nSee 'kubectl port-forward -h' for help and examples");
    var target = f._[0], m = /^([^/]+)\/(.+)$/.exec(target), isSvc = m && kc.kindOf(m[1]).kind === "Service", svc = isSvc ? kc.getOne(c, BY_KIND.Service, m[2]) : null, pod;
    if (isSvc) {
      if (!svc.spec.selector) throw kerr("error: cannot attach to *v1.Service: invalid service '" + svc.metadata.name + "': Service is defined without a selector");
      var pods = K.list("Pod", c.ns, svc.spec.selector).filter(function (p) { return p.status.phase === "Running"; });
      if (!pods.length) throw kerr("error: timed out waiting for the condition");
      pod = pods.filter(K8.isReady)[0] || pods[0];
    } else pod = kc.podFor(c, target, "create", "portforward");
    if (pod.status.phase !== "Running") throw kerr("error: unable to forward port because pod is not running. Current status=" + pod.status.phase);
    var added = [];
    f._.slice(1).forEach(function (ps) {
      var p = ps.split(":"), local = +p[0], remote = p[1] != null ? p[1] : p[0];
      if (!local) throw kerr("error: error parsing local port '" + p[0] + "': strconv.ParseUint: parsing \"" + p[0] + "\": invalid syntax");
      if (isSvc) {
        var sp = (svc.spec.ports || []).filter(function (x) { return String(x.port) === String(remote) || x.name === remote; })[0];
        if (!sp) throw kerr("error: Service " + svc.metadata.name + " does not have a service port " + remote);
        remote = sp.targetPort;
        if (typeof remote === "string" && !/^\d+$/.test(remote)) { var named = null; pod.spec.containers.forEach(function (x) { (x.ports || []).forEach(function (cp) { if (cp.name === remote) named = cp.containerPort; }); }); if (named == null) throw kerr("error: Pod '" + pod.metadata.name + "' does not have a named port '" + remote + "'"); remote = named; }
      }
      remote = +remote;
      var busy = K.forwards.some(function (x) { return x.local === local; }) || sim.docker.containers.some(function (ct) { return ct.state === "running" && ct.ports.some(function (q) { return q.host === local; }); });
      if (busy) throw kerr("Unable to listen on port " + local + ": Listeners failed to create with the following errors: [unable to create listener: Error listen tcp4 127.0.0.1:" + local + ": bind: address already in use unable to create listener: Error listen tcp6 [::1]:" + local + ": bind: address already in use]\nerror: unable to listen on any of the requested ports: [{" + local + " " + remote + "}]");
      added.push({ local: local, remote: remote, kind: isSvc ? "Service" : "Pod", ns: c.ns, name: isSvc ? svc.metadata.name : pod.metadata.name, podUid: pod.metadata.uid, target: target, job: 0 });
    });
    added.forEach(function (x) { K.jobSeq = (K.jobSeq || 0) + 1; x.job = K.jobSeq; K.forwards.push(x); io.out("Forwarding from 127.0.0.1:" + x.local + " -> " + x.remote + "\nForwarding from [::1]:" + x.local + " -> " + x.remote + "\n"); });
    io.err("(sandbox) port-forward keeps running in the background as job [" + added.map(function (x) { return x.job; }).join(",") + "] so you can keep using this terminal. Stop it with: kill %" + added[0].job + "\n");
  };
  S.builtins.jobs = function (a, io, sim) { sim.k8s.forwards.forEach(function (x) { io.out("[" + x.job + "]   Running                 kubectl port-forward " + x.target + " " + x.local + ":" + x.remote + " &\n"); }); };
  S.builtins.kill = S.builtins.pkill = function (a, io, sim, sc, name) {
    var K = sim.k8s, arg = a.filter(function (x) { return x[0] !== "-"; })[0] || "", before = K.forwards.length;
    if (name === "pkill" || /port-forward|kubectl/.test(arg)) K.forwards = [];
    else if (/^%\d+$/.test(arg)) K.forwards = K.forwards.filter(function (x) { return x.job !== +arg.slice(1); });
    else throw new CmdError(name + ": usage: kill %JOB (see `jobs`)");
    if (K.forwards.length === before) throw new CmdError("bash: kill: " + arg + ": no such job");
    io.out("[" + (arg.replace("%", "") || "1") + "]+  Terminated              kubectl port-forward\n");
  };
  S.builtins.fg = function () { throw new CmdError("bash: fg: background jobs in the sandbox can't be brought to the foreground; stop them with kill %N"); };
})(typeof window !== "undefined" ? window : globalThis);
