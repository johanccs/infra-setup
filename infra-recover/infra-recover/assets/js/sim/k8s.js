/* infra-sim — a simulated Kubernetes cluster: API store, validation, controllers, scheduler, kubelet, networking.
   Models the behaviour of recent Kubernetes (v1.34–v1.37) closely enough to practise troubleshooting. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, NetError = S.NetError;

  S.k8s = {};

  /* ---------- resource kinds ---------- */
  var KINDS = [
    ["Pod", "pods", "po", true, "v1"], ["Service", "services", "svc", true, "v1"], ["ConfigMap", "configmaps", "cm", true, "v1"], ["Secret", "secrets", "", true, "v1"],
    ["Namespace", "namespaces", "ns", false, "v1"], ["Node", "nodes", "no", false, "v1"], ["Event", "events", "ev", true, "v1"], ["Endpoints", "endpoints", "ep", true, "v1"],
    ["PersistentVolumeClaim", "persistentvolumeclaims", "pvc", true, "v1"], ["PersistentVolume", "persistentvolumes", "pv", false, "v1"], ["ServiceAccount", "serviceaccounts", "sa", true, "v1"],
    ["ResourceQuota", "resourcequotas", "quota", true, "v1"], ["LimitRange", "limitranges", "limits", true, "v1"],
    ["Deployment", "deployments", "deploy", true, "apps/v1"], ["ReplicaSet", "replicasets", "rs", true, "apps/v1"], ["StatefulSet", "statefulsets", "sts", true, "apps/v1"], ["DaemonSet", "daemonsets", "ds", true, "apps/v1"],
    ["Job", "jobs", "", true, "batch/v1"], ["CronJob", "cronjobs", "cj", true, "batch/v1"],
    ["Ingress", "ingresses", "ing", true, "networking.k8s.io/v1"], ["IngressClass", "ingressclasses", "", false, "networking.k8s.io/v1"], ["NetworkPolicy", "networkpolicies", "netpol", true, "networking.k8s.io/v1"],
    ["StorageClass", "storageclasses", "sc", false, "storage.k8s.io/v1"],
    ["Role", "roles", "", true, "rbac.authorization.k8s.io/v1"], ["RoleBinding", "rolebindings", "", true, "rbac.authorization.k8s.io/v1"], ["ClusterRole", "clusterroles", "", false, "rbac.authorization.k8s.io/v1"], ["ClusterRoleBinding", "clusterrolebindings", "", false, "rbac.authorization.k8s.io/v1"],
    ["HorizontalPodAutoscaler", "horizontalpodautoscalers", "hpa", true, "autoscaling/v2"], ["PodDisruptionBudget", "poddisruptionbudgets", "pdb", true, "policy/v1"],
    ["Application", "applications", "app", true, "argoproj.io/v1alpha1"], ["AppProject", "appprojects", "appproj", true, "argoproj.io/v1alpha1"]
  ].map(function (k) { var api = k[4], group = api.indexOf("/") < 0 ? "" : api.split("/")[0]; return { kind: k[0], plural: k[1], short: k[2], namespaced: k[3], api: api, group: group, singular: k[0].toLowerCase(), full: k[1] + (group ? "." + group : "") }; });
  var BY_KIND = {}, BY_NAME = {};
  KINDS.forEach(function (k) {
    BY_KIND[k.kind] = k;
    [k.plural, k.singular, k.short, k.full, k.singular + "." + k.group, k.plural + "." + k.group.split(".")[0], k.singular + "." + k.group.split(".")[0]].forEach(function (n) { if (n && !BY_NAME[n]) BY_NAME[n] = k; });
  });
  BY_NAME.all = null;

  function apiError(status, msg) { var e = new CmdError(msg, 1); e.status = status; return e; }
  function qual(k) { return k.plural + (k.group ? "." + k.group : ""); }

  /* ---------- quantities, selectors ---------- */
  function cpu(q) { if (q == null || q === "") return 0; q = String(q); return /m$/.test(q) ? parseFloat(q) : parseFloat(q) * 1000; }
  function mem(q) {
    if (q == null || q === "") return 0;
    var m = /^([\d.]+)\s*(Ki|Mi|Gi|Ti|k|K|M|G|T|m)?$/.exec(String(q));
    if (!m) return NaN;
    return parseFloat(m[1]) * ({ Ki: 1024, Mi: 1048576, Gi: 1073741824, Ti: 1099511627776, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, m: 0.001 }[m[2]] || 1);
  }
  function fmtCpu(m) { return m % 1000 === 0 ? String(m / 1000) : m + "m"; }
  function fmtMem(b) { return b % 1073741824 === 0 && b ? b / 1073741824 + "Gi" : b % 1048576 === 0 ? b / 1048576 + "Mi" : b % 1024 === 0 ? b / 1024 + "Ki" : String(b); }
  function matchLabels(sel, labels) {
    labels = labels || {};
    if (!sel) return false;
    var ml = sel.matchLabels || (sel.matchExpressions ? {} : sel), k;
    for (k in ml) if (labels[k] !== String(ml[k])) return false;
    return (sel.matchExpressions || []).every(function (e) {
      var has = Object.prototype.hasOwnProperty.call(labels, e.key), v = labels[e.key];
      if (e.operator === "In") return has && e.values.indexOf(v) >= 0;
      if (e.operator === "NotIn") return !has || e.values.indexOf(v) < 0;
      if (e.operator === "Exists") return has;
      if (e.operator === "DoesNotExist") return !has;
      return false;
    });
  }
  function parseSelector(s) {   // "app=web,env!=dev,tier in (a,b),key,!key"
    var exprs = [], parts = s.match(/(?:[^,(]|\([^)]*\))+/g) || [];
    parts.forEach(function (p) {
      p = p.trim(); var m;
      if ((m = /^([\w./-]+)\s+(in|notin)\s+\(([^)]*)\)$/.exec(p))) exprs.push({ key: m[1], operator: m[2] === "in" ? "In" : "NotIn", values: m[3].split(",").map(function (x) { return x.trim(); }) });
      else if ((m = /^([\w./-]+)\s*(==|=|!=)\s*([\w.-]*)$/.exec(p))) exprs.push({ key: m[1], operator: m[2] === "!=" ? "NotIn" : "In", values: [m[3]] });
      else if ((m = /^!([\w./-]+)$/.exec(p))) exprs.push({ key: m[1], operator: "DoesNotExist" });
      else if ((m = /^([\w./-]+)$/.exec(p))) exprs.push({ key: m[1], operator: "Exists" });
      else throw new CmdError("error: unable to parse requirement: " + (/=$/.test(p) ? "" : "found '" + p.slice(-1) + "', expected: in, notin, =, ==, !=, gt, lt"));
    });
    return { matchExpressions: exprs };
  }
  function selText(sel) {
    if (!sel) return "<none>";
    var out = Object.keys(sel.matchLabels || (sel.matchExpressions ? {} : sel)).map(function (k) { return k + "=" + (sel.matchLabels || sel)[k]; });
    (sel.matchExpressions || []).forEach(function (e) { out.push(e.operator === "Exists" ? e.key : e.operator === "DoesNotExist" ? "!" + e.key : e.key + (e.operator === "In" ? " in (" : " notin (") + e.values.join(",") + ")"); });
    return out.join(",") || "<none>";
  }
  function eq(a, b) { return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b)); }
  function sortKeys(o) { if (Array.isArray(o)) return o.map(sortKeys); if (o && typeof o === "object") { var r = {}; Object.keys(o).sort().forEach(function (k) { if (o[k] !== undefined) r[k] = sortKeys(o[k]); }); return r; } return o; }

  /* ---------- schemas for strict field validation (kubectl reports unknown fields) ---------- */
  var ANY = "*";
  var probe = { httpGet: { path: 1, port: 1, scheme: 1, host: 1, httpHeaders: ANY }, tcpSocket: { port: 1, host: 1 }, exec: { command: ANY }, grpc: ANY, initialDelaySeconds: 1, periodSeconds: 1, timeoutSeconds: 1, successThreshold: 1, failureThreshold: 1, terminationGracePeriodSeconds: 1 };
  var container = { name: 1, image: 1, command: ANY, args: ANY, workingDir: 1, ports: [{ name: 1, containerPort: 1, protocol: 1, hostPort: 1, hostIP: 1 }],
    env: [{ name: 1, value: 1, valueFrom: { configMapKeyRef: { name: 1, key: 1, optional: 1 }, secretKeyRef: { name: 1, key: 1, optional: 1 }, fieldRef: ANY, resourceFieldRef: ANY } }],
    envFrom: [{ configMapRef: { name: 1, optional: 1 }, secretRef: { name: 1, optional: 1 }, prefix: 1 }], resources: { limits: ANY, requests: ANY, claims: ANY },
    volumeMounts: [{ name: 1, mountPath: 1, readOnly: 1, subPath: 1, mountPropagation: 1, subPathExpr: 1 }], livenessProbe: probe, readinessProbe: probe, startupProbe: probe, lifecycle: ANY, imagePullPolicy: 1, securityContext: ANY,
    stdin: 1, tty: 1, terminationMessagePath: 1, terminationMessagePolicy: 1, restartPolicy: 1, stdinOnce: 1, volumeDevices: ANY, resizePolicy: ANY };
  var podSpec = { containers: [container], initContainers: [container], volumes: [{ name: 1, configMap: { name: 1, items: ANY, defaultMode: 1, optional: 1 }, secret: { secretName: 1, items: ANY, defaultMode: 1, optional: 1 }, emptyDir: ANY, persistentVolumeClaim: { claimName: 1, readOnly: 1 }, hostPath: ANY, projected: ANY, downwardAPI: ANY, nfs: ANY, csi: ANY, ephemeral: ANY }],
    restartPolicy: 1, nodeSelector: ANY, nodeName: 1, tolerations: ANY, affinity: ANY, serviceAccountName: 1, serviceAccount: 1, imagePullSecrets: [{ name: 1 }], terminationGracePeriodSeconds: 1, securityContext: ANY, hostname: 1, subdomain: 1,
    dnsPolicy: 1, dnsConfig: ANY, hostNetwork: 1, hostPID: 1, priorityClassName: 1, priority: 1, schedulerName: 1, topologySpreadConstraints: ANY, enableServiceLinks: 1, automountServiceAccountToken: 1, activeDeadlineSeconds: 1, hostAliases: ANY, shareProcessNamespace: 1, runtimeClassName: 1, preemptionPolicy: 1, readinessGates: ANY, setHostnameAsFQDN: 1, os: ANY, ephemeralContainers: ANY, overhead: ANY };
  var meta = { name: 1, namespace: 1, labels: ANY, annotations: ANY, generateName: 1, uid: 1, resourceVersion: 1, creationTimestamp: 1, generation: 1, ownerReferences: ANY, finalizers: ANY, managedFields: ANY, deletionTimestamp: 1, deletionGracePeriodSeconds: 1, selfLink: 1 };
  var tmplMeta = { labels: ANY, annotations: ANY, name: 1, namespace: 1, creationTimestamp: 1 };
  var template = { metadata: tmplMeta, spec: podSpec };
  var labelSel = { matchLabels: ANY, matchExpressions: ANY };
  var SCHEMA = {
    Pod: { spec: podSpec },
    Deployment: { spec: { replicas: 1, selector: labelSel, template: template, strategy: { type: 1, rollingUpdate: { maxSurge: 1, maxUnavailable: 1 } }, minReadySeconds: 1, revisionHistoryLimit: 1, progressDeadlineSeconds: 1, paused: 1 } },
    ReplicaSet: { spec: { replicas: 1, selector: labelSel, template: template, minReadySeconds: 1 } },
    StatefulSet: { spec: { replicas: 1, selector: labelSel, template: template, serviceName: 1, volumeClaimTemplates: ANY, updateStrategy: ANY, podManagementPolicy: 1, revisionHistoryLimit: 1, minReadySeconds: 1, persistentVolumeClaimRetentionPolicy: ANY, ordinals: ANY } },
    DaemonSet: { spec: { selector: labelSel, template: template, updateStrategy: ANY, minReadySeconds: 1, revisionHistoryLimit: 1 } },
    Job: { spec: { template: template, completions: 1, parallelism: 1, backoffLimit: 1, activeDeadlineSeconds: 1, ttlSecondsAfterFinished: 1, selector: ANY, manualSelector: 1, completionMode: 1, suspend: 1, podFailurePolicy: ANY, backoffLimitPerIndex: 1, maxFailedIndexes: 1, podReplacementPolicy: 1, successPolicy: ANY, managedBy: 1 } },
    CronJob: { spec: { schedule: 1, timeZone: 1, jobTemplate: { metadata: tmplMeta, spec: ANY }, concurrencyPolicy: 1, suspend: 1, successfulJobsHistoryLimit: 1, failedJobsHistoryLimit: 1, startingDeadlineSeconds: 1 } },
    Service: { spec: { type: 1, selector: ANY, ports: [{ name: 1, port: 1, targetPort: 1, nodePort: 1, protocol: 1, appProtocol: 1 }], clusterIP: 1, clusterIPs: ANY, externalName: 1, sessionAffinity: 1, externalTrafficPolicy: 1, internalTrafficPolicy: 1, ipFamilies: ANY, ipFamilyPolicy: 1, loadBalancerIP: 1, externalIPs: ANY, publishNotReadyAddresses: 1, sessionAffinityConfig: ANY, loadBalancerClass: 1, loadBalancerSourceRanges: ANY, allocateLoadBalancerNodePorts: 1, healthCheckNodePort: 1, trafficDistribution: 1 } },
    ConfigMap: { data: ANY, binaryData: ANY, immutable: 1 },
    Secret: { data: ANY, stringData: ANY, type: 1, immutable: 1 },
    Namespace: { spec: ANY },
    PersistentVolumeClaim: { spec: { accessModes: ANY, resources: { requests: ANY, limits: ANY }, storageClassName: 1, volumeName: 1, volumeMode: 1, selector: ANY, dataSource: ANY, dataSourceRef: ANY, volumeAttributesClassName: 1 } },
    Ingress: { spec: { ingressClassName: 1, defaultBackend: ANY, tls: ANY, rules: [{ host: 1, http: { paths: [{ path: 1, pathType: 1, backend: { service: { name: 1, port: { number: 1, name: 1 } }, resource: ANY } }] } }] } }
  };
  S.k8s.schemaFor = function (kind) { return Object.assign({ apiVersion: 1, kind: 1, metadata: meta, status: ANY }, SCHEMA[kind] || { spec: ANY }); };
  function checkFields(obj, schema, path) {
    if (schema === ANY || schema === 1 || obj == null || typeof obj !== "object") return null;
    if (Array.isArray(schema)) {
      if (!Array.isArray(obj)) return null;
      for (var i = 0; i < obj.length; i++) { var r = checkFields(obj[i], schema[0], path + "[" + i + "]"); if (r) return r; }
      return null;
    }
    if (Array.isArray(obj)) return null;
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k], p = path ? path + "." + key : key;
      if (key[0] === "_") continue;
      if (!Object.prototype.hasOwnProperty.call(schema, key)) return p;
      var r2 = checkFields(obj[key], schema[key], p);
      if (r2) return r2;
    }
    return null;
  }
  var DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
  var LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

  /* ---------- the cluster ---------- */
  function Cluster(sim) {
    this.sim = sim; this.objs = new Map(); this.rv = 1000; this.rt = new Map(); this.forwards = []; this.pvData = {}; this.rr = 0;
    this.ipSeq = { svc: 20 }; this.nodeImages = {}; this.currentNs = "default"; this.user = "kubernetes-admin"; this.nodePorts = {};
  }
  S.Cluster = Cluster; Object.assign(S.k8s, { KINDS: KINDS, BY_KIND: BY_KIND, BY_NAME: BY_NAME, cpu: cpu, mem: mem, fmtCpu: fmtCpu, fmtMem: fmtMem, matchLabels: matchLabels, parseSelector: parseSelector, selText: selText, eq: eq, apiError: apiError, qual: qual });
  var C = Cluster.prototype;
  C.key = function (kind, ns, name) { return kind + "/" + (BY_KIND[kind] && BY_KIND[kind].namespaced ? ns : "") + "/" + name; };
  C.get = function (kind, ns, name) { return this.objs.get(this.key(kind, ns, name)) || null; };
  C.list = function (kind, ns, sel) {
    var out = [];
    this.objs.forEach(function (o) { if (o.kind === kind && (ns == null || !BY_KIND[kind].namespaced || o.metadata.namespace === ns) && (!sel || matchLabels(sel, o.metadata.labels))) out.push(o); });
    return out;
  };
  C.put = function (o) { o.metadata.resourceVersion = String(++this.rv); this.objs.set(this.key(o.kind, o.metadata.namespace, o.metadata.name), o); return o; };
  C.uid = function () { var s = this.sim; return s.id(8) + "-" + s.id(4) + "-" + s.id(4) + "-" + s.id(4) + "-" + s.id(12); };
  C.owned = function (owner, kind) { var ns = owner.metadata.namespace; return this.list(kind, ns).filter(function (o) { return (o.metadata.ownerReferences || []).some(function (r) { return r.uid === owner.metadata.uid; }); }); };
  C.ownerRef = function (o) { return { apiVersion: o.apiVersion, kind: o.kind, name: o.metadata.name, uid: o.metadata.uid, controller: true, blockOwnerDeletion: true }; };

  var EVENT_GAP = { FailedScheduling: 300000, ProvisioningFailed: 15000, WaitForFirstConsumer: 15000, FailedBinding: 15000, ExternalProvisioning: 15000 };
  C.event = function (obj, type, reason, message, source) {
    var ns = obj.metadata.namespace || "default", sim = this.sim, found = null;
    this.objs.forEach(function (e) { if (!found && e.kind === "Event" && e.metadata.namespace === ns && e.involvedObject.uid === obj.metadata.uid && e.reason === reason && e.message === message) found = e; });
    if (found) { if (EVENT_GAP[reason] && sim.now - found._last < EVENT_GAP[reason]) return found; found.count++; found.lastTimestamp = sim.iso(); found._last = sim.now; return found; }
    var ev = { apiVersion: "v1", kind: "Event", metadata: { name: obj.metadata.name + "." + sim.id(16), namespace: ns, uid: this.uid(), creationTimestamp: sim.iso() },
      involvedObject: { kind: obj.kind, namespace: obj.metadata.namespace, name: obj.metadata.name, uid: obj.metadata.uid, apiVersion: obj.apiVersion }, reason: reason, message: message, type: type, count: 1,
      firstTimestamp: sim.iso(), lastTimestamp: sim.iso(), source: { component: source || "kubelet" }, _first: sim.now, _last: sim.now };
    return this.put(ev);
  };
  C.eventsFor = function (obj) {
    var out = [];
    this.objs.forEach(function (e) { if (e.kind === "Event" && e.involvedObject.uid === obj.metadata.uid) out.push(e); });
    return out.sort(function (a, b) { return a._first - b._first; });
  };

  /* ----- validation and defaulting ----- */
  C.kindFor = function (o, file) {
    var where = file ? " from \"" + file + "\"" : "";
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new CmdError("error: error validating data: invalid object to validate");
    if (!o.kind) throw new CmdError("error: error validating " + (file ? "\"" + file + "\"" : "data") + ": error validating data: kind not set");
    if (!o.apiVersion) throw new CmdError("error: error validating " + (file ? "\"" + file + "\"" : "data") + ": error validating data: apiVersion not set");
    var k = BY_KIND[o.kind];
    if (!k || k.api !== o.apiVersion) throw new CmdError("error: resource mapping not found for name: \"" + ((o.metadata && o.metadata.name) || "") + "\" namespace: \"" + ((o.metadata && o.metadata.namespace) || "") + "\"" + where + ": no matches for kind \"" + o.kind + "\" in version \"" + o.apiVersion + "\"\nensure CRDs are installed first");
    return k;
  };
  function invalid(k, name, errs) {
    return apiError("Invalid", "The " + k.kind + " \"" + name + "\" is invalid: " + (errs.length === 1 ? errs[0] : "\n" + errs.map(function (e) { return "* " + e; }).join("\n")));
  }
  function goMap(m) { return "map[string]string{" + Object.keys(m || {}).sort().map(function (k) { return JSON.stringify(k) + ":" + JSON.stringify(String(m[k])); }).join(", ") + "}"; }
  function typeErr(k, o, what, field, goType) {
    return apiError("BadRequest", k.kind + " in version \"" + o.apiVersion.split("/").pop() + "\" cannot be handled as a " + k.kind + ": json: cannot unmarshal " + what + " into Go struct field " + field + " of type " + goType);
  }
  function validatePodSpec(k, o, spec, path, errs, tplLabels) {
    var short = path.replace(/^spec\.template\.spec/, "PodSpec.spec.template.spec").replace(/^spec$/, "PodSpec.spec");
    if (!spec || !Array.isArray(spec.containers) || !spec.containers.length) { errs.push(path + ".containers: Required value"); return; }
    var names = {};
    ["initContainers", "containers"].forEach(function (list) {
      (spec[list] || []).forEach(function (c, i) {
        var p = path + "." + list + "[" + i + "]";
        if (!c || typeof c !== "object") { errs.push(p + ": Required value"); return; }
        if (!c.name) errs.push(p + ".name: Required value");
        else if (!LABEL.test(c.name)) errs.push(p + ".name: Invalid value: \"" + c.name + "\": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')");
        else if (names[c.name]) errs.push(p + ".name: Duplicate value: \"" + c.name + "\"");
        names[c.name] = 1;
        if (!c.image) errs.push(p + ".image: Required value");
        (c.env || []).forEach(function (e, n) {
          if (e && e.value != null && typeof e.value !== "string") throw typeErr(k, o, typeof e.value === "number" ? "number" : "bool", "EnvVar." + path + "." + list + ".env.value", "string");
          if (e && !e.name) errs.push(p + ".env[" + n + "].name: Required value");
        });
        (c.ports || []).forEach(function (pt, n) {
          if (pt && typeof pt.containerPort === "string") throw typeErr(k, o, "string", "ContainerPort." + path + "." + list + ".ports.containerPort", "int32");
          if (!pt || pt.containerPort == null) errs.push(p + ".ports[" + n + "].containerPort: Required value");
          else if (pt.containerPort < 1 || pt.containerPort > 65535) errs.push(p + ".ports[" + n + "].containerPort: Invalid value: " + pt.containerPort + ": must be between 1 and 65535, inclusive");
        });
        (c.volumeMounts || []).forEach(function (vm, n) {
          if (!(spec.volumes || []).some(function (v) { return v.name === vm.name; }) && !(o.spec.volumeClaimTemplates || []).some(function (v) { return v.metadata && v.metadata.name === vm.name; })) errs.push(p + ".volumeMounts[" + n + "].name: Not found: \"" + vm.name + "\"");
          if (!vm.mountPath) errs.push(p + ".volumeMounts[" + n + "].mountPath: Required value");
        });
        var rq = (c.resources || {}).requests || {}, lm = (c.resources || {}).limits || {};
        ["cpu", "memory"].forEach(function (r) {
          [rq, lm].forEach(function (m2, w) { if (m2[r] != null && isNaN(r === "cpu" ? cpu(m2[r]) : mem(m2[r]))) errs.push(p + ".resources." + (w ? "limits" : "requests") + ": Invalid value: \"" + m2[r] + "\": quantities must match the regular expression '^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$'"); });
          var a = r === "cpu" ? cpu(rq[r]) : mem(rq[r]), b = r === "cpu" ? cpu(lm[r]) : mem(lm[r]);
          if (rq[r] != null && lm[r] != null && a > b) errs.push(p + ".resources.requests: Invalid value: \"" + rq[r] + "\": must be less than or equal to " + r + " limit of " + lm[r]);
        });
      });
    });
    if (spec.restartPolicy && ["Always", "OnFailure", "Never"].indexOf(spec.restartPolicy) < 0) errs.push(path + ".restartPolicy: Unsupported value: \"" + spec.restartPolicy + "\": supported values: \"Always\", \"OnFailure\", \"Never\"");
    return short;
  }
  C.validate = function (o, k, old) {
    var md = o.metadata || {}, name = md.name, errs = [], spec = o.spec || {};
    var sch = SCHEMA[o.kind];
    if (sch) {
      var bad = checkFields({ metadata: md }, { metadata: meta }, "") || checkFields(o, Object.assign({ apiVersion: 1, kind: 1, metadata: ANY, status: ANY }, sch), "");
      if (bad) throw apiError("BadRequest", o.kind + " in version \"" + o.apiVersion.split("/").pop() + "\" cannot be handled as a " + o.kind + ": strict decoding error: unknown field \"" + bad + "\"");
    }
    if (!name) throw apiError("Invalid", "error: error validating data: metadata.name: Required value: name or generateName is required");
    if (!DNS1123.test(name) || name.length > 253) errs.push("metadata.name: Invalid value: \"" + name + "\": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')");
    Object.keys(md.labels || {}).forEach(function (l) { if (typeof md.labels[l] !== "string") throw typeErr(k, o, typeof md.labels[l] === "number" ? "number" : "bool", "ObjectMeta.metadata.labels", "string"); });
    var workload = ["Deployment", "ReplicaSet", "StatefulSet", "DaemonSet"].indexOf(o.kind) >= 0;
    if (workload) {
      if (typeof spec.replicas === "string") throw typeErr(k, o, "string", o.kind + "Spec.spec.replicas", "int32");
      if (spec.replicas != null && spec.replicas < 0) errs.push("spec.replicas: Invalid value: " + spec.replicas + ": must be greater than or equal to 0");
      var tl = (spec.template && spec.template.metadata && spec.template.metadata.labels) || {};
      if (!spec.selector) errs.push("spec.selector: Required value");
      else if (!Object.keys(spec.selector.matchLabels || {}).length && !(spec.selector.matchExpressions || []).length) errs.push("spec.selector: Invalid value: {\"matchLabels\":{}}: empty selector is invalid for " + o.kind.toLowerCase());
      if (!spec.template) errs.push("spec.template: Required value");
      else {
        if (spec.selector && !matchLabels(spec.selector, tl)) errs.push("spec.template.metadata.labels: Invalid value: " + goMap(tl) + ": `selector` does not match template `labels`");
        validatePodSpec(k, o, spec.template.spec, "spec.template.spec", errs);
        if (spec.template.spec && spec.template.spec.restartPolicy && spec.template.spec.restartPolicy !== "Always") errs.push("spec.template.spec.restartPolicy: Unsupported value: \"" + spec.template.spec.restartPolicy + "\": supported values: \"Always\"");
      }
      if (old && !eq(old.spec.selector, spec.selector)) errs.push("spec.selector: Invalid value: " + JSON.stringify(spec.selector) + ": field is immutable");
      if (o.kind === "StatefulSet" && spec.serviceName == null) errs.push("spec.serviceName: Required value");
      if (o.kind === "StatefulSet" && old && (!eq(old.spec.volumeClaimTemplates || [], spec.volumeClaimTemplates || []) || old.spec.serviceName !== spec.serviceName)) errs.push("spec: Forbidden: updates to statefulset spec for fields other than 'replicas', 'ordinals', 'template', 'updateStrategy', 'revisionHistoryLimit', 'persistentVolumeClaimRetentionPolicy' and 'minReadySeconds' are forbidden");
    } else if (o.kind === "Pod") {
      validatePodSpec(k, o, o.spec, "spec", errs);
      if (old) {
        var strip = function (p) { var c = U.clone(p.spec); (c.containers || []).concat(c.initContainers || []).forEach(function (x) { delete x.image; }); delete c.tolerations; delete c.activeDeadlineSeconds; delete c.terminationGracePeriodSeconds; return c; };
        if (!eq(strip(old), strip(o))) throw apiError("Invalid", "The Pod \"" + name + "\" is invalid: spec: Forbidden: pod updates may not change fields other than `spec.containers[*].image`,`spec.initContainers[*].image`,`spec.activeDeadlineSeconds`,`spec.tolerations` (only additions to existing tolerations),`spec.terminationGracePeriodSeconds` (allow it to be set to 1 if it was previously negative)");
      }
    } else if (o.kind === "Job") {
      if (!spec.template) errs.push("spec.template: Required value");
      else {
        validatePodSpec(k, o, spec.template.spec, "spec.template.spec", errs);
        var rp = spec.template.spec && spec.template.spec.restartPolicy;
        if (!rp || rp === "Always") errs.push("spec.template.spec.restartPolicy: " + (rp ? "Unsupported value: \"Always\": supported values: \"OnFailure\", \"Never\"" : "Required value: valid values: \"OnFailure\", \"Never\""));
      }
      if (old && !eq(old.spec.template, spec.template)) errs.push("spec.template: Invalid value: field is immutable");
    } else if (o.kind === "CronJob") {
      if (!spec.schedule) errs.push("spec.schedule: Required value");
      else if (String(spec.schedule).trim().split(/\s+/).length !== 5) errs.push("spec.schedule: Invalid value: \"" + spec.schedule + "\": expected exactly 5 fields, found " + String(spec.schedule).trim().split(/\s+/).length + ": [" + spec.schedule + "]");
      if (!spec.jobTemplate || !spec.jobTemplate.spec || !spec.jobTemplate.spec.template) errs.push("spec.jobTemplate.spec.template: Required value");
    } else if (o.kind === "Service") {
      var type = spec.type || "ClusterIP";
      if (["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"].indexOf(type) < 0) errs.push("spec.type: Unsupported value: \"" + type + "\": supported values: \"ClusterIP\", \"ExternalName\", \"LoadBalancer\", \"NodePort\"");
      if (type !== "ExternalName" && (!Array.isArray(spec.ports) || !spec.ports.length)) errs.push("spec.ports: Required value");
      (spec.ports || []).forEach(function (p, i) {
        if (typeof p.port === "string") throw typeErr(k, o, "string", "ServicePort.spec.ports.port", "int32");
        if (p.port == null) errs.push("spec.ports[" + i + "].port: Required value");
        else if (p.port < 1 || p.port > 65535) errs.push("spec.ports[" + i + "].port: Invalid value: " + p.port + ": must be between 1 and 65535, inclusive");
        if (spec.ports.length > 1 && !p.name) errs.push("spec.ports[" + i + "].name: Required value");
        if (p.nodePort != null && type === "ClusterIP") errs.push("spec.ports[" + i + "].nodePort: Forbidden: may not be used when `type` is 'ClusterIP'");
        if (p.nodePort != null && (p.nodePort < 30000 || p.nodePort > 32767)) errs.push("spec.ports[" + i + "].nodePort: Invalid value: " + p.nodePort + ": provided port is not in the valid range. The range of valid ports is 30000-32767");
      });
      if (old && spec.clusterIP && old.spec.clusterIP && spec.clusterIP !== old.spec.clusterIP) errs.push("spec.clusterIPs[0]: Invalid value: [\"" + spec.clusterIP + "\"]: may not change once set");
    } else if (o.kind === "ConfigMap" || o.kind === "Secret") {
      Object.keys(o.data || {}).forEach(function (key) {
        if (typeof o.data[key] !== "string") throw typeErr(k, o, typeof o.data[key] === "number" ? "number" : typeof o.data[key] === "boolean" ? "bool" : "object", o.kind + ".data", "string");
        if (o.kind === "Secret") { try { U.b64d(o.data[key]); } catch (e) { throw apiError("BadRequest", "Secret in version \"v1\" cannot be handled as a Secret: illegal base64 data at input byte " + Math.max(0, o.data[key].search(/[^A-Za-z0-9+/=]/))); } }
      });
    } else if (o.kind === "PersistentVolumeClaim") {
      if (!spec.accessModes || !spec.accessModes.length) errs.push("spec.accessModes: Required value: at least 1 access mode is required");
      if (!spec.resources || !spec.resources.requests || !spec.resources.requests.storage) errs.push("spec.resources[storage]: Required value");
      if (old && (!eq(old.spec.accessModes, spec.accessModes) || (old.spec.storageClassName || null) !== (spec.storageClassName === undefined ? old.spec.storageClassName || null : spec.storageClassName))) errs.push("spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims");
    } else if (o.kind === "Ingress") {
      (spec.rules || []).forEach(function (r, i) {
        ((r.http || {}).paths || []).forEach(function (p, n) {
          var pp = "spec.rules[" + i + "].http.paths[" + n + "]";
          if (!p.pathType) errs.push(pp + ".pathType: Required value: pathType must be specified");
          if (!p.backend || !p.backend.service || !p.backend.service.name) errs.push(pp + ".backend: Required value: must specify service or resource");
          else if (!p.backend.service.port || (p.backend.service.port.number == null && !p.backend.service.port.name)) errs.push(pp + ".backend.service.port: Required value: port name or number is required");
        });
      });
    } else if (o.kind === "RoleBinding" || o.kind === "ClusterRoleBinding") {
      if (!o.roleRef || !o.roleRef.name) errs.push("roleRef.name: Required value");
      if (old && !eq(old.roleRef, o.roleRef)) throw apiError("Invalid", "The " + o.kind + " \"" + name + "\" is invalid: roleRef: Invalid value: " + JSON.stringify(o.roleRef) + ": cannot change roleRef");
    }
    if (errs.length) throw invalid(k, name, errs);
  };
  function defaultPodSpec(spec) {
    ["initContainers", "containers"].forEach(function (list) {
      (spec[list] || []).forEach(function (c) {
        if (!c.imagePullPolicy) c.imagePullPolicy = /:latest$/.test(c.image) || !/:[^/]+$/.test(c.image) ? "Always" : "IfNotPresent";
        (c.ports || []).forEach(function (p) { if (!p.protocol) p.protocol = "TCP"; });
        ["livenessProbe", "readinessProbe", "startupProbe"].forEach(function (pk) {
          var p = c[pk]; if (!p) return;
          if (p.periodSeconds == null) p.periodSeconds = 10; if (p.timeoutSeconds == null) p.timeoutSeconds = 1; if (p.successThreshold == null) p.successThreshold = 1; if (p.failureThreshold == null) p.failureThreshold = 3;
          if (p.httpGet && !p.httpGet.scheme) p.httpGet.scheme = "HTTP"; if (p.httpGet && !p.httpGet.path) p.httpGet.path = "/";
        });
        if (!c.resources) c.resources = {};
        var r = c.resources; if (r.limits) { r.requests = r.requests || {}; Object.keys(r.limits).forEach(function (x) { if (r.requests[x] == null) r.requests[x] = r.limits[x]; }); }
      });
    });
    if (!spec.restartPolicy) spec.restartPolicy = "Always";
    if (!spec.dnsPolicy) spec.dnsPolicy = "ClusterFirst";
    if (spec.terminationGracePeriodSeconds == null) spec.terminationGracePeriodSeconds = 30;
    if (spec.serviceAccount && !spec.serviceAccountName) spec.serviceAccountName = spec.serviceAccount;
  }
  C.applyDefaults = function (o) {
    var s = o.spec, self = this;
    if (o.kind === "Pod") { defaultPodSpec(s); if (!s.serviceAccountName) s.serviceAccountName = "default"; }
    if (["Deployment", "ReplicaSet", "StatefulSet", "DaemonSet"].indexOf(o.kind) >= 0) {
      if (o.kind !== "DaemonSet" && s.replicas == null) s.replicas = 1;
      defaultPodSpec(s.template.spec);
      if (o.kind === "Deployment") {
        s.strategy = s.strategy || {}; if (!s.strategy.type) s.strategy.type = "RollingUpdate";
        if (s.strategy.type === "RollingUpdate") { s.strategy.rollingUpdate = s.strategy.rollingUpdate || {}; if (s.strategy.rollingUpdate.maxSurge == null) s.strategy.rollingUpdate.maxSurge = "25%"; if (s.strategy.rollingUpdate.maxUnavailable == null) s.strategy.rollingUpdate.maxUnavailable = "25%"; }
        if (s.revisionHistoryLimit == null) s.revisionHistoryLimit = 10; if (s.progressDeadlineSeconds == null) s.progressDeadlineSeconds = 600;
      }
    }
    if (o.kind === "Job") { if (s.completions == null && s.parallelism == null) { s.completions = 1; s.parallelism = 1; } if (s.parallelism == null) s.parallelism = 1; if (s.backoffLimit == null) s.backoffLimit = 6; defaultPodSpec(s.template.spec); }
    if (o.kind === "CronJob") { if (s.concurrencyPolicy == null) s.concurrencyPolicy = "Allow"; if (s.suspend == null) s.suspend = false; if (s.successfulJobsHistoryLimit == null) s.successfulJobsHistoryLimit = 3; if (s.failedJobsHistoryLimit == null) s.failedJobsHistoryLimit = 1; }
    if (o.kind === "Service") {
      if (!s.type) s.type = "ClusterIP";
      if (s.type !== "ExternalName" && !s.clusterIP) { s.clusterIP = "10.96." + Math.floor(self.ipSeq.svc / 250) + "." + (self.ipSeq.svc++ % 250 + 2); }
      if (s.clusterIP && s.clusterIP !== "None") s.clusterIPs = [s.clusterIP];
      (s.ports || []).forEach(function (p) {
        if (!p.protocol) p.protocol = "TCP"; if (p.targetPort == null) p.targetPort = p.port;
        if ((s.type === "NodePort" || s.type === "LoadBalancer") && !p.nodePort) { var np; do { np = 30000 + Math.floor(self.sim.rand() * 2768); } while (self.nodePorts[np]); p.nodePort = np; }
        if (p.nodePort) self.nodePorts[p.nodePort] = 1;
      });
      if (!s.sessionAffinity) s.sessionAffinity = "None";
    }
    if (o.kind === "Secret") {
      if (!o.type) o.type = "Opaque";
      if (o.stringData) { o.data = o.data || {}; Object.keys(o.stringData).forEach(function (k) { o.data[k] = U.b64e(String(o.stringData[k])); }); delete o.stringData; }
    }
    if (o.kind === "PersistentVolumeClaim") { if (!s.volumeMode) s.volumeMode = "Filesystem"; if (s.storageClassName === undefined) { var def = this.list("StorageClass").filter(function (c) { return (c.metadata.annotations || {})["storageclass.kubernetes.io/is-default-class"] === "true"; })[0]; if (def) s.storageClassName = def.metadata.name; } }
    if (o.kind === "PersistentVolume") { if (!s.persistentVolumeReclaimPolicy) s.persistentVolumeReclaimPolicy = "Retain"; if (!s.volumeMode) s.volumeMode = "Filesystem"; }
    if (o.kind === "Namespace") { o.metadata.labels = Object.assign({ "kubernetes.io/metadata.name": o.metadata.name }, o.metadata.labels); o.spec = o.spec || { finalizers: ["kubernetes"] }; }
    if (o.kind === "Ingress") { (s.rules || []).forEach(function (r) { ((r.http || {}).paths || []).forEach(function (p) { if (!p.path && p.pathType !== "ImplementationSpecific") p.path = "/"; }); }); }
  };

  /* ----- create / update / delete ----- */
  C.prepare = function (o, file) {
    var k = this.kindFor(o, file);
    o.metadata = o.metadata || {};
    if (k.namespaced) { if (!o.metadata.namespace) o.metadata.namespace = this.currentNs; } else delete o.metadata.namespace;
    return k;
  };
  C.create = function (o, opts) {
    opts = opts || {};
    var k = BY_KIND[o.kind], md = o.metadata, sim = this.sim;
    if (md.generateName && !md.name) md.name = md.generateName + sim.suffix(5);
    this.validate(o, k, null);
    if (k.namespaced) {
      var ns = this.get("Namespace", null, md.namespace);
      if (!ns) throw apiError("NotFound", "namespaces \"" + md.namespace + "\" not found");
      if (ns.metadata.deletionTimestamp) throw apiError("Forbidden", qual(k) + " \"" + md.name + "\" is forbidden: unable to create new content in namespace " + md.namespace + " because it is being terminated");
    }
    if (this.get(o.kind, md.namespace, md.name)) throw apiError("AlreadyExists", qual(k) + " \"" + md.name + "\" already exists");
    this.applyDefaults(o);
    if (o.kind === "Pod") this.admitPod(o);
    md.uid = this.uid(); md.creationTimestamp = sim.iso(); md._created = sim.now;
    if (["Deployment", "ReplicaSet", "StatefulSet", "DaemonSet", "Job", "CronJob", "Ingress", "PersistentVolumeClaim", "Service"].indexOf(o.kind) >= 0 || o.kind === "Pod") md.generation = 1;
    if (o.kind === "Pod") o.status = { phase: "Pending", qosClass: qos(o) };
    else if (o.kind === "Namespace") o.status = { phase: "Active" };
    else if (o.kind === "PersistentVolumeClaim") o.status = { phase: "Pending" };
    else if (o.kind === "PersistentVolume") o.status = { phase: "Available" };
    else if (o.kind === "Service") o.status = { loadBalancer: {} };
    else if (o.kind !== "ConfigMap" && o.kind !== "Secret" && k.group !== "rbac.authorization.k8s.io" && o.kind !== "ServiceAccount" && o.kind !== "StorageClass" && o.kind !== "IngressClass" && o.kind !== "NetworkPolicy" && !o.status) o.status = {};
    this.put(o);
    if (o.kind === "Namespace") { this.create({ apiVersion: "v1", kind: "ServiceAccount", metadata: { name: "default", namespace: md.name } }); this.create({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "kube-root-ca.crt", namespace: md.name }, data: { "ca.crt": "-----BEGIN CERTIFICATE-----\n(simulated)\n-----END CERTIFICATE-----\n" } }); }
    return o;
  };
  function qos(pod) {
    var cs = pod.spec.containers, all = cs.every(function (c) { var r = c.resources || {}; return r.limits && r.limits.cpu && r.limits.memory && eq(r.limits, r.requests); });
    var none = cs.every(function (c) { var r = c.resources || {}; return !Object.keys(r.limits || {}).length && !Object.keys(r.requests || {}).length; });
    return all ? "Guaranteed" : none ? "BestEffort" : "Burstable";
  }
  C.podRequests = function (pod) {
    var c = 0, m = 0, lc = 0, lm = 0;
    pod.spec.containers.forEach(function (x) { var r = x.resources || {}; c += cpu((r.requests || {}).cpu); m += mem((r.requests || {}).memory); lc += cpu((r.limits || {}).cpu); lm += mem((r.limits || {}).memory); });
    return { cpu: c, memory: m, limitsCpu: lc, limitsMemory: lm };
  };
  C.quotaUsage = function (ns) {
    var self = this, u = { pods: 0, "requests.cpu": 0, "requests.memory": 0, "limits.cpu": 0, "limits.memory": 0 };
    this.list("Pod", ns).forEach(function (p) { if (p.status.phase === "Succeeded" || p.status.phase === "Failed") return; var r = self.podRequests(p); u.pods++; u["requests.cpu"] += r.cpu; u["requests.memory"] += r.memory; u["limits.cpu"] += r.limitsCpu; u["limits.memory"] += r.limitsMemory; });
    ["Service", "ConfigMap", "Secret", "PersistentVolumeClaim"].forEach(function (kd) { u[BY_KIND[kd].plural] = self.list(kd, ns).length; });
    u.cpu = u["requests.cpu"]; u.memory = u["requests.memory"];
    return u;
  };
  function qfmt(key, v) { return /cpu/.test(key) ? fmtCpu(v) : /memory/.test(key) ? fmtMem(v) : String(v); }
  function qparse(key, v) { return /cpu/.test(key) ? cpu(v) : /memory/.test(key) ? mem(v) : parseInt(v, 10); }
  S.k8s.qfmt = qfmt; S.k8s.qparse = qparse;
  C.admitPod = function (pod) {
    var self = this, ns = pod.metadata.namespace, name = pod.metadata.name, req = this.podRequests(pod);
    var add = { pods: 1, "requests.cpu": req.cpu, "requests.memory": req.memory, "limits.cpu": req.limitsCpu, "limits.memory": req.limitsMemory, cpu: req.cpu, memory: req.memory };
    this.list("LimitRange", ns).forEach(function (lr) {
      ((lr.spec || {}).limits || []).forEach(function (l) {
        if (l.type !== "Container") return;
        pod.spec.containers.forEach(function (c) {
          c.resources = c.resources || {};
          if (l.defaultRequest) c.resources.requests = Object.assign({}, l.defaultRequest, c.resources.requests);
          if (l["default"]) { c.resources.limits = Object.assign({}, l["default"], c.resources.limits); c.resources.requests = Object.assign({}, c.resources.limits, c.resources.requests); }
        });
      });
    });
    req = this.podRequests(pod); add["requests.cpu"] = add.cpu = req.cpu; add["requests.memory"] = add.memory = req.memory; add["limits.cpu"] = req.limitsCpu; add["limits.memory"] = req.limitsMemory;
    this.list("ResourceQuota", ns).forEach(function (q) {
      var hard = (q.spec || {}).hard || {}, used = self.quotaUsage(ns), missing = [], over = [];
      Object.keys(hard).forEach(function (key) {
        if (add[key] == null) return;
        var per = { "requests.cpu": "cpu", cpu: "cpu", "requests.memory": "memory", memory: "memory", "limits.cpu": "cpu", "limits.memory": "memory" }[key];
        if (per && pod.spec.containers.some(function (c) { var r = c.resources || {}; return !((/limits/.test(key) ? r.limits : r.requests) || {})[per]; })) { missing.push(key); return; }
        if (used[key] + add[key] > qparse(key, hard[key])) over.push(key);
      });
      if (missing.length) throw apiError("Forbidden", "pods \"" + name + "\" is forbidden: failed quota: " + q.metadata.name + ": must specify " + missing.join(","));
      if (over.length) throw apiError("Forbidden", "pods \"" + name + "\" is forbidden: exceeded quota: " + q.metadata.name + ", requested: " + over.map(function (key) { return key + "=" + qfmt(key, add[key]); }).join(",") + ", used: " + over.map(function (key) { return key + "=" + qfmt(key, used[key]); }).join(",") + ", limited: " + over.map(function (key) { return key + "=" + hard[key]; }).join(","));
    });
    var sa = pod.spec.serviceAccountName || "default";
    if (!this.get("ServiceAccount", ns, sa)) throw apiError("Forbidden", "pods \"" + name + "\" is forbidden: error looking up service account " + ns + "/" + sa + ": serviceaccount \"" + sa + "\" not found");
  };
  C.update = function (o, old) {
    var k = BY_KIND[o.kind];
    this.validate(o, k, old);
    this.applyDefaults(o);
    o.metadata.uid = old.metadata.uid; o.metadata.creationTimestamp = old.metadata.creationTimestamp; o.metadata._created = old.metadata._created;
    o.metadata.generation = (old.metadata.generation || 1) + (eq(old.spec, o.spec) ? 0 : 1);
    if (old.metadata.ownerReferences && !o.metadata.ownerReferences) o.metadata.ownerReferences = old.metadata.ownerReferences;
    if (o.status === undefined) o.status = old.status;
    if (o.kind === "Pod") { var rt = this.rt.get(o.metadata.uid); if (rt) rt.main.concat(rt.init).forEach(function (cs) { var c = (o.spec.containers.concat(o.spec.initContainers || [])).filter(function (x) { return x.name === cs.name; })[0]; if (c && c.image !== cs.image) { cs.image = c.image; cs.restartNow = true; } }); }
    return this.put(o);
  };
  C.remove = function (o, opts) {
    var self = this, k = this.key(o.kind, o.metadata.namespace, o.metadata.name);
    if (!this.objs.has(k)) return;
    if (o.kind === "Namespace") {
      this.objs.forEach(function (x) { if (x.metadata.namespace === o.metadata.name && BY_KIND[x.kind] && BY_KIND[x.kind].namespaced) self.remove(x, { cascade: false }); });
    }
    if (o.kind === "PersistentVolumeClaim" && !(opts && opts.force)) {
      var users = this.list("Pod", o.metadata.namespace).filter(function (p) { return (p.spec.volumes || []).some(function (v) { return v.persistentVolumeClaim && v.persistentVolumeClaim.claimName === o.metadata.name; }); });
      if (users.length) { o.metadata.deletionTimestamp = this.sim.iso(); o.metadata.finalizers = ["kubernetes.io/pvc-protection"]; return; }
    }
    this.objs.delete(k);
    if (o.kind === "Application" && S.argo && S.argo.onDelete) S.argo.onDelete(this, o);
    if (o.kind === "Pod") { var rt = this.rt.get(o.metadata.uid); if (rt) { rt.all().forEach(function (cs) { if (cs.proc) S.proc.kill(self.sim, cs.proc, 137); }); this.rt.delete(o.metadata.uid); } this.sim.scopes = this.sim.scopes.filter(function (sc) { return !(sc.type === "proc" && sc.origin.type === "pod" && sc.origin.uid === o.metadata.uid); }); this.forwards = this.forwards.filter(function (f) { return f.podUid !== o.metadata.uid; }); }
    if (o.kind === "Service") (o.spec.ports || []).forEach(function (p) { delete self.nodePorts[p.nodePort]; });
    if (o.kind === "Service") { var ep = this.get("Endpoints", o.metadata.namespace, o.metadata.name); if (ep) this.objs.delete(this.key("Endpoints", o.metadata.namespace, o.metadata.name)); this.forwards = this.forwards.filter(function (f) { return !(f.kind === "Service" && f.name === o.metadata.name && f.ns === o.metadata.namespace); }); }
    if (o.kind === "PersistentVolumeClaim" && o.spec.volumeName) {
      var pv = this.get("PersistentVolume", null, o.spec.volumeName);
      if (pv) { if (pv.spec.persistentVolumeReclaimPolicy === "Delete") { this.objs.delete(this.key("PersistentVolume", null, pv.metadata.name)); delete this.pvData[pv.metadata.name]; } else { pv.status.phase = "Released"; } }
    }
    if (!opts || opts.cascade !== false) {
      this.objs.forEach(function (x) { if (x.metadata.namespace === o.metadata.namespace && (x.metadata.ownerReferences || []).some(function (r) { return r.uid === o.metadata.uid; })) self.remove(x); });
    } else {
      this.objs.forEach(function (x) { if (x.metadata.ownerReferences) x.metadata.ownerReferences = x.metadata.ownerReferences.filter(function (r) { return r.uid !== o.metadata.uid; }); });
    }
    this.objs.forEach(function (e) { if (e.kind === "Event" && e.involvedObject.uid === o.metadata.uid && o.kind !== "Pod") self.objs.delete(self.key("Event", e.metadata.namespace, e.metadata.name)); });
  };

  /* ----- RBAC ----- */
  C.can = function (user, verb, k, ns, name, sub) {
    if (user === "kubernetes-admin" || user === "system:admin") return true;
    var self = this, groups = ["system:authenticated"], sa = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(user);
    if (sa) groups.push("system:serviceaccounts", "system:serviceaccounts:" + sa[1]);
    function subjectMatch(s, bns) {
      if (s.kind === "User") return s.name === user;
      if (s.kind === "Group") return groups.indexOf(s.name) >= 0;
      if (s.kind === "ServiceAccount") return !!sa && s.name === sa[2] && (s.namespace || bns) === sa[1];
      return false;
    }
    var res = k.plural + (sub ? "/" + sub : "");
    function ruleMatch(r) {
      var gs = r.apiGroups || [], rs = r.resources || [], vs = r.verbs || [];
      return (gs.indexOf("*") >= 0 || gs.indexOf(k.group) >= 0) && (rs.indexOf("*") >= 0 || rs.indexOf(res) >= 0 || (sub && rs.indexOf("*/" + sub) >= 0)) && (vs.indexOf("*") >= 0 || vs.indexOf(verb) >= 0) && (!r.resourceNames || !r.resourceNames.length || r.resourceNames.indexOf(name) >= 0);
    }
    function roleAllows(ref, bns) {
      var role = ref.kind === "ClusterRole" ? self.get("ClusterRole", null, ref.name) : self.get("Role", bns, ref.name);
      return !!role && (role.rules || []).some(ruleMatch);
    }
    if (this.list("ClusterRoleBinding").some(function (b) { return (b.subjects || []).some(function (s) { return subjectMatch(s, null); }) && roleAllows(b.roleRef, null); })) return true;
    if (!k.namespaced || ns == null) return false;
    return this.list("RoleBinding", ns).some(function (b) { return (b.subjects || []).some(function (s) { return subjectMatch(s, ns); }) && roleAllows(b.roleRef, ns); });
  };

  /* ---------- controllers ---------- */
  function tplHash(sim, template) { var h = S.hex(JSON.stringify(sortKeys(template)), 20), a = "bcdfghjklmnpqrstvwxz2456789", s = ""; for (var i = 0; i < 10; i++) s += a[parseInt(h.slice(i * 2, i * 2 + 2), 16) % a.length]; return s.replace(/^\d/, "c"); }
  S.k8s.tplHash = tplHash;
  function isReady(p) { return !p.metadata.deletionTimestamp && ((p.status || {}).conditions || []).some(function (c) { return c.type === "Ready" && c.status === "True"; }); }
  S.k8s.isReady = isReady;
  function pct(v, total, up) { if (typeof v === "string" && /%$/.test(v)) { var x = parseFloat(v) * total / 100; return up ? Math.ceil(x) : Math.floor(x); } return parseInt(v, 10) || 0; }
  function setCond(o, type, status, reason, message, sim) {
    o.status.conditions = o.status.conditions || [];
    var c = o.status.conditions.filter(function (x) { return x.type === type; })[0];
    if (!c) { c = { type: type }; o.status.conditions.push(c); }
    if (c.status !== status) c.lastTransitionTime = sim.iso();
    c.status = status; c.reason = reason; c.message = message; c.lastUpdateTime = sim.iso();
  }

  C.podFromTemplate = function (owner, tpl, name, extraLabels) {
    return { apiVersion: "v1", kind: "Pod", metadata: { name: name, namespace: owner.metadata.namespace, labels: Object.assign({}, (tpl.metadata || {}).labels, extraLabels), annotations: (tpl.metadata || {}).annotations ? Object.assign({}, tpl.metadata.annotations) : undefined, ownerReferences: [this.ownerRef(owner)] }, spec: U.clone(tpl.spec) };
  };
  C.tryCreatePod = function (owner, pod) {
    try { this.create(pod); this.event(owner, "Normal", "SuccessfulCreate", (owner.kind === "StatefulSet" ? "create Pod " + pod.metadata.name + " in StatefulSet " + owner.metadata.name + " successful" : "Created pod: " + pod.metadata.name), owner.kind.toLowerCase() + "-controller"); return true; }
    catch (e) {
      if (!(e instanceof CmdError)) throw e;
      this.event(owner, "Warning", "FailedCreate", "Error creating: " + e.message.replace(/pods "[^"]*"/, "pods \"" + (owner.kind === "ReplicaSet" || owner.kind === "Job" || owner.kind === "DaemonSet" ? owner.metadata.name + "-" + this.sim.suffix(5) : pod.metadata.name) + "\""), owner.kind.toLowerCase() + "-controller");
      return false;
    }
  };

  C.reconcileDeployments = function () {
    var self = this, sim = this.sim;
    this.list("Deployment").forEach(function (d) {
      var ns = d.metadata.namespace, s = d.spec, hash = tplHash(sim, s.template), all = self.owned(d, "ReplicaSet");
      var maxRev = all.reduce(function (m, r) { return Math.max(m, +(r.metadata.annotations || {})["deployment.kubernetes.io/revision"] || 0); }, 0);
      var cur = all.filter(function (r) { return r.metadata.labels["pod-template-hash"] === hash; })[0];
      var cause = (d.metadata.annotations || {})["kubernetes.io/change-cause"];
      if (!cur) {
        var tpl = U.clone(s.template); tpl.metadata = tpl.metadata || {}; tpl.metadata.labels = Object.assign({}, tpl.metadata.labels, { "pod-template-hash": hash });
        cur = { apiVersion: "apps/v1", kind: "ReplicaSet", metadata: { name: d.metadata.name + "-" + hash, namespace: ns, labels: Object.assign({}, tpl.metadata.labels), annotations: { "deployment.kubernetes.io/revision": String(maxRev + 1), "deployment.kubernetes.io/desired-replicas": String(s.replicas) }, ownerReferences: [self.ownerRef(d)] },
          spec: { replicas: 0, selector: { matchLabels: Object.assign({}, s.selector.matchLabels, { "pod-template-hash": hash }) }, template: tpl } };
        if (s.selector.matchExpressions) cur.spec.selector.matchExpressions = s.selector.matchExpressions;
        if (cause) cur.metadata.annotations["kubernetes.io/change-cause"] = cause;
        try { self.create(cur); } catch (e) { if (!(e instanceof CmdError)) throw e; return; }
        cur.status = { replicas: 0 };
        all.push(cur); maxRev++;
        d.status._progressAt = sim.now;
      } else if (+(cur.metadata.annotations["deployment.kubernetes.io/revision"]) < maxRev) {
        cur.metadata.annotations["deployment.kubernetes.io/revision"] = String(++maxRev);   // rollback re-uses the old ReplicaSet with a new revision
        d.status._progressAt = sim.now;
      }
      if (cause) cur.metadata.annotations["kubernetes.io/change-cause"] = cause; else if (!(cur.metadata.annotations || {})["kubernetes.io/change-cause"]) delete cur.metadata.annotations["kubernetes.io/change-cause"];
      d.metadata.annotations = d.metadata.annotations || {};
      d.metadata.annotations["deployment.kubernetes.io/revision"] = cur.metadata.annotations["deployment.kubernetes.io/revision"];
      var olds = all.filter(function (r) { return r !== cur; });
      var podsOf = function (r) { return self.owned(r, "Pod"); };
      var readyOf = function (r) { return podsOf(r).filter(isReady).length; };
      var oldTotal = olds.reduce(function (n, r) { return n + r.spec.replicas; }, 0);
      function scale(r, n) { if (r.spec.replicas === n) return; self.event(d, "Normal", "ScalingReplicaSet", "Scaled " + (n > r.spec.replicas ? "up" : "down") + " replica set " + r.metadata.name + " from " + r.spec.replicas + " to " + n, "deployment-controller"); r.spec.replicas = n; d.status._progressAt = sim.now; }
      if (!s.paused) {
        if (s.strategy.type === "Recreate") {
          olds.forEach(function (r) { scale(r, 0); });
          if (!olds.some(function (r) { return podsOf(r).length; })) scale(cur, s.replicas);
        } else if (!oldTotal) scale(cur, s.replicas);
        else {
          var surge = pct(s.strategy.rollingUpdate.maxSurge, s.replicas, true), unavail = pct(s.strategy.rollingUpdate.maxUnavailable, s.replicas, false);
          if (!surge && !unavail) unavail = 1;
          var total = oldTotal + cur.spec.replicas, maxTotal = s.replicas + surge;
          if (cur.spec.replicas < s.replicas && total < maxTotal) scale(cur, Math.min(s.replicas, cur.spec.replicas + (maxTotal - total)));
          else if (cur.spec.replicas > s.replicas) scale(cur, s.replicas);
          var minAvail = s.replicas - unavail, readyAll = readyOf(cur) + olds.reduce(function (n, r) { return n + readyOf(r); }, 0);
          var canDown = readyAll - minAvail;
          olds.slice().sort(function (a, b) { return a.metadata._created - b.metadata._created; }).forEach(function (r) {
            if (!r.spec.replicas) return;
            var unhealthy = r.spec.replicas - readyOf(r), down = Math.min(r.spec.replicas, unhealthy + Math.max(0, Math.min(canDown, r.spec.replicas - unhealthy)));
            // never drop below what keeps total >= minAvail while the new set is not ready
            down = Math.min(down, Math.max(0, (oldTotal + cur.spec.replicas) - Math.max(minAvail, 0) - (cur.spec.replicas - readyOf(cur)) + unhealthy));
            if (down > 0) { canDown -= Math.max(0, down - unhealthy); oldTotal -= down; scale(r, r.spec.replicas - down); }
          });
        }
      }
      // revision history limit
      var idle = olds.filter(function (r) { return !r.spec.replicas && !podsOf(r).length; }).sort(function (a, b) { return +a.metadata.annotations["deployment.kubernetes.io/revision"] - +b.metadata.annotations["deployment.kubernetes.io/revision"]; });
      while (idle.length > s.revisionHistoryLimit) self.remove(idle.shift());
      var pods = []; all.forEach(function (r) { pods = pods.concat(podsOf(r)); });
      var st = d.status, updated = podsOf(cur).length, ready = pods.filter(isReady).length;
      st.observedGeneration = d.metadata.generation; st.replicas = pods.length; st.updatedReplicas = updated; st.readyReplicas = ready; st.availableReplicas = ready; st.unavailableReplicas = Math.max(0, Math.max(s.replicas, pods.length) - ready);
      var complete = updated === s.replicas && pods.length === s.replicas && ready === s.replicas;
      if (st._progressAt == null) st._progressAt = sim.now;
      setCond(d, "Available", ready >= s.replicas - pct((s.strategy.rollingUpdate || {}).maxUnavailable || 0, s.replicas, false) && (ready > 0 || !s.replicas) ? "True" : "False", ready ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable", ready ? "Deployment has minimum availability." : "Deployment does not have minimum availability.", sim);
      if (complete) { setCond(d, "Progressing", "True", "NewReplicaSetAvailable", "ReplicaSet \"" + cur.metadata.name + "\" has successfully progressed.", sim); st._progressAt = sim.now; }
      else if (sim.now - st._progressAt > s.progressDeadlineSeconds * 1000) setCond(d, "Progressing", "False", "ProgressDeadlineExceeded", "ReplicaSet \"" + cur.metadata.name + "\" has timed out progressing.", sim);
      else setCond(d, "Progressing", "True", "ReplicaSetUpdated", "ReplicaSet \"" + cur.metadata.name + "\" is progressing.", sim);
    });
  };
  C.reconcileReplicaSets = function () {
    var self = this;
    this.list("ReplicaSet").forEach(function (r) {
      var pods = self.owned(r, "Pod").filter(function (p) { return !p.metadata.deletionTimestamp && p.status.phase !== "Failed" && p.status.phase !== "Succeeded"; }), want = r.spec.replicas;
      self.owned(r, "Pod").filter(function (p) { return p.status.phase === "Failed" && p.status.reason === "Evicted"; }).forEach(function (p) { if (self.sim.now - p.metadata._created > 600000) self.remove(p); });
      for (var i = pods.length; i < want; i++) {
        if (r._retryAt && self.sim.now < r._retryAt) break;
        var pod = self.podFromTemplate(r, r.spec.template, r.metadata.name + "-" + self.sim.suffix(5));
        if (!self.tryCreatePod(r, pod)) { r._retryAt = self.sim.now + 15000; break; }
        r._retryAt = 0;
      }
      if (pods.length > want) {
        pods.slice().sort(function (a, b) { return (isReady(a) ? 1 : 0) - (isReady(b) ? 1 : 0) || (a.spec.nodeName ? 1 : 0) - (b.spec.nodeName ? 1 : 0) || b.metadata._created - a.metadata._created; }).slice(0, pods.length - want)
          .forEach(function (p) { self.remove(p); self.event(r, "Normal", "SuccessfulDelete", "Deleted pod: " + p.metadata.name, "replicaset-controller"); });
      }
      var now = self.owned(r, "Pod");
      r.status = { replicas: now.length, fullyLabeledReplicas: now.length, readyReplicas: now.filter(isReady).length, availableReplicas: now.filter(isReady).length, observedGeneration: r.metadata.generation };
    });
  };
  C.reconcileStatefulSets = function () {
    var self = this, sim = this.sim;
    this.list("StatefulSet").forEach(function (s) {
      var hash = tplHash(sim, s.spec.template), pods = self.owned(s, "Pod"), byOrd = {}, name = s.metadata.name, ns = s.metadata.namespace;
      pods.forEach(function (p) { byOrd[+p.metadata.name.slice(name.length + 1)] = p; });
      Object.keys(byOrd).map(Number).sort(function (a, b) { return b - a; }).some(function (i) { if (i >= s.spec.replicas) { if (Object.keys(byOrd).every(function (j) { return +j <= i || !byOrd[j]; })) { self.remove(byOrd[i]); self.event(s, "Normal", "SuccessfulDelete", "delete Pod " + byOrd[i].metadata.name + " in StatefulSet " + name + " successful", "statefulset-controller"); delete byOrd[i]; } return true; } return false; });
      for (var i = 0; i < s.spec.replicas; i++) {
        var p = byOrd[i];
        if (!p) {
          var pod = self.podFromTemplate(s, s.spec.template, name + "-" + i, { "controller-revision-hash": name + "-" + hash, "statefulset.kubernetes.io/pod-name": name + "-" + i, "apps.kubernetes.io/pod-index": String(i) });
          pod.spec.hostname = name + "-" + i; pod.spec.subdomain = s.spec.serviceName;
          (s.spec.volumeClaimTemplates || []).forEach(function (t) {
            var claim = t.metadata.name + "-" + name + "-" + i;
            if (!self.get("PersistentVolumeClaim", ns, claim)) { try { self.create({ apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name: claim, namespace: ns, labels: Object.assign({}, s.spec.selector.matchLabels) }, spec: U.clone(t.spec) }); self.event(s, "Normal", "SuccessfulCreate", "create Claim " + claim + " Pod " + name + "-" + i + " in StatefulSet " + name + " success", "statefulset-controller"); } catch (e) { if (!(e instanceof CmdError)) throw e; self.event(s, "Warning", "FailedCreate", "create Claim " + claim + " for Pod " + name + "-" + i + " in StatefulSet " + name + " failed error: " + e.message, "statefulset-controller"); } }
            pod.spec.volumes = (pod.spec.volumes || []).filter(function (v) { return v.name !== t.metadata.name; }).concat([{ name: t.metadata.name, persistentVolumeClaim: { claimName: claim } }]);
          });
          self.tryCreatePod(s, pod);
          break;
        }
        if (s.spec.podManagementPolicy !== "Parallel" && !isReady(p)) break;
      }
      var stale = Object.keys(byOrd).map(Number).sort(function (a, b) { return b - a; }).filter(function (i) { return byOrd[i].metadata.labels["controller-revision-hash"] !== name + "-" + hash; });
      if (stale.length && pods.every(function (p) { return isReady(p) || p.metadata.labels["controller-revision-hash"] !== name + "-" + hash; }) && !((s.spec.updateStrategy || {}).type === "OnDelete")) {
        var newer = pods.filter(function (p) { return p.metadata.labels["controller-revision-hash"] === name + "-" + hash; });
        if (newer.every(isReady)) self.remove(byOrd[stale[0]]);
      }
      pods = self.owned(s, "Pod");
      s.status = { replicas: pods.length, readyReplicas: pods.filter(isReady).length, availableReplicas: pods.filter(isReady).length, currentReplicas: pods.length, updatedReplicas: pods.filter(function (p) { return p.metadata.labels["controller-revision-hash"] === name + "-" + hash; }).length, observedGeneration: s.metadata.generation, currentRevision: name + "-" + hash, updateRevision: name + "-" + hash };
    });
  };
  function tolerates(pod, taint) {
    return (pod.spec.tolerations || []).some(function (t) {
      if (t.effect && t.effect !== taint.effect) return false;
      if (t.operator === "Exists") return !t.key || t.key === taint.key;
      return t.key === taint.key && (t.value || "") === (taint.value || "");
    });
  }
  C.reconcileDaemonSets = function () {
    var self = this, sim = this.sim;
    this.list("DaemonSet").forEach(function (d) {
      var hash = tplHash(sim, d.spec.template), pods = self.owned(d, "Pod"), nodes = self.list("Node"), want = 0;
      nodes.forEach(function (n) {
        var tmp = { spec: d.spec.template.spec };
        var ok = (n.spec.taints || []).every(function (t) { return t.effect === "PreferNoSchedule" || t.key === "node.kubernetes.io/unschedulable" || tolerates(tmp, t); }) && matchLabels(d.spec.template.spec.nodeSelector || {}, n.metadata.labels);
        var mine = pods.filter(function (p) { return p.spec.nodeName === n.metadata.name; });
        if (ok) { want++; if (!mine.length) { var pod = self.podFromTemplate(d, d.spec.template, d.metadata.name + "-" + sim.suffix(5), { "controller-revision-hash": hash, "pod-template-generation": String(d.metadata.generation) }); pod.spec.nodeName = n.metadata.name; self.tryCreatePod(d, pod); } else if (mine[0].metadata.labels["controller-revision-hash"] !== hash && pods.every(function (p) { return isReady(p) || p === mine[0]; })) self.remove(mine[0]); }
        else mine.forEach(function (p) { self.remove(p); });
      });
      pods = self.owned(d, "Pod");
      d.status = { desiredNumberScheduled: want, currentNumberScheduled: pods.length, numberReady: pods.filter(isReady).length, numberAvailable: pods.filter(isReady).length, updatedNumberScheduled: pods.filter(function (p) { return p.metadata.labels["controller-revision-hash"] === hash; }).length, numberMisscheduled: 0, observedGeneration: d.metadata.generation };
    });
  };
  C.reconcileJobs = function () {
    var self = this, sim = this.sim;
    this.list("CronJob").forEach(function (cj) {
      var m = /^(?:\*\/(\d+)|\*)\s+\*\s+\*\s+\*\s+\*$/.exec(String(cj.spec.schedule).trim());
      if (!m || cj.spec.suspend) return;
      var every = +(m[1] || 1), minute = Math.floor((sim.epoch + sim.now) / 60000);
      if (minute % every !== 0 || cj._lastMinute === minute || sim.epoch + sim.now < Date.parse(cj.metadata.creationTimestamp) + 1000) return;
      cj._lastMinute = minute;
      var active = self.owned(cj, "Job").filter(function (j) { return !j.status.completionTime && !(j.status.conditions || []).some(function (c) { return c.type === "Failed"; }); });
      if (cj.spec.concurrencyPolicy === "Forbid" && active.length) return;
      try {
        var job = self.create({ apiVersion: "batch/v1", kind: "Job", metadata: { name: cj.metadata.name + "-" + minute, namespace: cj.metadata.namespace, labels: (cj.spec.jobTemplate.metadata || {}).labels, ownerReferences: [self.ownerRef(cj)] }, spec: U.clone(cj.spec.jobTemplate.spec) });
        self.event(cj, "Normal", "SuccessfulCreate", "Created job " + job.metadata.name, "cronjob-controller");
        cj.status = cj.status || {}; cj.status.lastScheduleTime = sim.iso(); cj.status._last = sim.now;
      } catch (e) { if (!(e instanceof CmdError)) throw e; }
      var done = self.owned(cj, "Job").filter(function (j) { return j.status.completionTime; }).sort(function (a, b) { return a.metadata._created - b.metadata._created; });
      while (done.length > cj.spec.successfulJobsHistoryLimit) self.remove(done.shift());
    });
    this.list("Job").forEach(function (j) {
      var st = j.status, s = j.spec;
      if (st.completionTime || (st.conditions || []).some(function (c) { return c.type === "Failed" && c.status === "True"; })) return;
      if (!st.startTime) { st.startTime = sim.iso(); st._start = sim.now; }
      var pods = self.owned(j, "Pod"), ok = pods.filter(function (p) { return p.status.phase === "Succeeded"; }).length, bad = pods.filter(function (p) { return p.status.phase === "Failed"; }).length;
      var active = pods.filter(function (p) { return p.status.phase !== "Succeeded" && p.status.phase !== "Failed"; });
      var restarts = active.reduce(function (n, p) { return n + ((p.status.containerStatuses || []).reduce(function (x, c) { return x + c.restartCount; }, 0)); }, 0);
      st.succeeded = ok; st.failed = bad; st.active = active.length; st.ready = active.filter(isReady).length;
      var goal = s.completions == null ? 1 : s.completions;
      if (ok >= goal) { st.completionTime = sim.iso(); st._end = sim.now; st.active = 0; setCond(j, "Complete", "True", "CompletionsReached", "Reached expected number of succeeded pods", sim); self.event(j, "Normal", "Completed", "Job completed", "job-controller"); return; }
      if (bad + restarts > s.backoffLimit) {
        active.forEach(function (p) { self.remove(p); }); st.active = 0;
        setCond(j, "Failed", "True", "BackoffLimitExceeded", "Job has reached the specified backoff limit", sim);
        self.event(j, "Warning", "BackoffLimitExceeded", "Job has reached the specified backoff limit", "job-controller"); return;
      }
      if (s.suspend) return;
      var need = Math.min(s.parallelism, goal - ok) - active.length;
      if (need > 0 && (!j._retryAt || sim.now >= j._retryAt)) {
        for (var i = 0; i < need; i++) {
          var pod = self.podFromTemplate(j, s.template, j.metadata.name + "-" + sim.suffix(5), { "batch.kubernetes.io/job-name": j.metadata.name, "job-name": j.metadata.name, "batch.kubernetes.io/controller-uid": j.metadata.uid });
          if (!self.tryCreatePod(j, pod)) break;
        }
        j._retryAt = sim.now + Math.min(360, 10 * Math.pow(2, bad)) * 1000;
      }
    });
  };

  /* ----- persistent volumes ----- */
  C.reconcileVolumes = function () {
    var self = this, sim = this.sim;
    this.list("PersistentVolumeClaim").forEach(function (c) {
      if (c.metadata.deletionTimestamp) {
        var users = self.list("Pod", c.metadata.namespace).some(function (p) { return (p.spec.volumes || []).some(function (v) { return v.persistentVolumeClaim && v.persistentVolumeClaim.claimName === c.metadata.name; }); });
        if (!users) self.remove(c, { force: true });
        return;
      }
      if (c.status.phase === "Bound") return;
      var want = mem(c.spec.resources.requests.storage), scName = c.spec.storageClassName || "";
      var pv = self.list("PersistentVolume").filter(function (v) {
        return v.status.phase === "Available" && (v.spec.storageClassName || "") === scName && mem(v.spec.capacity.storage) >= want && c.spec.accessModes.every(function (m) { return v.spec.accessModes.indexOf(m) >= 0; }) && (!c.spec.volumeName || c.spec.volumeName === v.metadata.name);
      }).sort(function (a, b) { return mem(a.spec.capacity.storage) - mem(b.spec.capacity.storage); })[0];
      if (!pv && scName) {
        var sc = self.get("StorageClass", null, scName);
        if (!sc) { self.event(c, "Warning", "ProvisioningFailed", "storageclass.storage.k8s.io \"" + scName + "\" not found", "persistentvolume-controller"); return; }
        if (sc.provisioner === "kubernetes.io/no-provisioner") { self.event(c, "Normal", "WaitForFirstConsumer", "waiting for first consumer to be created before binding", "persistentvolume-controller"); return; }
        var consumer = self.list("Pod", c.metadata.namespace).some(function (p) { return (p.spec.volumes || []).some(function (v) { return v.persistentVolumeClaim && v.persistentVolumeClaim.claimName === c.metadata.name; }); });
        if (sc.volumeBindingMode === "WaitForFirstConsumer" && !consumer) { self.event(c, "Normal", "WaitForFirstConsumer", "waiting for first consumer to be created before binding", "persistentvolume-controller"); return; }
        if (!c._provAt) { c._provAt = sim.now + 2000; self.event(c, "Normal", "ExternalProvisioning", "Waiting for a volume to be created either by the external provisioner '" + sc.provisioner + "' or manually by the system administrator. If volume creation is delayed, please verify that the provisioner is running and correctly registered.", "persistentvolume-controller"); return; }
        if (sim.now < c._provAt) return;
        pv = self.create({ apiVersion: "v1", kind: "PersistentVolume", metadata: { name: "pvc-" + c.metadata.uid, annotations: { "pv.kubernetes.io/provisioned-by": sc.provisioner } }, spec: { capacity: { storage: c.spec.resources.requests.storage }, accessModes: c.spec.accessModes.slice(), persistentVolumeReclaimPolicy: sc.reclaimPolicy || "Delete", storageClassName: scName, hostPath: { path: "/opt/local-path-provisioner/pvc-" + c.metadata.uid, type: "DirectoryOrCreate" } } });
        self.event(c, "Normal", "ProvisioningSucceeded", "Successfully provisioned volume " + pv.metadata.name, sc.provisioner);
      }
      if (!pv) { if (!scName) self.event(c, "Normal", "FailedBinding", "no persistent volumes available for this claim and no storage class is set", "persistentvolume-controller"); return; }
      pv.status.phase = "Bound"; pv.spec.claimRef = { kind: "PersistentVolumeClaim", namespace: c.metadata.namespace, name: c.metadata.name, uid: c.metadata.uid };
      c.spec.volumeName = pv.metadata.name; c.status = { phase: "Bound", accessModes: pv.spec.accessModes, capacity: { storage: pv.spec.capacity.storage } };
      if (!self.pvData[pv.metadata.name]) self.pvData[pv.metadata.name] = new S.MemFs();
    });
  };

  /* ----- scheduler ----- */
  C.nodeUsage = function (node) {
    var self = this, u = { cpu: 0, memory: 0, pods: 0, limitsCpu: 0, limitsMemory: 0 };
    this.list("Pod").forEach(function (p) { if (p.spec.nodeName !== node.metadata.name || p.status.phase === "Succeeded" || p.status.phase === "Failed") return; var r = self.podRequests(p); u.cpu += r.cpu; u.memory += r.memory; u.limitsCpu += r.limitsCpu; u.limitsMemory += r.limitsMemory; u.pods++; });
    return u;
  };
  C.schedule = function () {
    var self = this, sim = this.sim, nodes = this.list("Node");
    this.list("Pod").forEach(function (p) {
      if (p.spec.nodeName || p.metadata.deletionTimestamp) return;
      var req = self.podRequests(p), reasons = {}, fit = [], ns = p.metadata.namespace, blocked = null;
      (p.spec.volumes || []).forEach(function (v) {
        if (!v.persistentVolumeClaim || blocked) return;
        var c = self.get("PersistentVolumeClaim", ns, v.persistentVolumeClaim.claimName);
        if (!c) blocked = "persistentvolumeclaim \"" + v.persistentVolumeClaim.claimName + "\" not found";
        else if (c.status.phase !== "Bound") {
          var sc = c.spec.storageClassName ? self.get("StorageClass", null, c.spec.storageClassName) : null;
          blocked = sc && sc.volumeBindingMode === "WaitForFirstConsumer" && sc.provisioner !== "kubernetes.io/no-provisioner" ? "" : "pod has unbound immediate PersistentVolumeClaims";
        }
      });
      if (blocked === "") return;   // the volume is being provisioned for this pod; try again next tick
      if (blocked) { setPodCond(p, "PodScheduled", "False", "Unschedulable", "0/" + nodes.length + " nodes are available: " + blocked + ". preemption: 0/" + nodes.length + " nodes are available: " + nodes.length + " Preemption is not helpful for scheduling.", sim); self.event(p, "Warning", "FailedScheduling", "0/" + nodes.length + " nodes are available: " + blocked + ". preemption: 0/" + nodes.length + " nodes are available: " + nodes.length + " Preemption is not helpful for scheduling.", "default-scheduler"); return; }
      nodes.forEach(function (n) {
        var why = null, use = self.nodeUsage(n), alloc = n.status.allocatable;
        var ready = n.status.conditions.some(function (c) { return c.type === "Ready" && c.status === "True"; });
        var taints = (n.spec.taints || []).slice();
        if (n.spec.unschedulable) why = "node(s) were unschedulable";
        else if (!ready && !tolerates(p, { key: "node.kubernetes.io/not-ready", effect: "NoSchedule" })) why = "node(s) had untolerated taint {node.kubernetes.io/not-ready: }";
        else {
          var t = taints.filter(function (x) { return (x.effect === "NoSchedule" || x.effect === "NoExecute") && !tolerates(p, x); })[0];
          if (t) why = "node(s) had untolerated taint {" + t.key + ": " + (t.value || "") + "}";
          else if (p.spec.nodeSelector && !matchLabels(p.spec.nodeSelector, n.metadata.labels)) why = "node(s) didn't match Pod's node affinity/selector";
          else if (p.spec.affinity && p.spec.affinity.nodeAffinity && p.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution && !(p.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms || []).some(function (term) { return matchLabels({ matchExpressions: term.matchExpressions || [] }, n.metadata.labels); })) why = "node(s) didn't match Pod's node affinity/selector";
          else if (use.pods >= +alloc.pods) why = "Too many pods";
          else if (use.cpu + req.cpu > cpu(alloc.cpu)) why = "Insufficient cpu";
          else if (use.memory + req.memory > mem(alloc.memory)) why = "Insufficient memory";
        }
        if (why) reasons[why] = (reasons[why] || 0) + 1; else fit.push({ n: n, pods: use.pods, cpu: use.cpu });
      });
      if (!fit.length) {
        var msg = "0/" + nodes.length + " nodes are available: " + Object.keys(reasons).sort().map(function (r) { return reasons[r] + " " + r; }).join(", ") + ". preemption: 0/" + nodes.length + " nodes are available: " +
          (function () { var pre = (reasons["Insufficient cpu"] || 0) + (reasons["Insufficient memory"] || 0) + (reasons["Too many pods"] || 0), rest = nodes.length - pre; return (pre ? pre + " No preemption victims found for incoming pod" + (rest ? ", " : "") : "") + (rest ? rest + " Preemption is not helpful for scheduling" : ""); })() + ".";
        setPodCond(p, "PodScheduled", "False", "Unschedulable", msg, sim);
        self.event(p, "Warning", "FailedScheduling", msg, "default-scheduler");
        return;
      }
      fit.sort(function (a, b) { return a.pods - b.pods || a.cpu - b.cpu || (a.n.metadata.name < b.n.metadata.name ? -1 : 1); });
      p.spec.nodeName = fit[0].n.metadata.name;
      setPodCond(p, "PodScheduled", "True", null, null, sim);
      self.event(p, "Normal", "Scheduled", "Successfully assigned " + ns + "/" + p.metadata.name + " to " + p.spec.nodeName, "default-scheduler");
    });
  };
  function setPodCond(p, type, status, reason, message, sim) {
    p.status.conditions = p.status.conditions || [];
    var c = p.status.conditions.filter(function (x) { return x.type === type; })[0];
    if (!c) { c = { type: type, lastProbeTime: null, lastTransitionTime: sim.iso() }; p.status.conditions.push(c); }
    if (c.status !== status) c.lastTransitionTime = sim.iso();
    c.status = status;
    if (reason) { c.reason = reason; c.message = message; } else { delete c.reason; delete c.message; }
  }

  /* ----- kubelet ----- */
  function newCs(c) { return { name: c.name, image: c.image, state: "waiting", reason: "ContainerCreating", message: "", restartCount: 0, ready: false, started: false, proc: null, last: null, exitCode: null, startedAt: null, finishedAt: null, pulled: false, pullFails: 0, crashFails: 0, nextAt: -Infinity, probes: {}, containerID: null }; }
  C.runtime = function (pod) {
    var rt = this.rt.get(pod.metadata.uid);
    if (!rt) {
      rt = { init: (pod.spec.initContainers || []).map(newCs), main: pod.spec.containers.map(newCs), emptyDirs: {}, sandbox: false, volumesOk: false, mountWarnAt: 0, all: function () { return this.init.concat(this.main); } };
      this.rt.set(pod.metadata.uid, rt);
    }
    return rt;
  };
  C.podIp = function (node) { var i = +node.metadata.annotations["sim/index"]; node._ipSeq = (node._ipSeq || 1) + 1; return "10.244." + i + "." + node._ipSeq; };
  C.resolveEnv = function (pod, c) {
    var self = this, ns = pod.metadata.namespace, env = {}, err = null;
    (c.envFrom || []).forEach(function (ef) {
      if (err) return;
      var ref = ef.configMapRef || ef.secretRef, kind = ef.configMapRef ? "ConfigMap" : "Secret", o = ref && self.get(kind, ns, ref.name);
      if (!o) { if (!(ref && ref.optional)) err = (kind === "ConfigMap" ? "configmap" : "secret") + " \"" + (ref && ref.name) + "\" not found"; return; }
      Object.keys(o.data || {}).forEach(function (k) { env[(ef.prefix || "") + k] = kind === "Secret" ? U.b64d(o.data[k]) : o.data[k]; });
    });
    (c.env || []).forEach(function (e) {
      if (err) return;
      if (e.valueFrom) {
        var vf = e.valueFrom, ref = vf.configMapKeyRef || vf.secretKeyRef;
        if (ref) {
          var kind = vf.configMapKeyRef ? "ConfigMap" : "Secret", o = self.get(kind, ns, ref.name);
          if (!o) { if (!ref.optional) err = (kind === "ConfigMap" ? "configmap" : "secret") + " \"" + ref.name + "\" not found"; return; }
          if (!o.data || o.data[ref.key] == null) { if (!ref.optional) err = "couldn't find key " + ref.key + " in " + kind + " " + ns + "/" + ref.name; return; }
          env[e.name] = kind === "Secret" ? U.b64d(o.data[ref.key]) : o.data[ref.key];
        } else if (vf.fieldRef) {
          var fp = vf.fieldRef.fieldPath;
          env[e.name] = fp === "metadata.name" ? pod.metadata.name : fp === "metadata.namespace" ? ns : fp === "status.podIP" ? pod.status.podIP || "" : fp === "spec.nodeName" ? pod.spec.nodeName : fp === "status.hostIP" ? pod.status.hostIP || "" : fp === "spec.serviceAccountName" ? pod.spec.serviceAccountName : "";
        }
      } else env[e.name] = (e.value == null ? "" : String(e.value)).replace(/\$\((\w+)\)/g, function (m, k) { return env[k] != null ? env[k] : m; });
    });
    return { env: env, error: err };
  };
  C.buildMounts = function (pod, c, rt) {
    var self = this, ns = pod.metadata.namespace, mounts = [];
    (c.volumeMounts || []).forEach(function (vm) {
      var v = (pod.spec.volumes || []).filter(function (x) { return x.name === vm.name; })[0], store = null, ro = !!vm.readOnly;
      if (!v) return;
      if (v.configMap || v.secret) {
        var kind = v.configMap ? "ConfigMap" : "Secret", name = v.configMap ? v.configMap.name : v.secret.secretName, items = (v.configMap || v.secret).items;
        store = function () {
          var o = self.get(kind, ns, name), fs = new S.MemFs(), data = (o && o.data) || {};
          Object.keys(data).forEach(function (k) { var it = items ? items.filter(function (i) { return i.key === k; })[0] : { path: k }; if (it) fs.write("/" + it.path, kind === "Secret" ? U.b64d(data[k]) : data[k]); });
          if (vm.subPath) { var f = fs.read("/" + vm.subPath); var one = new S.MemFs(); one.read = function (p) { return p === "/" ? f : null; }; one.isDir = function () { return false; }; one.isFile = function (p) { return p === "/" && f != null; }; return one; }
          return fs;
        };
        ro = true;
      } else if (v.emptyDir) { store = rt.emptyDirs[v.name] = rt.emptyDirs[v.name] || new S.MemFs(); }
      else if (v.persistentVolumeClaim) { var claim = self.get("PersistentVolumeClaim", ns, v.persistentVolumeClaim.claimName); if (claim && claim.spec.volumeName) store = self.pvData[claim.spec.volumeName] = self.pvData[claim.spec.volumeName] || new S.MemFs(); }
      else if (v.hostPath) { var hk = "host:" + pod.spec.nodeName + ":" + v.hostPath.path; store = self.pvData[hk] = self.pvData[hk] || new S.MemFs(); }
      if (!store) store = new S.MemFs();
      if (vm.subPath && typeof store !== "function") store = new S.SubFs(store, "/" + vm.subPath.replace(/^\//, ""));
      mounts.push({ path: vm.mountPath.replace(/\/$/, "") || "/", store: store, readOnly: ro });
    });
    return mounts;
  };
  C.pullImage = function (pod, c, cs, node) {
    // returns true when the image is available on the node
    var self = this, sim = this.sim, r = S.parseRef(c.image), cache = this.nodeImages[node.metadata.name] = this.nodeImages[node.metadata.name] || {};
    if (cs.pulled && cs.imageObj && cs.pulledRef === c.image) return true;
    if (sim.now < cs.nextAt) return false;
    function fail(reason, msg) {
      cs.pullFails++; cs.state = "waiting"; cs.reason = reason; cs.message = msg; cs.pulling = false;
      var back = Math.min(300, 10 * Math.pow(2, cs.pullFails - 1));
      self.event(pod, "Warning", "Failed", "Failed to pull image \"" + c.image + "\": " + msg, "kubelet");
      self.event(pod, "Warning", "Failed", "Error: " + reason, "kubelet");
      cs.nextAt = sim.now + back * 1000; cs.backoffFrom = sim.now + 2000;
      return false;
    }
    if (!r.valid || /:$/.test(c.image)) { cs.state = "waiting"; cs.reason = "InvalidImageName"; cs.message = "Failed to apply default image tag \"" + c.image + "\": couldn't parse image name \"" + c.image + "\": invalid reference format" + (/[A-Z]/.test(c.image.split(":")[0]) ? ": repository name (" + (r.library ? "library/" : "") + c.image.split(":")[0] + ") must be lowercase" : ""); self.event(pod, "Warning", "InspectFailed", cs.message, "kubelet"); self.event(pod, "Warning", "Failed", "Error: InvalidImageName", "kubelet"); cs.nextAt = sim.now + 15000; return false; }
    var img = S.docker.registryImage(sim, r);
    if (c.imagePullPolicy === "Never") {
      if (cache[r.full] && img) { cs.imageObj = img; cs.pulled = true; cs.pulledRef = c.image; return true; }
      cs.state = "waiting"; cs.reason = "ErrImageNeverPull"; cs.message = "Container image \"" + c.image + "\" is not present with pull policy of Never"; self.event(pod, "Warning", "ErrImageNeverPull", cs.message, "kubelet"); cs.nextAt = sim.now + 15000; return false;
    }
    if (cache[r.full] && img && c.imagePullPolicy !== "Always" && !cs.pulling) { cs.imageObj = img; cs.pulled = true; cs.pulledRef = c.image; self.event(pod, "Normal", "Pulled", "Container image \"" + c.image + "\" already present on machine", "kubelet"); return true; }
    if (!cs.pulling) { cs.pulling = true; cs.pullStart = sim.now; cs.pullDone = sim.now + (cache[r.full] ? 400 : 1000 + (img ? Math.min(2500, Math.round(img.size / 2e8) * 500) : 500)); self.event(pod, "Normal", "Pulling", "Pulling image \"" + c.image + "\"", "kubelet"); }
    if (sim.now < cs.pullDone) return false;
    if (!img) {
      var known = S.docker.repoKnown(sim, r);
      return fail("ErrImagePull", (known ? "rpc error: code = NotFound desc = failed to pull and unpack image \"" + r.full + "\": failed to resolve reference \"" + r.full + "\": " + r.full + ": not found"
        : "failed to pull and unpack image \"" + r.full + "\": failed to resolve reference \"" + r.full + "\": pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed"));
    }
    if (img.private) {
      var okSecret = (pod.spec.imagePullSecrets || []).some(function (s) {
        var sec = self.get("Secret", pod.metadata.namespace, s.name);
        if (!sec || sec.type !== "kubernetes.io/dockerconfigjson") return false;
        try { return Object.keys(JSON.parse(U.b64d(sec.data[".dockerconfigjson"])).auths || {}).some(function (h) { return h.replace(/^https?:\/\//, "").replace(/\/.*$/, "") === r.registry; }); } catch (e) { return false; }
      });
      if (!okSecret) {
        (pod.spec.imagePullSecrets || []).forEach(function (s) { if (!self.get("Secret", pod.metadata.namespace, s.name)) self.event(pod, "Warning", "FailedToRetrieveImagePullSecret", "Unable to retrieve some image pull secrets (" + s.name + "); attempting to pull the image may not succeed.", "kubelet"); });
        return fail("ErrImagePull", "failed to pull and unpack image \"" + r.full + "\": failed to resolve reference \"" + r.full + "\": failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://" + r.registry + "/token: 401 Unauthorized");
      }
    }
    var secs = ((sim.now - cs.pullStart) / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    self.event(pod, "Normal", "Pulled", "Successfully pulled image \"" + c.image + "\" in " + secs + "s (" + secs + "s including waiting). Image size: " + img.size + " bytes.", "kubelet");
    cache[r.full] = true; cs.pulling = false; cs.pullFails = 0; cs.imageObj = img; cs.pulled = true; cs.pulledRef = c.image;
    return true;
  };
  C.startContainer = function (pod, c, cs, rt, node) {
    var self = this, sim = this.sim, img = cs.imageObj, cfg = img.config;
    var envRes = this.resolveEnv(pod, c);
    if (envRes.error) {
      cs.state = "waiting"; cs.reason = "CreateContainerConfigError"; cs.message = envRes.error;
      if (!cs.cfgWarnAt || sim.now - cs.cfgWarnAt >= 13000) { cs.cfgWarnAt = sim.now; self.event(pod, "Warning", "Failed", "Error: " + envRes.error, "kubelet"); }
      return false;
    }
    var argv = (c.command && c.command.length ? c.command : cfg.Entrypoint || []).concat(c.args && c.args.length ? c.args : (c.command && c.command.length ? [] : cfg.Cmd || []));
    var svcEnv = {};
    this.list("Service", pod.metadata.namespace).forEach(function (s) { if (!s.spec.clusterIP || s.spec.clusterIP === "None" || !s.spec.ports) return; var n = s.metadata.name.toUpperCase().replace(/-/g, "_"); svcEnv[n + "_SERVICE_HOST"] = s.spec.clusterIP; svcEnv[n + "_SERVICE_PORT"] = String(s.spec.ports[0].port); });
    svcEnv.KUBERNETES_SERVICE_HOST = "10.96.0.1"; svcEnv.KUBERNETES_SERVICE_PORT = "443";
    var limit = mem(((c.resources || {}).limits || {}).memory);
    var origin = { type: "pod", ns: pod.metadata.namespace, name: pod.metadata.name, uid: pod.metadata.uid, ip: pod.status.podIP, container: c.name };
    if (cs.proc) cs.prevLogs = cs.proc.logs;
    cs.proc = S.proc.create(sim, { image: img, argv: argv.map(function (a) { return String(a).replace(/\$\((\w+)\)/g, function (m, k) { return envRes.env[k] != null ? envRes.env[k] : m; }); }), env: Object.assign({}, cfg.Env, svcEnv, envRes.env), mounts: this.buildMounts(pod, c, rt), origin: origin,
      hostname: pod.spec.hostname || pod.metadata.name, ip: pod.status.podIP, tty: !!c.tty && !!c.stdin, workdir: c.workingDir, memLimitMi: limit ? limit / 1048576 : 0 });
    var err = S.proc.start(sim, cs.proc);
    cs.containerID = "containerd://" + sim.id(64);
    if (err) {
      var full = "failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: " + err + ": unknown";
      self.event(pod, "Normal", "Created", "Created container: " + c.name, "kubelet");
      self.event(pod, "Warning", "Failed", "Error: " + full, "kubelet");
      cs.last = { exitCode: 128, reason: "StartError", message: full, startedAt: sim.iso(0 - sim.epoch), finishedAt: sim.iso(), _fin: sim.now };
      cs.state = "waiting"; cs.reason = "RunContainerError"; cs.message = full; cs.proc = null; cs.startErr = true;
      cs.crashFails++; cs.restartCount += cs.everStarted || cs.crashFails > 1 ? 1 : 0; cs.nextAt = sim.now + Math.min(300, 10 * Math.pow(2, cs.crashFails - 1)) * 1000; cs.backoffFrom = sim.now + 1500;
      return false;
    }
    self.event(pod, "Normal", "Created", "Created container: " + c.name, "kubelet");
    self.event(pod, "Normal", "Started", "Started container " + c.name, "kubelet");
    cs.state = "running"; cs.reason = ""; cs.message = ""; cs.startedAt = sim.now; cs.started = true; cs.everStarted = true; cs.probes = {}; cs.ready = !c.readinessProbe;
    return true;
  };
  C.runProbe = function (pod, c, cs, probe) {
    var p = cs.proc, sim = this.sim, ip = pod.status.podIP;
    function port(v) { if (typeof v === "number") return v; if (/^\d+$/.test(v)) return +v; var np = (c.ports || []).filter(function (x) { return x.name === v; })[0]; return np ? np.containerPort : null; }
    if (probe.httpGet) {
      var pt = port(probe.httpGet.port), url = "http://" + ip + ":" + pt + probe.httpGet.path;
      if (pt == null) return "invalid port name \"" + probe.httpGet.port + "\"";
      if (p.listen.indexOf(pt) < 0) return "Get \"" + url + "\": dial tcp " + ip + ":" + pt + ": connect: connection refused";
      if (!p.app.http) return "Get \"" + url + "\": EOF";
      var keep = p.logs.length, res = p.app.http(p, { method: "GET", path: probe.httpGet.path.split("?")[0], query: "", headers: { "User-Agent": "kube-probe/1.37" }, body: "", from: { type: "kubelet", ip: pod.status.hostIP } });
      p.logs.length = keep;   // probe requests are not shown in the logs to keep them readable
      return (res.status || 200) >= 400 ? "HTTP probe failed with statuscode: " + res.status : null;
    }
    if (probe.tcpSocket) { var tp = port(probe.tcpSocket.port); return p.listen.indexOf(tp) < 0 ? "dial tcp " + ip + ":" + tp + ": connect: connection refused" : null; }
    if (probe.exec) {
      var cmd = probe.exec.command || [], bin = (cmd[0] || "").replace(/^.*\//, ""), text = cmd.join(" ");
      if (bin === "cat" || (bin === "test" && cmd[1] === "-f")) { var f = cmd[cmd.length - 1]; return p.fs.exists(f) ? null : (bin === "cat" ? "cat: can't open '" + f + "': No such file or directory" : ""); }
      if (/pg_isready/.test(text)) return p.listen.indexOf(5432) >= 0 ? null : "/var/run/postgresql:5432 - no response";
      if (/redis-cli/.test(text)) return p.listen.indexOf(6379) >= 0 ? null : "Could not connect to Redis at 127.0.0.1:6379: Connection refused";
      if (bin === "false" || /exit [1-9]/.test(text)) return "";
      if (p.image.tools.indexOf(bin) < 0 && ["sh", "bash"].indexOf(bin) < 0) return "OCI runtime exec failed: exec failed: unable to start container process: exec: \"" + cmd[0] + "\": executable file not found in $PATH: unknown";
      return null;
    }
    return null;
  };
  C.kubelet = function () {
    var self = this, sim = this.sim;
    this.list("Pod").forEach(function (pod) {
      if (!pod.spec.nodeName) { if (!pod.status.conditions) pod.status.conditions = []; return; }
      var node = self.get("Node", null, pod.spec.nodeName), st = pod.status, ns = pod.metadata.namespace;
      if (!node) return;
      var rt = self.runtime(pod);
      if (st.phase === "Succeeded" || st.phase === "Failed") return;
      if (!rt.sandbox) {
        rt.sandbox = true; st.hostIP = node.status.addresses[0].address; st.hostIPs = [{ ip: st.hostIP }]; st.podIP = pod.spec.hostNetwork ? st.hostIP : self.podIp(node); st.podIPs = [{ ip: st.podIP }]; st.startTime = sim.iso(); st._start = sim.now;
        setPodCond(pod, "PodScheduled", "True", null, null, sim);
      }
      // volumes
      if (!rt.volumesOk) {
        var missing = null;
        (pod.spec.volumes || []).forEach(function (v) {
          if (missing) return;
          if (v.configMap && !(v.configMap.optional) && !self.get("ConfigMap", ns, v.configMap.name)) missing = "MountVolume.SetUp failed for volume \"" + v.name + "\" : configmap \"" + v.configMap.name + "\" not found";
          if (v.secret && !(v.secret.optional) && !self.get("Secret", ns, v.secret.secretName)) missing = "MountVolume.SetUp failed for volume \"" + v.name + "\" : secret \"" + v.secret.secretName + "\" not found";
          if (v.persistentVolumeClaim) { var cl = self.get("PersistentVolumeClaim", ns, v.persistentVolumeClaim.claimName); if (!cl || cl.status.phase !== "Bound") missing = "Unable to attach or mount volumes: unmounted volumes=[" + v.name + "]: timed out waiting for the condition"; }
        });
        if (missing) {
          if (sim.now >= rt.mountWarnAt) { self.event(pod, "Warning", "FailedMount", missing, "kubelet"); rt.mountWarnAt = sim.now + 30000; }
          rt.all().forEach(function (cs, i) { cs.state = "waiting"; cs.reason = i < rt.init.length ? "PodInitializing" : "ContainerCreating"; });
          self.podStatus(pod, rt);
          return;
        }
        rt.volumesOk = true;
      }
      var policy = pod.spec.restartPolicy;
      function step(c, cs, isInit) {
        if (cs.restartNow) { cs.restartNow = false; if (cs.proc) { S.proc.kill(sim, cs.proc, 137); self.event(pod, "Normal", "Killing", "Container " + c.name + " definition changed, will be restarted", "kubelet"); cs.restartCount++; } cs.state = "waiting"; cs.reason = "ContainerCreating"; cs.pulled = false; cs.nextAt = -Infinity; cs.done = false; cs.crashFails = 0; }
        if (cs.state === "running") {
          if (!S.proc.poll(sim, cs.proc)) {
            var p = cs.proc, code = p.exitCode;
            cs.last = { exitCode: code, reason: p.oom ? "OOMKilled" : code === 0 ? "Completed" : "Error", startedAt: sim.iso(cs.startedAt), finishedAt: sim.iso(p.finishedAt), _fin: p.finishedAt, containerID: cs.containerID };
            cs.ready = false; cs.finishedAt = p.finishedAt; cs.exitCode = code;
            var restart = !isInit ? (policy === "Always" || (policy === "OnFailure" && code !== 0)) : (code !== 0 && policy !== "Never");
            if (isInit && code === 0) { cs.state = "terminated"; cs.reason = "Completed"; cs.done = true; return; }
            if (!restart) { cs.state = "terminated"; cs.reason = cs.last.reason; cs.done = true; return; }
            if (sim.now - cs.startedAt > 600000) cs.crashFails = 0;
            cs.crashFails++;
            var back = cs.crashFails === 1 ? 0 : Math.min(300, 10 * Math.pow(2, cs.crashFails - 2));
            cs.state = "waiting"; cs.nextAt = sim.now + back * 1000 + 1000; cs.backoffSecs = back; cs.backoffFrom = sim.now + 1000; cs.pendingRestart = true;
            cs.reason = cs.last.reason; cs.showLast = true;
          } else {
            // probes
            ["livenessProbe", "readinessProbe"].forEach(function (pk) {
              var pr = c[pk]; if (!pr || cs.state !== "running") return;
              var ps = cs.probes[pk] = cs.probes[pk] || { fails: 0, oks: 0, next: cs.startedAt + (pr.initialDelaySeconds || 0) * 1000 + (pk === "readinessProbe" ? 1000 : pr.periodSeconds * 1000) };
              if (sim.now < ps.next) return;
              ps.next = sim.now + pr.periodSeconds * 1000;
              var err = self.runProbe(pod, c, cs, pr);
              if (err == null) { ps.fails = 0; ps.oks++; if (pk === "readinessProbe" && ps.oks >= pr.successThreshold) cs.ready = true; return; }
              ps.fails++; ps.oks = 0;
              self.event(pod, "Warning", "Unhealthy", (pk === "livenessProbe" ? "Liveness" : "Readiness") + " probe failed: " + err, "kubelet");
              if (ps.fails >= pr.failureThreshold) {
                if (pk === "readinessProbe") cs.ready = false;
                else { self.event(pod, "Normal", "Killing", "Container " + c.name + " failed liveness probe, will be restarted", "kubelet"); S.proc.kill(sim, cs.proc, 137); }
              }
            });
          }
          return;
        }
        if (cs.state === "terminated") return;
        // waiting
        if (cs.pendingRestart) {
          if (sim.now < cs.nextAt) {
            if (cs.backoffSecs && sim.now >= cs.backoffFrom) {
              if (cs.reason !== "CrashLoopBackOff") self.event(pod, "Warning", "BackOff", "Back-off restarting failed container " + c.name + " in pod " + pod.metadata.name + "_" + ns + "(" + pod.metadata.uid + ")", "kubelet");
              cs.reason = "CrashLoopBackOff"; cs.message = "back-off " + (cs.backoffSecs >= 60 ? (cs.backoffSecs / 60) + "m0s" : cs.backoffSecs + "s") + " restarting failed container=" + c.name + " pod=" + pod.metadata.name + "_" + ns + "(" + pod.metadata.uid + ")";
            }
            return;
          }
          cs.pendingRestart = false; cs.restartCount++; cs.pulled = cs.pulled && c.imagePullPolicy !== "Always" ? true : false;
        }
        if (cs.reason === "RunContainerError" || (cs.reason === "CrashLoopBackOff" && !cs.pendingRestart && cs.last && cs.last.reason === "StartError")) {
          if (sim.now < cs.nextAt) { if (sim.now >= cs.backoffFrom) { if (cs.reason !== "CrashLoopBackOff") self.event(pod, "Warning", "BackOff", "Back-off restarting failed container " + c.name + " in pod " + pod.metadata.name + "_" + ns + "(" + pod.metadata.uid + ")", "kubelet"); cs.reason = "CrashLoopBackOff"; cs.message = "back-off restarting failed container=" + c.name + " pod=" + pod.metadata.name + "_" + ns + "(" + pod.metadata.uid + ")"; } return; }
        }
        if ((cs.reason === "ErrImagePull" || cs.reason === "ImagePullBackOff") && sim.now < cs.nextAt) {
          if (sim.now >= cs.backoffFrom && cs.reason !== "ImagePullBackOff") { cs.reason = "ImagePullBackOff"; cs.message = "Back-off pulling image \"" + c.image + "\": " + cs.message.replace(/^Back-off pulling image "[^"]*": /, ""); self.event(pod, "Normal", "BackOff", "Back-off pulling image \"" + c.image + "\"", "kubelet"); self.event(pod, "Warning", "Failed", "Error: ImagePullBackOff", "kubelet"); }
          return;
        }
        if (!self.pullImage(pod, c, cs, node)) { if (cs.pulling) { cs.state = "waiting"; if (["ErrImagePull", "ImagePullBackOff"].indexOf(cs.reason) < 0) cs.reason = isInit ? "PodInitializing" : (cs.showLast ? cs.reason : "ContainerCreating"); } return; }
        cs.showLast = false;
        self.startContainer(pod, c, cs, rt, node);
      }
      var inits = pod.spec.initContainers || [], blocked = false;
      for (var i = 0; i < inits.length && !blocked; i++) { var ics = rt.init[i]; if (ics.done && ics.exitCode === 0) continue; step(inits[i], ics, true); if (!(ics.done && ics.exitCode === 0)) blocked = true; }
      if (!blocked) pod.spec.containers.forEach(function (c, i) { step(c, rt.main[i], false); });
      else rt.main.forEach(function (cs) { cs.state = "waiting"; cs.reason = "PodInitializing"; });
      self.podStatus(pod, rt);
    });
  };
  function csStatus(sim, cs, c) {
    var s = { name: cs.name, image: c.image, imageID: cs.imageObj ? (cs.imageObj.registryRef || "").replace(/:[^:/]+$/, "") + "@" + cs.imageObj.id : "", ready: !!cs.ready && cs.state === "running", restartCount: cs.restartCount, started: cs.state === "running", state: {} };
    if (cs.containerID) s.containerID = cs.containerID;
    if (cs.state === "running") s.state.running = { startedAt: sim.iso(cs.startedAt) };
    else if (cs.state === "terminated") s.state.terminated = { exitCode: cs.exitCode, reason: cs.reason, startedAt: sim.iso(cs.startedAt), finishedAt: sim.iso(cs.finishedAt), containerID: cs.containerID };
    else if (cs.showLast && cs.last && cs.reason !== "CrashLoopBackOff") s.state.terminated = { exitCode: cs.last.exitCode, reason: cs.last.reason, startedAt: cs.last.startedAt, finishedAt: cs.last.finishedAt, containerID: cs.containerID };
    else { s.state.waiting = { reason: cs.reason }; if (cs.message) s.state.waiting.message = cs.message; }
    if (cs.last && !(s.state.terminated && cs.showLast)) s.lastState = { terminated: { exitCode: cs.last.exitCode, reason: cs.last.reason, startedAt: cs.last.startedAt, finishedAt: cs.last.finishedAt, containerID: cs.last.containerID } }; else s.lastState = {};
    if (cs.last && cs.last.message && s.lastState.terminated) s.lastState.terminated.message = cs.last.message;
    s._lastFin = cs.last ? cs.last._fin : null;
    return s;
  }
  C.podStatus = function (pod, rt) {
    var sim = this.sim, st = pod.status, spec = pod.spec;
    st.containerStatuses = rt.main.map(function (cs, i) { return csStatus(sim, cs, spec.containers[i]); });
    if (rt.init.length) st.initContainerStatuses = rt.init.map(function (cs, i) { return csStatus(sim, cs, spec.initContainers[i]); });
    var initDone = rt.init.every(function (cs) { return cs.done && cs.exitCode === 0; });
    var allDone = rt.main.every(function (cs) { return cs.state === "terminated"; }), anyStarted = rt.main.some(function (cs) { return cs.everStarted; });
    var initFailed = rt.init.some(function (cs) { return cs.state === "terminated" && cs.exitCode !== 0; });
    if (initFailed) st.phase = "Failed";
    else if (allDone && initDone) st.phase = rt.main.every(function (cs) { return cs.exitCode === 0; }) ? "Succeeded" : "Failed";
    else st.phase = initDone && rt.main.every(function (cs) { return cs.everStarted; }) && anyStarted ? "Running" : (initDone && anyStarted && rt.main.length > 1 ? "Running" : "Pending");
    var ready = initDone && rt.main.every(function (cs) { return cs.state === "running" && cs.ready; });
    setPodCond(pod, "Initialized", initDone ? "True" : "False", initDone ? null : "ContainersNotInitialized", initDone ? null : "containers with incomplete status: [" + rt.init.filter(function (cs) { return !cs.done; }).map(function (cs) { return cs.name; }).join(" ") + "]", sim);
    var notReady = rt.main.filter(function (cs) { return !(cs.state === "running" && cs.ready); }).map(function (cs) { return cs.name; });
    setPodCond(pod, "Ready", ready ? "True" : "False", ready ? null : (st.phase === "Succeeded" ? "PodCompleted" : "ContainersNotReady"), ready ? null : "containers with unready status: [" + notReady.join(" ") + "]", sim);
    setPodCond(pod, "ContainersReady", ready ? "True" : "False", ready ? null : (st.phase === "Succeeded" ? "PodCompleted" : "ContainersNotReady"), ready ? null : "containers with unready status: [" + notReady.join(" ") + "]", sim);
  };

  /* ----- endpoints, ingress, namespaces ----- */
  C.reconcileServices = function () {
    var self = this, sim = this.sim;
    this.list("Service").forEach(function (s) {
      var ns = s.metadata.namespace, name = s.metadata.name;
      if (s.spec.type === "LoadBalancer" && !(s.status.loadBalancer.ingress || []).length && sim.now - s.metadata._created > 3000) s.status.loadBalancer = { ingress: [{ ip: "192.168.49." + (200 + (U.hash(ns + "/" + name) % 40)) }] };
      if (!s.spec.selector || !Object.keys(s.spec.selector).length) return;
      var ready = [], notReady = [];
      self.list("Pod", ns).forEach(function (p) {
        if (!matchLabels(s.spec.selector, p.metadata.labels) || !p.status.podIP || p.status.phase === "Succeeded" || p.status.phase === "Failed") return;
        var addr = { ip: p.status.podIP, nodeName: p.spec.nodeName, targetRef: { kind: "Pod", namespace: ns, name: p.metadata.name, uid: p.metadata.uid } };
        if (p.spec.hostname && p.spec.subdomain === name) addr.hostname = p.spec.hostname;
        (isReady(p) || s.spec.publishNotReadyAddresses ? ready : notReady).push(addr);
      });
      var ports = (s.spec.ports || []).map(function (p) {
        var tp = p.targetPort;
        if (typeof tp === "string" && !/^\d+$/.test(tp)) {
          var found = null;
          self.list("Pod", ns).forEach(function (pod) { if (found || !matchLabels(s.spec.selector, pod.metadata.labels)) return; pod.spec.containers.forEach(function (c) { (c.ports || []).forEach(function (cp) { if (cp.name === tp) found = cp.containerPort; }); }); });
          tp = found;
        } else tp = +tp;
        var o = { port: tp, protocol: p.protocol || "TCP" }; if (p.name) o.name = p.name; return o;
      }).filter(function (p) { return p.port != null; });
      var sub = {}; if (ready.length) sub.addresses = ready; if (notReady.length) sub.notReadyAddresses = notReady; sub.ports = ports;
      var ep = self.get("Endpoints", ns, name), subsets = (ready.length || notReady.length) && ports.length ? [sub] : [];
      if (!ep) { ep = { apiVersion: "v1", kind: "Endpoints", metadata: { name: name, namespace: ns, labels: s.metadata.labels, uid: self.uid(), creationTimestamp: s.metadata.creationTimestamp, _created: s.metadata._created }, subsets: subsets }; self.put(ep); }
      else if (!eq(ep.subsets, subsets)) { ep.subsets = subsets; self.put(ep); }
    });
    this.list("Ingress").forEach(function (ing) {
      var cls = ing.spec.ingressClassName, def = self.list("IngressClass").filter(function (c) { return (c.metadata.annotations || {})["ingressclass.kubernetes.io/is-default-class"] === "true"; })[0];
      var handled = cls ? !!self.get("IngressClass", null, cls) : !!def;
      ing.status = ing.status || {};
      if (handled && sim.now - ing.metadata._created > 4000) { if (!(ing.status.loadBalancer || {}).ingress) ing.status.loadBalancer = { ingress: [{ ip: S.k8s.INGRESS_IP }] }; }
      else if (!handled) ing.status.loadBalancer = {};
    });
    this.list("Namespace").forEach(function (n) { if (n.metadata.deletionTimestamp) self.remove(n); });
    this.list("ResourceQuota").forEach(function (q) { var u = self.quotaUsage(q.metadata.namespace), used = {}; Object.keys((q.spec || {}).hard || {}).forEach(function (k) { if (u[k] != null) used[k] = qfmt(k, u[k]); }); q.status = { hard: q.spec.hard, used: used }; });
  };
  S.k8s.INGRESS_IP = "192.168.49.240";

  C.tick = function () {
    this.reconcileJobs(); this.reconcileDeployments(); this.reconcileReplicaSets(); this.reconcileStatefulSets(); this.reconcileDaemonSets();
    this.reconcileVolumes(); this.schedule(); this.kubelet(); this.reconcileServices(); this.reconcileDeployments(); this.reconcileReplicaSets();
    if (S.argo && S.argo.tick) S.argo.tick(this.sim);
  };
  S.tickers.push(function (sim) { if (sim.k8s) sim.k8s.tick(); });

  /* ---------- networking ---------- */
  C.podTarget = function (pod, port) {
    var rt = this.rt.get(pod.metadata.uid);
    if (!rt) return { error: "refused", ip: pod.status.podIP };
    var procs = rt.main.filter(function (cs) { return cs.state === "running" && cs.proc; }).map(function (cs) { return cs.proc; });
    var hit = procs.filter(function (p) { return p.listen.indexOf(port) >= 0; })[0];
    if (!hit) return { error: "refused", ip: pod.status.podIP };
    return { proc: hit, port: port, ip: pod.status.podIP };
  };
  C.policyAllows = function (from, pod, port) {
    var self = this, ns = pod.metadata.namespace;
    var pols = this.list("NetworkPolicy", ns).filter(function (np) { return matchLabels(np.spec.podSelector || {}, pod.metadata.labels) || !Object.keys((np.spec.podSelector || {}).matchLabels || np.spec.podSelector || {}).length && !(np.spec.podSelector || {}).matchExpressions; })
      .filter(function (np) { var t = np.spec.policyTypes; return !t || t.indexOf("Ingress") >= 0; });
    if (!pols.length || from.type === "kubelet" || from.type === "forward") return true;
    var src = from.type === "pod" ? this.get("Pod", from.ns, from.name) : null;
    var srcNs = from.type === "ingress" ? "traefik" : src ? src.metadata.namespace : null, srcLabels = from.type === "ingress" ? { "app.kubernetes.io/name": "traefik" } : src ? src.metadata.labels : null;
    return pols.some(function (np) {
      return (np.spec.ingress || []).some(function (rule) {
        var portOk = !rule.ports || !rule.ports.length || rule.ports.some(function (p) { return p.port == null || +p.port === port; });
        if (!portOk) return false;
        if (!rule.from || !rule.from.length) return true;
        return rule.from.some(function (f) {
          if (f.ipBlock) return from.type !== "pod";
          if (!srcLabels) return false;
          var nsOk = f.namespaceSelector ? matchLabels(f.namespaceSelector, (self.get("Namespace", null, srcNs) || { metadata: {} }).metadata.labels) || (!Object.keys(f.namespaceSelector.matchLabels || {}).length && !f.namespaceSelector.matchExpressions) : srcNs === ns;
          var podOk = f.podSelector ? matchLabels(f.podSelector, srcLabels) || (!Object.keys(f.podSelector.matchLabels || {}).length && !f.podSelector.matchExpressions) : true;
          return nsOk && podOk;
        });
      });
    });
  };
  C.toPod = function (from, pod, port) {
    if (!this.policyAllows(from, pod, port)) return { error: "timeout", ip: pod.status.podIP };
    return this.podTarget(pod, port);
  };
  C.toService = function (from, svc, port, viaNodePort) {
    var sp = (svc.spec.ports || []).filter(function (p) { return viaNodePort ? p.nodePort === port : p.port === port; })[0];
    if (!sp) return { error: "timeout", ip: svc.spec.clusterIP };
    return this.toServicePort(from, svc, sp);
  };
  C.toServicePort = function (from, svc, sp) {
    var self = this, ns = svc.metadata.namespace, ep = this.get("Endpoints", ns, svc.metadata.name), addrs = ep && ep.subsets[0] ? ep.subsets[0].addresses || [] : [];
    if (!addrs.length) return { error: "refused", ip: svc.spec.clusterIP };
    var idx = (svc.spec.ports || []).indexOf(sp), eport = ep.subsets[0].ports[idx] || ep.subsets[0].ports[0];
    var a = addrs[this.rr++ % addrs.length], pod = this.get("Pod", ns, a.targetRef.name);
    if (!pod) return { error: "refused", ip: svc.spec.clusterIP };
    var t = this.toPod(from, pod, eport.port);
    if (t.error) t.ip = svc.spec.clusterIP || t.ip;
    return t;
  };
  C.ingressRoute = function (host, path) {
    var self = this, best = null;
    this.list("Ingress").forEach(function (ing) {
      if (!(ing.status.loadBalancer || {}).ingress) return;
      (ing.spec.rules || []).forEach(function (r) {
        if (r.host && r.host !== host && !(r.host.indexOf("*.") === 0 && host.slice(host.indexOf(".")) === r.host.slice(1))) return;
        ((r.http || {}).paths || []).forEach(function (p) {
          var pp = p.path || "/", ok = p.pathType === "Exact" ? path === pp : (pp === "/" || path === pp || path.indexOf(pp.replace(/\/$/, "") + "/") === 0);
          if (ok && (!best || pp.length + (r.host ? 1000 : 0) > best.score)) best = { score: pp.length + (r.host ? 1000 : 0), ing: ing, backend: p.backend };
        });
      });
      if (!best && ing.spec.defaultBackend && !(ing.spec.rules || []).length) best = { score: 0, ing: ing, backend: ing.spec.defaultBackend };
    });
    var page = function (code, text) { return { response: { status: code, body: (code === 404 ? "404 page not found" : code === 503 ? "no available server" : text) + "\n", type: "text/plain" } }; };
    if (!best) return page(404, "Not Found");
    var ns = best.ing.metadata.namespace, svc = this.get("Service", ns, best.backend.service.name);
    if (!svc) return page(503, "Service Unavailable");
    var bp = best.backend.service.port, sp = (svc.spec.ports || []).filter(function (p) { return bp.number != null ? p.port === bp.number : p.name === bp.name; })[0];
    if (!sp) return page(503, "Service Unavailable");
    var t = this.toServicePort({ type: "ingress" }, svc, sp);
    if (t.error === "timeout") return page(504, "Gateway Timeout");
    if (t.error) return page(t.error === "refused" && !(this.get("Endpoints", ns, svc.metadata.name) || { subsets: [] }).subsets.some(function (s) { return (s.addresses || []).length; }) ? 503 : 502, t.error === "refused" && !(this.get("Endpoints", ns, svc.metadata.name) || { subsets: [] }).subsets.some(function (s) { return (s.addresses || []).length; }) ? "Service Unavailable" : "Bad Gateway");
    return t;
  };

  S.resolvers.push(function (sim, from, host, port) {
    var K = sim.k8s; if (!K) return null;
    var nodes = K.list("Node"), i;
    function byIp() {
      var pod = K.list("Pod").filter(function (p) { return p.status.podIP === host && !p.spec.hostNetwork; })[0];
      if (pod) return K.toPod(from, pod, port);
      var svc = K.list("Service").filter(function (s) { return s.spec.clusterIP === host; })[0];
      if (svc) return K.toService(from, svc, port, false);
      return null;
    }
    function nodePort() {
      var svc = K.list("Service").filter(function (s) { return (s.spec.ports || []).some(function (p) { return p.nodePort === port; }); })[0];
      return svc ? K.toService(from.type === "host" ? { type: "external" } : from, svc, port, true) : null;
    }
    if (from.type === "host") {
      if (host === "localhost" || host === "127.0.0.1") {
        var f = K.forwards.filter(function (x) { return x.local === port; })[0];
        if (f) {
          if (f.kind === "Pod") { var pod = K.list("Pod").filter(function (p) { return p.metadata.uid === f.podUid; })[0]; return pod ? K.podTarget(pod, f.remote) : { error: "refused" }; }
          var svc = K.get("Service", f.ns, f.name); if (!svc) return { error: "refused" };
          var pod2 = K.list("Pod").filter(function (p) { return p.metadata.uid === f.podUid; })[0];
          return pod2 ? K.podTarget(pod2, f.remote) : { error: "empty" };
        }
        return nodePort();
      }
      if (nodes.some(function (n) { return n.status.addresses[0].address === host; })) return nodePort() || { error: "refused", ip: host };
      if (host === S.k8s.INGRESS_IP && (port === 80 || port === 443)) return { ip: host, proc: { running: true, listen: [port], app: { http: function () { return {}; } } }, port: port, route: function (h, p) { return K.ingressRoute(h, p); } };
      var lb = K.list("Service").filter(function (s) { return ((s.status.loadBalancer || {}).ingress || []).some(function (x) { return x.ip === host; }); })[0];
      if (lb) return K.toService({ type: "external" }, lb, port, false);
      if (/^10\.(244|96)\./.test(host)) return { error: "timeout", ip: host };
      var ingHost = K.list("Ingress").some(function (ing) { return (ing.spec.rules || []).some(function (r) { return r.host === host; }); });
      if (ingHost && (port === 80 || port === 443)) return { ip: S.k8s.INGRESS_IP, fqdn: host, proc: { running: true, listen: [port], app: { http: function () { return {}; } } }, port: port, route: function (h, p) { return K.ingressRoute(h, p); } };
      return null;
    }
    if (from.type !== "pod") return null;
    var me = K.get("Pod", from.ns, from.name);
    if (!me) return null;
    if (host === "localhost" || host === "127.0.0.1" || host === me.status.podIP || host === me.metadata.name) { var self = K.podTarget(me, port); if (self.error) self.ip = "127.0.0.1"; return self; }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { var r = byIp(); if (r) return r; if (nodes.some(function (n) { return n.status.addresses[0].address === host; })) return nodePort() || { error: "refused", ip: host }; return { error: "timeout", ip: host }; }
    var parts = host.replace(/\.$/, "").split("."), svcName, svcNs, podHost = null;
    var tail = parts.slice(2).join(".");
    if (parts.length === 1) { svcName = parts[0]; svcNs = from.ns; }
    else if (parts.length === 2 && K.get("Service", from.ns, parts[1]) && !K.get("Namespace", null, parts[1])) { podHost = parts[0]; svcName = parts[1]; svcNs = from.ns; }
    else if (tail === "" || tail === "svc" || tail === "svc.cluster.local") { svcName = parts[0]; svcNs = parts[1]; }
    else if (parts.length >= 3 && (parts.slice(3).join(".") === "" || parts.slice(3).join(".") === "svc" || parts.slice(3).join(".") === "svc.cluster.local")) { podHost = parts[0]; svcName = parts[1]; svcNs = parts[2]; }
    else return null;
    var svc2 = K.get("Service", svcNs, svcName);
    if (!svc2) return null;
    var fqdn = (podHost ? podHost + "." : "") + svcName + "." + svcNs + ".svc.cluster.local";
    if (svc2.spec.clusterIP === "None" || podHost) {
      var ep = K.get("Endpoints", svcNs, svcName), addrs = ep && ep.subsets[0] ? (ep.subsets[0].addresses || []) : [];
      var a = podHost ? addrs.filter(function (x) { return x.hostname === podHost; })[0] : addrs[K.rr++ % Math.max(1, addrs.length)];
      if (!a) return null;
      var t = K.toPod(from, K.get("Pod", svcNs, a.targetRef.name), port); t.fqdn = fqdn; return t;
    }
    if (port === 0) return { ip: svc2.spec.clusterIP, fqdn: fqdn };
    var res = K.toService(from, svc2, port, false); res.fqdn = fqdn; if (res.error && !res.ip) res.ip = svc2.spec.clusterIP;
    return res;
  });

  /* ---------- bootstrap: a 3-node cluster that has been running for a few days ---------- */
  S.inits.push(function (sim) {
    var K = sim.k8s = new Cluster(sim), day = 86400000, t0 = -4 * day;
    sim.now = t0;
    ["default", "kube-node-lease", "kube-public", "kube-system", "traefik"].forEach(function (n) { K.create({ apiVersion: "v1", kind: "Namespace", metadata: { name: n } }); });
    [["cp-1", "control-plane"], ["worker-1", ""], ["worker-2", ""]].forEach(function (n, i) {
      var cp = !!n[1], ip = "192.168.49." + (i + 2);
      K.create({ apiVersion: "v1", kind: "Node", metadata: { name: n[0], annotations: { "sim/index": String(i) }, labels: Object.assign({ "kubernetes.io/arch": "amd64", "kubernetes.io/hostname": n[0], "kubernetes.io/os": "linux" }, cp ? { "node-role.kubernetes.io/control-plane": "" } : { "topology.kubernetes.io/zone": i === 1 ? "zone-a" : "zone-b" }) },
        spec: Object.assign({ podCIDR: "10.244." + i + ".0/24" }, cp ? { taints: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }] } : {}),
        status: { capacity: { cpu: "2", memory: "4Gi", pods: "110" }, allocatable: { cpu: "2", memory: "4Gi", pods: "110" }, addresses: [{ type: "InternalIP", address: ip }, { type: "Hostname", address: n[0] }],
          conditions: [{ type: "MemoryPressure", status: "False", reason: "KubeletHasSufficientMemory", message: "kubelet has sufficient memory available" }, { type: "DiskPressure", status: "False", reason: "KubeletHasNoDiskPressure", message: "kubelet has no disk pressure" }, { type: "PIDPressure", status: "False", reason: "KubeletHasSufficientPID", message: "kubelet has sufficient PID available" }, { type: "Ready", status: "True", reason: "KubeletReady", message: "kubelet is posting ready status" }],
          nodeInfo: { kubeletVersion: "v1.37.0", containerRuntimeVersion: "containerd://2.1.4", osImage: "Ubuntu 24.04.3 LTS", kernelVersion: "6.8.0-sandbox", architecture: "amd64", operatingSystem: "linux" } } });
    });
    K.create({ apiVersion: "storage.k8s.io/v1", kind: "StorageClass", metadata: { name: "standard", annotations: { "storageclass.kubernetes.io/is-default-class": "true" } }, provisioner: "rancher.io/local-path", reclaimPolicy: "Delete", volumeBindingMode: "WaitForFirstConsumer", allowVolumeExpansion: false });
    K.create({ apiVersion: "networking.k8s.io/v1", kind: "IngressClass", metadata: { name: "traefik", annotations: { "ingressclass.kubernetes.io/is-default-class": "true" } }, spec: { controller: "traefik.io/ingress-controller" } });
    [["cluster-admin", [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }]], ["admin", [{ apiGroups: ["", "apps", "batch", "networking.k8s.io", "rbac.authorization.k8s.io"], resources: ["*"], verbs: ["*"] }]],
      ["edit", [{ apiGroups: ["", "apps", "batch", "networking.k8s.io"], resources: ["pods", "pods/log", "pods/exec", "services", "configmaps", "secrets", "deployments", "replicasets", "statefulsets", "daemonsets", "jobs", "cronjobs", "ingresses", "persistentvolumeclaims", "endpoints", "serviceaccounts"], verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] }]],
      ["view", [{ apiGroups: ["", "apps", "batch", "networking.k8s.io"], resources: ["pods", "pods/log", "services", "configmaps", "deployments", "replicasets", "statefulsets", "daemonsets", "jobs", "cronjobs", "ingresses", "persistentvolumeclaims", "endpoints", "events", "serviceaccounts", "namespaces"], verbs: ["get", "list", "watch"] }]]
    ].forEach(function (r) { K.create({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: { name: r[0] }, rules: r[1] }); });
    K.create({ apiVersion: "v1", kind: "Service", metadata: { name: "kubernetes", namespace: "default", labels: { component: "apiserver", provider: "kubernetes" } }, spec: { clusterIP: "10.96.0.1", ports: [{ name: "https", port: 443, targetPort: 6443 }] } });
    var sysTol = [{ operator: "Exists" }];
    function sysPod(name, image, labels) { K.create({ apiVersion: "v1", kind: "Pod", metadata: { name: name + "-cp-1", namespace: "kube-system", labels: Object.assign({ tier: "control-plane" }, labels) }, spec: { nodeName: "cp-1", hostNetwork: true, priorityClassName: "system-node-critical", tolerations: sysTol, containers: [{ name: name, image: image, resources: { requests: { cpu: name === "kube-apiserver" ? "250m" : "100m" } } }] } }); }
    sysPod("etcd", "registry.k8s.io/etcd:3.6.5-0", { component: "etcd" }); sysPod("kube-apiserver", "registry.k8s.io/kube-apiserver:v1.37.0", { component: "kube-apiserver" });
    sysPod("kube-controller-manager", "registry.k8s.io/kube-controller-manager:v1.37.0", { component: "kube-controller-manager" }); sysPod("kube-scheduler", "registry.k8s.io/kube-scheduler:v1.37.0", { component: "kube-scheduler" });
    K.create({ apiVersion: "apps/v1", kind: "DaemonSet", metadata: { name: "kube-proxy", namespace: "kube-system", labels: { "k8s-app": "kube-proxy" } }, spec: { selector: { matchLabels: { "k8s-app": "kube-proxy" } }, template: { metadata: { labels: { "k8s-app": "kube-proxy" } }, spec: { hostNetwork: true, tolerations: sysTol, priorityClassName: "system-node-critical", containers: [{ name: "kube-proxy", image: "registry.k8s.io/kube-proxy:v1.37.0" }] } } } });
    K.create({ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "coredns", namespace: "kube-system", labels: { "k8s-app": "kube-dns" } }, spec: { replicas: 2, selector: { matchLabels: { "k8s-app": "kube-dns" } }, template: { metadata: { labels: { "k8s-app": "kube-dns" } }, spec: { tolerations: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }], nodeSelector: { "node-role.kubernetes.io/control-plane": "" }, containers: [{ name: "coredns", image: "registry.k8s.io/coredns/coredns:v1.14.1", ports: [{ containerPort: 53, name: "dns", protocol: "UDP" }], resources: { requests: { cpu: "100m", memory: "70Mi" }, limits: { memory: "170Mi" } } }] } } } });
    K.create({ apiVersion: "v1", kind: "Service", metadata: { name: "kube-dns", namespace: "kube-system", labels: { "k8s-app": "kube-dns" } }, spec: { clusterIP: "10.96.0.10", selector: { "k8s-app": "kube-dns" }, ports: [{ name: "dns", port: 53, protocol: "UDP", targetPort: 53 }, { name: "dns-tcp", port: 53, protocol: "TCP", targetPort: 53 }, { name: "metrics", port: 9153, protocol: "TCP", targetPort: 9153 }] } });
    K.create({ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "metrics-server", namespace: "kube-system", labels: { "k8s-app": "metrics-server" } }, spec: { selector: { matchLabels: { "k8s-app": "metrics-server" } }, template: { metadata: { labels: { "k8s-app": "metrics-server" } }, spec: { tolerations: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }], nodeSelector: { "node-role.kubernetes.io/control-plane": "" }, containers: [{ name: "metrics-server", image: "registry.k8s.io/metrics-server/metrics-server:v0.9.0", resources: { requests: { cpu: "100m", memory: "200Mi" } } }] } } } });
    K.create({ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "traefik", namespace: "traefik", labels: { "app.kubernetes.io/name": "traefik" } }, spec: { selector: { matchLabels: { "app.kubernetes.io/name": "traefik" } }, template: { metadata: { labels: { "app.kubernetes.io/name": "traefik" } }, spec: { tolerations: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }], nodeSelector: { "node-role.kubernetes.io/control-plane": "" }, containers: [{ name: "traefik", image: "docker.io/traefik:v3.6.2", ports: [{ containerPort: 8000, name: "web" }, { containerPort: 8443, name: "websecure" }], resources: { requests: { cpu: "100m", memory: "90Mi" } } }] } } } });
    K.create({ apiVersion: "v1", kind: "Service", metadata: { name: "traefik", namespace: "traefik", labels: { "app.kubernetes.io/name": "traefik" } }, spec: { type: "LoadBalancer", clusterIP: "10.96.0.80", selector: { "app.kubernetes.io/name": "traefik" }, ports: [{ name: "web", port: 80, targetPort: "web", nodePort: 31080 }, { name: "websecure", port: 443, targetPort: "websecure", nodePort: 31443 }] } }).status.loadBalancer = { ingress: [{ ip: S.k8s.INGRESS_IP }] };
    if (S.argo && S.argo.bootstrap) S.argo.bootstrap(sim);
    for (var i = 0; i < 40; i++) { sim.now += 1000; K.tick(); }
    K.list("Event").forEach(function (e) { K.objs.delete(K.key("Event", e.metadata.namespace, e.metadata.name)); });
    sim.now = 0;
    sim.fs.write("/home/learner/.kube/config", "apiVersion: v1\nkind: Config\ncurrent-context: sandbox\nclusters:\n- name: sandbox\n  cluster:\n    server: https://192.168.49.2:6443\n    certificate-authority-data: DATA+OMITTED\ncontexts:\n- name: sandbox\n  context:\n    cluster: sandbox\n    user: kubernetes-admin\nusers:\n- name: kubernetes-admin\n  user:\n    client-certificate-data: DATA+OMITTED\n    client-key-data: DATA+OMITTED\n");
  });
})(typeof window !== "undefined" ? window : globalThis);
