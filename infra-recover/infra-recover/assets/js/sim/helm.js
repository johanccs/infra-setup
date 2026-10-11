/* infra-sim — simulated Helm 4 client: repos, charts, templating, releases, rollback. */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, K8 = S.k8s;
  var H = S.helm = {};
  function herr(msg, code) { return new CmdError(msg, code == null ? 1 : code); }

  /* ---------- the course chart repository ---------- */
  var HELPERS = '{{/*\nExpand the name of the chart.\n*/}}\n{{- define "CHART.name" -}}\n{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}\n{{- end }}\n\n{{/*\nCreate a default fully qualified app name.\nIf the release name already contains the chart name it is used as is.\n*/}}\n{{- define "CHART.fullname" -}}\n{{- if .Values.fullnameOverride }}\n{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}\n{{- else }}\n{{- $name := default .Chart.Name .Values.nameOverride }}\n{{- if contains $name .Release.Name }}\n{{- .Release.Name | trunc 63 | trimSuffix "-" }}\n{{- else }}\n{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}\n{{- end }}\n{{- end }}\n{{- end }}\n\n{{/*\nSelector labels\n*/}}\n{{- define "CHART.selectorLabels" -}}\napp.kubernetes.io/name: {{ include "CHART.name" . }}\napp.kubernetes.io/instance: {{ .Release.Name }}\n{{- end }}\n\n{{/*\nCommon labels\n*/}}\n{{- define "CHART.labels" -}}\nhelm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}\n{{ include "CHART.selectorLabels" . }}\napp.kubernetes.io/version: {{ .Chart.AppVersion | quote }}\napp.kubernetes.io/managed-by: {{ .Release.Service }}\n{{- end }}\n';
  var DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ include "CHART.fullname" . }}\n  labels:\n    {{- include "CHART.labels" . | nindent 4 }}\nspec:\n  replicas: {{ .Values.replicaCount }}\n  selector:\n    matchLabels:\n      {{- include "CHART.selectorLabels" . | nindent 6 }}\n  template:\n    metadata:\n      labels:\n        {{- include "CHART.selectorLabels" . | nindent 8 }}\n    spec:\n      containers:\n        - name: {{ .Chart.Name }}\n          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"\n          imagePullPolicy: {{ .Values.image.pullPolicy }}\n          ports:\n            - name: http\n              containerPort: {{ .Values.containerPort }}\n          env:\n            - name: PORT\n              value: {{ .Values.containerPort | quote }}\n            {{- range $key, $value := .Values.env }}\n            - name: {{ $key }}\n              value: {{ $value | quote }}\n            {{- end }}\n          {{- if .Values.probes.enabled }}\n          readinessProbe:\n            httpGet:\n              path: {{ .Values.probes.path }}\n              port: http\n          livenessProbe:\n            httpGet:\n              path: {{ .Values.probes.path }}\n              port: http\n          {{- end }}\n          {{- with .Values.resources }}\n          resources:\n            {{- toYaml . | nindent 12 }}\n          {{- end }}\n';
  var SERVICE = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ include "CHART.fullname" . }}\n  labels:\n    {{- include "CHART.labels" . | nindent 4 }}\nspec:\n  type: {{ .Values.service.type }}\n  ports:\n    - port: {{ .Values.service.port }}\n      targetPort: http\n      protocol: TCP\n      name: http\n  selector:\n    {{- include "CHART.selectorLabels" . | nindent 4 }}\n';
  var INGRESS = '{{- if .Values.ingress.enabled -}}\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: {{ include "CHART.fullname" . }}\n  labels:\n    {{- include "CHART.labels" . | nindent 4 }}\nspec:\n  {{- with .Values.ingress.className }}\n  ingressClassName: {{ . }}\n  {{- end }}\n  rules:\n    - host: {{ .Values.ingress.host | quote }}\n      http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend:\n              service:\n                name: {{ include "CHART.fullname" . }}\n                port:\n                  number: {{ .Values.service.port }}\n{{- end }}\n';
  var NOTES = '{{ .Chart.Name }} {{ .Chart.AppVersion }} was installed as release "{{ .Release.Name }}" in namespace "{{ .Release.Namespace }}".\n\nCheck that it is running:\n  kubectl get pods -n {{ .Release.Namespace }} -l app.kubernetes.io/instance={{ .Release.Name }}\n{{- if .Values.ingress.enabled }}\n\nOpen it through the ingress:\n  curl http://{{ .Values.ingress.host }}/\n{{- else }}\n\nReach it from your shell:\n  kubectl port-forward -n {{ .Release.Namespace }} svc/{{ include "CHART.fullname" . }} 8080:{{ .Values.service.port }} &\n  curl localhost:8080\n{{- end }}\n';
  function chartFiles(name, version, appVersion, desc, values) {
    var sub = function (t) { return t.replace(/CHART/g, name); };
    return {
      "Chart.yaml": "apiVersion: v2\nname: " + name + "\ndescription: " + desc + "\ntype: application\nversion: " + version + "\nappVersion: \"" + appVersion + "\"\n",
      "values.yaml": values, ".helmignore": ".git/\n*.tmp\n",
      "templates/_helpers.tpl": sub(HELPERS), "templates/deployment.yaml": sub(DEPLOY), "templates/service.yaml": sub(SERVICE), "templates/ingress.yaml": sub(INGRESS), "templates/NOTES.txt": sub(NOTES)
    };
  }
  function webValues(tagNote) {
    return "# Default values for web.\nreplicaCount: 2\n\nimage:\n  repository: shop/web\n  pullPolicy: IfNotPresent\n  # Overrides the image tag. The default is the chart's appVersion.\n  tag: \"\"\n\nnameOverride: \"\"\nfullnameOverride: \"\"\n\n# The port the application listens on inside the container.\ncontainerPort: 8080\n\n# Extra environment variables, as name: value pairs.\nenv:\n  API_URL: http://api:3000\n\nservice:\n  type: ClusterIP\n  port: 80\n\ningress:\n  enabled: false\n  className: \"\"\n  host: shop.local\n\nprobes:\n  enabled: true\n  path: /healthz\n\nresources:\n  requests:\n    cpu: 50m\n    memory: 64Mi\n  limits:\n    memory: 128Mi\n";
  }
  var API_VALUES = "# Default values for api.\nreplicaCount: 1\n\nimage:\n  repository: shop/api\n  pullPolicy: IfNotPresent\n  tag: \"\"\n\nnameOverride: \"\"\nfullnameOverride: \"\"\n\ncontainerPort: 3000\n\n# DATABASE_URL is required by the application.\nenv:\n  DATABASE_URL: postgres://shop:secret@db:5432/shop\n\nservice:\n  type: ClusterIP\n  port: 3000\n\ningress:\n  enabled: false\n  className: \"\"\n  host: api.shop.local\n\nprobes:\n  enabled: true\n  path: /healthz\n\nresources:\n  requests:\n    cpu: 50m\n    memory: 128Mi\n  limits:\n    memory: 256Mi\n";
  var DB_FILES = {
    "Chart.yaml": "apiVersion: v2\nname: db\ndescription: A single-instance PostgreSQL for the shop (StatefulSet with a persistent volume)\ntype: application\nversion: 1.0.0\nappVersion: \"17\"\n",
    "values.yaml": "# Default values for db.\nimage:\n  repository: postgres\n  tag: \"17\"\n\nauth:\n  username: shop\n  database: shop\n  # Required. Set it with --set auth.password=... or in your own values file.\n  password: \"\"\n\nstorage:\n  size: 1Gi\n  # Leave empty to use the cluster's default StorageClass.\n  className: \"\"\n",
    "templates/secret.yaml": "apiVersion: v1\nkind: Secret\nmetadata:\n  name: {{ .Release.Name }}-auth\n  labels:\n    app.kubernetes.io/instance: {{ .Release.Name }}\ntype: Opaque\nstringData:\n  password: {{ required \"auth.password is required: pass --set auth.password=<value>\" .Values.auth.password | quote }}\n",
    "templates/service.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n  labels:\n    app.kubernetes.io/instance: {{ .Release.Name }}\nspec:\n  clusterIP: None\n  selector:\n    app.kubernetes.io/instance: {{ .Release.Name }}\n  ports:\n    - name: postgres\n      port: 5432\n",
    "templates/statefulset.yaml": "apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: {{ .Release.Name }}\n  labels:\n    app.kubernetes.io/instance: {{ .Release.Name }}\nspec:\n  serviceName: {{ .Release.Name }}\n  replicas: 1\n  selector:\n    matchLabels:\n      app.kubernetes.io/instance: {{ .Release.Name }}\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/instance: {{ .Release.Name }}\n    spec:\n      containers:\n        - name: postgres\n          image: \"{{ .Values.image.repository }}:{{ .Values.image.tag }}\"\n          ports:\n            - name: postgres\n              containerPort: 5432\n          env:\n            - name: POSTGRES_USER\n              value: {{ .Values.auth.username | quote }}\n            - name: POSTGRES_DB\n              value: {{ .Values.auth.database | quote }}\n            - name: POSTGRES_PASSWORD\n              valueFrom:\n                secretKeyRef:\n                  name: {{ .Release.Name }}-auth\n                  key: password\n          readinessProbe:\n            tcpSocket:\n              port: postgres\n          volumeMounts:\n            - name: data\n              mountPath: /var/lib/postgresql/data\n  volumeClaimTemplates:\n    - metadata:\n        name: data\n      spec:\n        accessModes: [\"ReadWriteOnce\"]\n        {{- with .Values.storage.className }}\n        storageClassName: {{ . }}\n        {{- end }}\n        resources:\n          requests:\n            storage: {{ .Values.storage.size }}\n",
    "templates/NOTES.txt": "PostgreSQL {{ .Chart.AppVersion }} is starting as StatefulSet \"{{ .Release.Name }}\".\n\nOther pods in namespace {{ .Release.Namespace }} reach it at:\n  postgres://{{ .Values.auth.username }}:<password>@{{ .Release.Name }}:5432/{{ .Values.auth.database }}\n"
  };
  H.REPO_URL = "https://charts.shop.example";
  H.catalog = {};
  H.catalog[H.REPO_URL] = {
    web: [["1.0.0", "1.0"], ["1.1.0", "1.1"], ["1.2.0", "1.2"], ["2.0.0", "2.0"]].map(function (v) { return { version: v[0], appVersion: v[1], description: "The shop web front end", files: chartFiles("web", v[0], v[1], "The shop web front end", webValues()) }; }),
    api: [["1.0.0", "1.0"], ["1.1.0", "1.1"]].map(function (v) { return { version: v[0], appVersion: v[1], description: "The shop REST API", files: chartFiles("api", v[0], v[1], "The shop REST API", API_VALUES) }; }),
    db: [{ version: "1.0.0", appVersion: "17", description: "A single-instance PostgreSQL for the shop (StatefulSet with a persistent volume)", files: DB_FILES }]
  };
  H.scaffold = function (name) {
    var f = chartFiles(name, "0.1.0", "1.29", "A Helm chart for Kubernetes", "# Default values for " + name + ".\nreplicaCount: 1\n\nimage:\n  repository: nginx\n  pullPolicy: IfNotPresent\n  # Overrides the image tag whose default is the chart appVersion.\n  tag: \"\"\n\nnameOverride: \"\"\nfullnameOverride: \"\"\n\ncontainerPort: 80\n\nenv: {}\n\nservice:\n  type: ClusterIP\n  port: 80\n\ningress:\n  enabled: false\n  className: \"\"\n  host: chart-example.local\n\nprobes:\n  enabled: true\n  path: /\n\nresources: {}\n");
    return f;
  };

  S.inits.push(function (sim) { sim.helm = { repos: {}, releases: {}, updated: false }; });

  /* ---------- values ---------- */
  function deepMerge(dst, src) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return src === undefined ? dst : src;
    if (!dst || typeof dst !== "object" || Array.isArray(dst)) dst = {};
    Object.keys(src).forEach(function (k) { if (src[k] === null) { delete dst[k]; return; } dst[k] = src[k] && typeof src[k] === "object" && !Array.isArray(src[k]) ? deepMerge(dst[k], src[k]) : src[k]; });
    return dst;
  }
  H.deepMerge = deepMerge;
  function parseSet(list, asString) {
    var out = {};
    (list || []).forEach(function (expr) {
      var parts = [], cur = "", depth = 0;
      for (var i = 0; i < expr.length; i++) { var ch = expr[i]; if (ch === "\\" && i + 1 < expr.length) { cur += ch + expr[++i]; continue; } if (ch === "{") depth++; if (ch === "}") depth--; if (ch === "," && !depth) { parts.push(cur); cur = ""; } else cur += ch; }
      parts.push(cur);
      parts.forEach(function (kv) {
        var eq = kv.indexOf("=");
        if (eq < 1) throw herr("Error: failed parsing --set data: key \"" + kv + "\" has no value");
        var path = kv.slice(0, eq).split(/(?<!\\)\./).map(function (p) { return p.replace(/\\\./g, "."); }), raw = kv.slice(eq + 1).replace(/\\,/g, ","), val;
        function conv(v) { if (asString) return v; if (v === "true") return true; if (v === "false") return false; if (v === "null") return null; if (/^-?\d+$/.test(v) && !/^0\d/.test(v)) return parseInt(v, 10); return v; }
        val = /^\{.*\}$/.test(raw) ? raw.slice(1, -1).split(",").map(function (x) { return conv(x.trim()); }) : conv(raw);
        var node = out;
        path.forEach(function (p, i) {
          var m = /^(.*?)\[(\d+)\]$/.exec(p), key = m ? m[1] : p, last = i === path.length - 1;
          if (m) { node[key] = Array.isArray(node[key]) ? node[key] : []; if (last) node[key][+m[2]] = val; else { node[key][+m[2]] = node[key][+m[2]] || {}; node = node[key][+m[2]]; } }
          else if (last) node[key] = val;
          else { if (!node[key] || typeof node[key] !== "object") node[key] = {}; node = node[key]; }
        });
      });
    });
    return out;
  }
  H.parseSet = parseSet;

  /* ---------- chart loading and rendering ---------- */
  H.loadChart = function (files, where) {
    var meta, values;
    if (files["Chart.yaml"] == null) throw herr("Error: Chart.yaml file is missing");
    try { meta = S.YAML.load(files["Chart.yaml"]) || {}; } catch (e) { throw herr("Error: cannot load Chart.yaml: error converting YAML to JSON: yaml: line " + ((e.mark ? e.mark.line : 0) + 1) + ": " + (e.reason || "syntax error")); }
    if (!meta.name) throw herr("Error: validation: chart.metadata.name is required");
    if (!meta.version) throw herr("Error: validation: chart.metadata.version is required");
    if (!/^\d+\.\d+\.\d+/.test(String(meta.version))) throw herr("Error: validation: chart.metadata.version \"" + meta.version + "\" is invalid");
    try { values = S.YAML.load(files["values.yaml"] || "") || {}; } catch (e2) { throw herr("Error: cannot load values.yaml: error converting YAML to JSON: yaml: line " + ((e2.mark ? e2.mark.line : 0) + 1) + ": " + (/bad indentation/.test(e2.reason || "") ? "did not find expected key" : /implicit key|multiline key|block mapping entry/.test(e2.reason || "") ? "mapping values are not allowed in this context" : "could not find expected ':'")); }
    return { meta: meta, values: values, files: files, where: where };
  };
  function tplError(e, chartName, phase) {
    if (!(e instanceof S.TemplateError)) return e;
    var file = chartName + "/" + (e.file || "templates");
    if (/^(unexpected|unclosed|function .* not defined|missing|undefined variable|template ".*" not defined)/.test(e.msg) && !e.at) return herr("Error: " + phase + "parse error at (" + file + ":" + (e.line || 1) + "): " + e.msg);
    return herr("Error: " + phase + "template: " + file + ":" + (e.line || 1) + ":" + (e.col || 1) + ": executing \"" + file + "\" at <" + (e.at || "") + ">: " + e.msg);
  }
  /* Returns { manifest, objects:[{obj, source}], notes, values } or throws a CmdError. */
  H.render = function (sim, chart, opts) {
    var name = chart.meta.name, values = deepMerge(U.clone(chart.values), opts.values || {}), eng = new S.Template(), phase = opts.phase || "";
    var cap = { KubeVersion: { Version: "v1.37.0", Major: "1", Minor: "37", GitVersion: "v1.37.0" }, APIVersions: K8.KINDS.map(function (k) { return k.api; }), HelmVersion: { Version: "v4.3.0" } };
    var chartData = {}; Object.keys(chart.meta).forEach(function (k) { chartData[k[0].toUpperCase() + k.slice(1)] = chart.meta[k]; });
    if (chartData.AppVersion != null) chartData.AppVersion = String(chartData.AppVersion);
    var data = { Values: values, Release: { Name: opts.name, Namespace: opts.namespace, Revision: opts.revision || 1, IsInstall: !opts.isUpgrade, IsUpgrade: !!opts.isUpgrade, Service: "Helm" }, Chart: chartData, Capabilities: cap, Template: { BasePath: name + "/templates" }, Files: {} };
    var names = Object.keys(chart.files).filter(function (f) { return /^templates\//.test(f) && !/\/tests\//.test(f); }).sort();
    try { names.forEach(function (f) { eng.add(f, chart.files[f]); }); }
    catch (e) { throw tplError(e, name, phase); }
    var docs = [], manifest = "", notes = "", rendered = [];
    names.forEach(function (f) {          // stage 1: evaluate every template; any template error aborts here
      var base = U.basename(f);
      if (base[0] === "_") return;
      data.Template.Name = name + "/" + f;
      try { rendered.push([f, eng.render(f, data)]); } catch (e) { throw tplError(e, name, phase); }
    });
    rendered.forEach(function (pair) {     // stage 2: parse the output as YAML
      var f = pair[0], text = pair[1], base = U.basename(f);
      if (base === "NOTES.txt") { notes = text.replace(/^\n+|\s+$/g, ""); return; }
      if (!/\.(ya?ml|json|tpl|txt)$/.test(base)) return;
      text.split(/^---\s*$/m).forEach(function (part) {
        if (!part.replace(/^\s*#.*$/gm, "").trim()) return;
        var body = part.replace(/^\n+/, "").replace(/\s+$/, "");
        var obj;
        try { obj = S.YAML.load(body); }
        catch (e2) {
          var line = (e2.mark ? e2.mark.line : 0) + 1, r = e2.reason || "";
          var msg = /bad indentation of a mapping entry/.test(r) ? "did not find expected key" : /bad indentation of a sequence/.test(r) ? "did not find expected '-' indicator" : /implicit key|multiline key|block mapping entry/.test(r) ? "mapping values are not allowed in this context" : /tab characters/.test(r) ? "found character that cannot start any token" : /duplicated mapping key/.test(r) ? "mapping key already defined" : "could not find expected ':'";
          var err = herr("Error: " + phase + "YAML parse error on " + name + "/" + f + ": error converting YAML to JSON: yaml: line " + line + ": " + msg);
          err.rendered = "---\n# Source: " + name + "/" + f + "\n" + body + "\n"; throw err;
        }
        if (obj == null) return;
        manifest += "---\n# Source: " + name + "/" + f + "\n" + body + "\n";
        docs.push({ obj: obj, source: name + "/" + f });
      });
    });
    // Helm installs in a fixed kind order (namespaces, config, services, workloads, ingresses)
    var ORDER = ["Namespace", "NetworkPolicy", "ResourceQuota", "LimitRange", "ServiceAccount", "Secret", "ConfigMap", "StorageClass", "PersistentVolume", "PersistentVolumeClaim", "ClusterRole", "ClusterRoleBinding", "Role", "RoleBinding", "Service", "DaemonSet", "Pod", "ReplicaSet", "Deployment", "StatefulSet", "Job", "CronJob", "Ingress"];
    docs.forEach(function (d, i) { d.i = i; });
    docs.sort(function (a, b) { var x = ORDER.indexOf(a.obj.kind), y = ORDER.indexOf(b.obj.kind); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.i - b.i; });
    return { manifest: manifest, objects: docs, notes: notes, values: values };
  };

  /* Apply one rendered object to the cluster (used by Helm and Argo CD). Returns "created" | "configured" | "unchanged". */
  K8.applyObject = function (K, obj, ns, decorate) {
    var o = U.clone(obj), k = K.kindFor(o);
    o.metadata = o.metadata || {};
    if (k.namespaced) o.metadata.namespace = o.metadata.namespace || ns; else delete o.metadata.namespace;
    if (decorate) decorate(o);
    var live = K.get(k.kind, o.metadata.namespace, o.metadata.name);
    if (!live) { K.create(o); return "created"; }
    var next = U.clone(o);
    if (k.kind === "Service" && next.spec) { if (!next.spec.clusterIP) next.spec.clusterIP = live.spec.clusterIP; (next.spec.ports || []).forEach(function (p, i) { var lp = (live.spec.ports || [])[i]; if (!p.nodePort && lp && lp.nodePort && (next.spec.type === "NodePort" || next.spec.type === "LoadBalancer")) p.nodePort = lp.nodePort; }); }
    if ((k.kind === "PersistentVolumeClaim") && next.spec) { next.spec.volumeName = live.spec.volumeName; if (next.spec.storageClassName === undefined) next.spec.storageClassName = live.spec.storageClassName; }
    if (k.kind === "Pod" && next.spec) next.spec.nodeName = live.spec.nodeName;
    next.status = live.status; next.metadata._created = live.metadata._created;
    Object.keys(live).forEach(function (key) { if (key[0] === "_") next[key] = live[key]; });
    var probe = U.clone(next); probe.status = live.status;
    K.validate(probe, k, live); K.applyDefaults(probe);
    var pick = function (x) { var a = Object.assign({}, x.metadata.annotations); delete a["deployment.kubernetes.io/revision"]; delete a["kubectl.kubernetes.io/last-applied-configuration"]; return S.kubectl.clean({ s: x.spec, d: x.data, r: x.rules, sub: x.subjects, l: x.metadata.labels, a: a, t: x.type }); };
    var liveA = Object.assign({}, live.metadata.annotations);
    if (liveA["deployment.kubernetes.io/revision"]) { next.metadata.annotations = Object.assign({}, next.metadata.annotations, { "deployment.kubernetes.io/revision": liveA["deployment.kubernetes.io/revision"] }); }
    if (K8.eq(pick(probe), pick(live))) return "unchanged";
    K.update(next, live);
    return "configured";
  };

  function relKey(ns, name) { return ns + "/" + name; }
  function chartLabel(rev) { return rev.chart.name + "-" + rev.chart.version; }
  function stamp(sim, t) { var d = sim.date(t); return d.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (\S+) GMT$/, function (_, wd, day, mon, yr, tm) { return wd + " " + mon + " " + String(+day).padStart(2) + " " + tm + " " + yr; }); }
  function statusBlock(sim, rel, rev, withNotes) {
    return "NAME: " + rel.name + "\nLAST DEPLOYED: " + stamp(sim, rev.updated) + "\nNAMESPACE: " + rel.namespace + "\nSTATUS: " + rev.status + "\nREVISION: " + rev.revision + "\nDESCRIPTION: " + rev.description + "\nTEST SUITE: None\n" + (withNotes !== false && rev.notes ? "NOTES:\n" + rev.notes + "\n" : "");
  }
  function owned(K, o, rel) { var a = (o.metadata.annotations || {}); return (o.metadata.labels || {})["app.kubernetes.io/managed-by"] === "Helm" && a["meta.helm.sh/release-name"] === rel.name && a["meta.helm.sh/release-namespace"] === rel.namespace; }
  function decorate(rel) { return function (o) { o.metadata.labels = Object.assign({}, o.metadata.labels, { "app.kubernetes.io/managed-by": "Helm" }); o.metadata.annotations = Object.assign({}, o.metadata.annotations, { "meta.helm.sh/release-name": rel.name, "meta.helm.sh/release-namespace": rel.namespace }); }; }
  function objRef(K, d, ns) { var k = K.kindFor(U.clone(d.obj)); return { kind: k.kind, ns: k.namespaced ? (d.obj.metadata.namespace || ns) : null, name: d.obj.metadata.name }; }
  function storeSecret(K, rel, rev) {
    var name = "sh.helm.release.v1." + rel.name + ".v" + rev.revision, live = K.get("Secret", rel.namespace, name);
    var sec = { apiVersion: "v1", kind: "Secret", metadata: { name: name, namespace: rel.namespace, labels: { name: rel.name, owner: "helm", status: rev.status, version: String(rev.revision) } }, type: "helm.sh/release.v1", data: { release: U.b64e("(gzipped release record: chart, values and manifest)") } };
    if (live) { live.metadata.labels.status = rev.status; return; }
    if (K.get("Namespace", null, rel.namespace)) K.create(sec);
  }
  function notReady(K, refs) {
    var bad = [];
    refs.forEach(function (r) {
      var o = K.get(r.kind, r.ns, r.name); if (!o) return;
      var s = o.status || {}, ok = true;
      if (r.kind === "Deployment") ok = (s.observedGeneration || 0) >= o.metadata.generation && (s.updatedReplicas || 0) === o.spec.replicas && (s.readyReplicas || 0) === o.spec.replicas && (s.replicas || 0) === o.spec.replicas;
      else if (r.kind === "StatefulSet") ok = (s.readyReplicas || 0) === o.spec.replicas && (s.updatedReplicas || 0) === o.spec.replicas;
      else if (r.kind === "DaemonSet") ok = (s.numberReady || 0) === (s.desiredNumberScheduled || 0);
      else if (r.kind === "Pod") ok = K8.isReady(o) || s.phase === "Succeeded";
      else if (r.kind === "PersistentVolumeClaim") ok = s.phase === "Bound";
      else if (r.kind === "Job") ok = !!s.completionTime;
      if (!ok) bad.push(r);
    });
    return bad;
  }
  H.notReady = notReady;

  /* Find a chart: local directory, or repo/name. */
  function findChart(sim, sc, refName, f) {
    var path = U.norm(refName, sc.cwd);
    if (/^oci:\/\//.test(refName)) throw herr("Error: OCI registries are not simulated in this sandbox. Use the course repository instead:\n  helm repo add shop " + H.REPO_URL);
    if (sim.fs.isDir(path)) {
      var files = {};
      S.docker.walk(sim.fs, path).forEach(function (e) { files[e[0]] = e[1]; });
      if (files["Chart.yaml"] == null) throw herr("Error: Chart.yaml file is missing");
      return H.loadChart(files, refName);
    }
    if (/\.tgz$/.test(refName)) throw herr("Error: packaged charts (.tgz) are not simulated; point at the chart directory or use shop/<chart>");
    if (/^(\.{0,2}\/|~)/.test(refName)) throw herr("Error: " + (f._cmd ? f._cmd + ": " : "") + "path \"" + refName + "\" not found");
    var m = /^([^/]+)\/([^/]+)$/.exec(refName);
    if (!m) throw herr("Error: " + (f._cmd || "INSTALLATION FAILED") + ": path \"" + refName + "\" not found");
    var url = sim.helm.repos[m[1]];
    if (!url) throw herr("Error: " + (f._cmd ? f._cmd + ": " : "") + "repo " + m[1] + " not found");
    var versions = (H.catalog[url] || {})[m[2]];
    if (!versions) throw herr("Error: " + (f._cmd ? f._cmd + ": " : "") + "chart \"" + m[2] + "\" matching " + (f.version || "") + " not found in " + m[1] + " index. (try 'helm repo update'): no chart name found");
    var v = f.version ? versions.filter(function (x) { return x.version === f.version; })[0] : versions[versions.length - 1];
    if (!v) throw herr("Error: " + (f._cmd ? f._cmd + ": " : "") + "chart \"" + m[2] + "\" matching " + f.version + " not found in " + m[1] + " index. (try 'helm repo update'): no chart version found for " + m[2] + "-" + f.version);
    return H.loadChart(v.files, refName);
  }
  function userValues(sim, sc, f) {
    var vals = {};
    (f.values || []).forEach(function (fn) {
      var text = sim.fs.read(U.norm(fn, sc.cwd));
      if (text == null) throw herr("Error: open " + fn + ": no such file or directory");
      try { vals = deepMerge(vals, S.YAML.load(text) || {}); } catch (e) { throw herr("Error: failed to parse " + fn + ": error converting YAML to JSON: yaml: line " + ((e.mark ? e.mark.line : 0) + 1) + ": " + (/bad indentation/.test(e.reason || "") ? "did not find expected key" : "mapping values are not allowed in this context")); }
    });
    vals = deepMerge(vals, parseSet(f.set, false));
    vals = deepMerge(vals, parseSet(f["set-string"], true));
    return vals;
  }
  var COMMON = { str: "n namespace version timeout kube-context kubeconfig description o output wait-for-jobs wait", bool: "create-namespace dry-run debug atomic rollback-on-failure generate-name install i reuse-values reset-values reset-then-reuse-values force force-replace cleanup-on-fail dependency-update skip-crds no-hooks A all-namespaces hide-notes take-ownership server-side force-conflicts",
    multi: "f values set set-string set-file show-only s", alias: { n: "namespace", f: "values", i: "install", o: "output", A: "all-namespaces", s: "show-only" },
    unknown: function (x) { return "Error: unknown " + (/shorthand/.test(x) ? x.replace("unknown ", "") : "flag: " + x); } };
  function flags(a) {
    // --wait and --dry-run take optional values in Helm 4; normalise them
    a = a.map(function (x) { return x === "--wait" ? "--wait=watcher" : /^--dry-run=/.test(x) ? "--dry-run" : x; });
    return U.flags(a, COMMON);
  }
  function nsOf(sim, f) { return f.namespace || sim.k8s.currentNs; }
  function timeoutOf(f) { return f.timeout ? S.kubectl.parseDur(f.timeout) : 300; }

  /* install or upgrade a release. Returns exit code. */
  async function deploy(sim, sc, io, f, name, chartRef, isUpgrade) {
    var K = sim.k8s, ns = nsOf(sim, f), key = relKey(ns, name), rel = sim.helm.releases[key], P = isUpgrade ? "UPGRADE FAILED" : "INSTALLATION FAILED";
    f._cmd = P;
    if (f.atomic) { io.err("Flag --atomic has been deprecated, use --rollback-on-failure instead\n"); f["rollback-on-failure"] = true; }
    if (f.force) { io.err("Flag --force has been deprecated, use --force-replace instead\n"); }
    var last = rel ? rel.revisions[rel.revisions.length - 1] : null, deployed = rel ? rel.revisions.filter(function (r) { return r.status === "deployed"; }).pop() : null;
    if (!isUpgrade && rel && last.status !== "uninstalled") throw herr("Error: INSTALLATION FAILED: cannot re-use a name that is still in use");
    if (isUpgrade && last && /^pending-/.test(last.status)) throw herr("Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress");
    if (isUpgrade && (!rel || !deployed)) { if (rel && !deployed) throw herr("Error: UPGRADE FAILED: \"" + name + "\" has no deployed releases"); throw herr("Error: UPGRADE FAILED: \"" + name + "\" has no deployed releases"); }
    if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(name) || name.length > 53) throw herr("Error: " + P + ": release name \"" + name + "\": invalid release name, must match regex ^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$ and the length must not be longer than 53");
    var chart = findChart(sim, sc, chartRef, f), supplied = userValues(sim, sc, f), given = Object.keys(supplied).length > 0, vals;
    if (isUpgrade) {
      var prev = deployed.values || {};
      if (f["reset-values"]) vals = supplied;
      else if (f["reuse-values"] || f["reset-then-reuse-values"] || !given) vals = deepMerge(U.clone(prev), supplied);
      else vals = supplied;
    } else vals = supplied;
    var revision = rel ? last.revision + 1 : 1, out;
    out = H.render(sim, chart, { name: name, namespace: ns, values: vals, revision: revision, isUpgrade: isUpgrade, phase: P + ": " });
    if (f["dry-run"]) {
      io.out("NAME: " + name + "\nLAST DEPLOYED: " + stamp(sim) + "\nNAMESPACE: " + ns + "\nSTATUS: pending-" + (isUpgrade ? "upgrade" : "install") + "\nREVISION: " + revision + "\nDESCRIPTION: Dry run complete\nTEST SUITE: None\nHOOKS:\nMANIFEST:\n" + out.manifest + (out.notes ? "\nNOTES:\n" + out.notes + "\n" : ""));
      return 0;
    }
    if (!K.get("Namespace", null, ns)) {
      if (!f["create-namespace"]) throw herr("Error: " + P + ": create: failed to create: namespaces \"" + ns + "\" not found");
      K.create({ apiVersion: "v1", kind: "Namespace", metadata: { name: ns } });
    }
    if (!rel) rel = sim.helm.releases[key] = { name: name, namespace: ns, revisions: [] };
    var refs = out.objects.map(function (d) { try { return objRef(K, d, ns); } catch (e) { return null; } });
    // ownership check: Helm refuses to adopt objects it did not create
    for (var i = 0; i < out.objects.length; i++) {
      var d = out.objects[i], k0;
      try { k0 = K.kindFor(U.clone(d.obj)); } catch (e) { throw herr("Error: " + P + ": unable to build kubernetes objects from release manifest: " + e.message.replace(/^error: /, "").split("\n")[0]); }
      var live = K.get(k0.kind, k0.namespaced ? d.obj.metadata.namespace || ns : null, d.obj.metadata.name);
      if (live && !owned(K, live, rel) && !f["take-ownership"]) throw herr("Error: " + P + ": Unable to continue with " + (isUpgrade ? "update" : "install") + ": " + k0.kind + " \"" + d.obj.metadata.name + "\" in namespace \"" + (live.metadata.namespace || "") + "\" exists and cannot be imported into the current release: invalid ownership metadata; label validation error: missing key \"app.kubernetes.io/managed-by\": must be set to \"Helm\"; annotation validation error: missing key \"meta.helm.sh/release-name\": must be set to \"" + name + "\"; annotation validation error: missing key \"meta.helm.sh/release-namespace\": must be set to \"" + ns + "\"");
    }
    var rev = { revision: revision, chart: { name: chart.meta.name, version: String(chart.meta.version), appVersion: chart.meta.appVersion == null ? "" : String(chart.meta.appVersion) }, values: vals, computed: out.values, manifest: out.manifest, objects: out.objects.map(function (d) { return d.obj; }), refs: refs.filter(Boolean), notes: out.notes, status: isUpgrade ? "pending-upgrade" : "pending-install", updated: sim.now, description: isUpgrade ? "Preparing upgrade" : "Initial install underway" };
    rel.revisions.push(rev);
    var errs = [];
    out.objects.forEach(function (d) { try { K8.applyObject(K, d.obj, ns, decorate(rel)); } catch (e) { if (!(e instanceof CmdError)) throw e; errs.push(e.message.replace(/^The (\w+) "/, function (_, kd) { var kk = K8.BY_KIND[kd]; return kd + (kk && kk.group ? "." + kk.group.split(".")[0] : "") + " \""; }).replace(/^error: /, "")); } });
    function fail(reason, text) {
      rev.status = "failed"; rev.description = (isUpgrade ? "Upgrade" : "Release") + " \"" + name + "\" failed: " + reason;
      storeSecret(K, rel, rev);
      if (f["rollback-on-failure"]) {
        if (isUpgrade) { rollbackTo(sim, rel, deployed, "Rollback to " + deployed.revision); throw herr("Error: UPGRADE FAILED: release " + name + " failed, and has been rolled back due to rollback-on-failure being set: " + reason); }
        uninstall(sim, rel, false); throw herr("Error: INSTALLATION FAILED: release " + name + " failed, and has been uninstalled due to rollback-on-failure being set: " + reason);
      }
      throw herr(text || "Error: " + P + ": " + reason);
    }
    if (errs.length) fail(errs[0], "Error: " + P + ": " + (errs.length === 1 ? errs[0] : errs.length + " errors occurred:\n\t* " + errs.join("\n\t* ") + "\n"));
    if (isUpgrade) deployed.refs.forEach(function (r) { if (!rev.refs.some(function (x) { return x.kind === r.kind && x.ns === r.ns && x.name === r.name; })) { var o = K.get(r.kind, r.ns, r.name); if (o) K.remove(o); } });
    if (f.wait || f["rollback-on-failure"]) {
      var left = timeoutOf(f);
      if (!sim.realtime) left = Math.min(left, 90);
      for (;;) {
        sim.reconcile();
        var bad = notReady(K, rev.refs);
        if (!bad.length) break;
        if (left <= 0) fail("context deadline exceeded");
        await sim.wait(1000); left--;
      }
    }
    if (isUpgrade) rel.revisions.forEach(function (r) { if (r !== rev && r.status === "deployed") { r.status = "superseded"; storeSecret(K, rel, r); } });
    rev.status = "deployed"; rev.description = isUpgrade ? "Upgrade complete" : "Install complete";
    storeSecret(K, rel, rev);
    if (isUpgrade) io.out("Release \"" + name + "\" has been upgraded. Happy Helming!\n");
    io.out(statusBlock(sim, rel, rev, !f["hide-notes"]));
    return 0;
  }
  function uninstall(sim, rel, keep) {
    var K = sim.k8s, seen = {};
    rel.revisions.forEach(function (r) { (r.refs || []).forEach(function (x) { var id = x.kind + "/" + x.ns + "/" + x.name; if (seen[id]) return; seen[id] = 1; var o = K.get(x.kind, x.ns, x.name); if (o && owned(K, o, rel)) K.remove(o); }); });
    K.list("Secret", rel.namespace).forEach(function (s) { if (s.type === "helm.sh/release.v1" && s.metadata.labels.name === rel.name && !keep) K.remove(s); });
    if (keep) { var last = rel.revisions[rel.revisions.length - 1]; rel.revisions.forEach(function (r) { if (r.status === "deployed") r.status = "superseded"; }); last.status = "uninstalled"; last.description = "Uninstallation complete"; }
    else delete sim.helm.releases[relKey(rel.namespace, rel.name)];
  }
  function rollbackTo(sim, rel, target, description) {
    var K = sim.k8s, last = rel.revisions[rel.revisions.length - 1], cur = rel.revisions.filter(function (r) { return r.status === "deployed"; }).pop() || last;
    var rev = { revision: last.revision + 1, chart: target.chart, values: target.values, computed: target.computed, manifest: target.manifest, objects: target.objects, refs: target.refs, notes: target.notes, status: "deployed", updated: sim.now, description: description };
    target.objects.forEach(function (o) { try { K8.applyObject(K, o, rel.namespace, decorate(rel)); } catch (e) { if (!(e instanceof CmdError)) throw e; } });
    [cur, last].forEach(function (c) { (c.refs || []).forEach(function (r) { if (!rev.refs.some(function (x) { return x.kind === r.kind && x.ns === r.ns && x.name === r.name; })) { var o = K.get(r.kind, r.ns, r.name); if (o && owned(K, o, rel)) K.remove(o); } }); });
    rel.revisions.forEach(function (r) { if (r.status === "deployed" || /^pending-/.test(r.status)) { r.status = /^pending-/.test(r.status) ? "failed" : "superseded"; storeSecret(K, rel, r); } });
    rel.revisions.push(rev); storeSecret(K, rel, rev);
    return rev;
  }
  function getRel(sim, f, name, what) {
    var rel = sim.helm.releases[relKey(nsOf(sim, f), name)];
    if (!rel) throw herr("Error: " + (what ? what + ": " : "") + "release: not found");
    return rel;
  }
  function tabTable(rows) {
    var w = [];
    rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); }); });
    return rows.map(function (r) { return r.map(function (c, i) { return String(c).padEnd(w[i]); }).join("\t"); }).join("\n") + "\n";
  }
  function longStamp(sim, t) { return sim.date(t).toISOString().replace("T", " ").replace(/\.(\d+)Z$/, ".$1" + String(100000 + U.hash(String(t)) % 899999) + " +0000 UTC"); }

  var cmds = H.cmds = {};
  cmds.install = async function (a, io, sim, sc) {
    var f = flags(a), name = f._[0], chart = f._[1];
    if (f["generate-name"]) { chart = f._[0]; name = (chart || "chart").split("/").pop().replace(/[^a-z0-9-]/g, "") + "-" + (1700000000 + Math.floor(sim.now / 1000)); }
    if (!name || !chart) throw herr("Error: INSTALLATION FAILED: must either provide a name or specify --generate-name");
    return deploy(sim, sc, io, f, name, chart, false);
  };
  cmds.upgrade = async function (a, io, sim, sc) {
    var f = flags(a), name = f._[0], chart = f._[1];
    if (!name || !chart) throw herr("Error: \"helm upgrade\" requires 2 arguments\n\nUsage:  helm upgrade [RELEASE] [CHART] [flags]");
    var rel = sim.helm.releases[relKey(nsOf(sim, f), name)];
    if (f.install && (!rel || rel.revisions[rel.revisions.length - 1].status === "uninstalled")) { io.out("Release \"" + name + "\" does not exist. Installing it now.\n"); return deploy(sim, sc, io, f, name, chart, false); }
    return deploy(sim, sc, io, f, name, chart, true);
  };
  cmds.uninstall = cmds["delete"] = cmds.del = cmds.un = function (a, io, sim) {
    var f = U.flags(a, { str: "n namespace timeout description cascade", bool: "keep-history dry-run wait no-hooks ignore-not-found", alias: { n: "namespace" }, unknown: COMMON.unknown });
    if (!f._.length) throw herr("Error: \"helm uninstall\" requires at least 1 argument\n\nUsage:  helm uninstall RELEASE_NAME [...] [flags]");
    f._.forEach(function (name) {
      var rel = sim.helm.releases[relKey(nsOf(sim, f), name)];
      if (!rel) { if (f["ignore-not-found"]) return; throw herr("Error: uninstall: Release not loaded: " + name + ": release: not found"); }
      uninstall(sim, rel, f["keep-history"]);
      io.out("release \"" + name + "\" uninstalled\n");
    });
  };
  cmds.rollback = async function (a, io, sim) {
    var f = U.flags(a, { str: "n namespace timeout history-max wait", bool: "dry-run force force-replace no-hooks cleanup-on-fail wait-for-jobs", alias: { n: "namespace" }, unknown: COMMON.unknown });
    if (!f._.length) throw herr("Error: \"helm rollback\" requires at least 1 argument\n\nUsage:  helm rollback <RELEASE> [REVISION] [flags]");
    var rel = getRel(sim, f, f._[0]), last = rel.revisions[rel.revisions.length - 1], target;
    if (f._[1] && f._[1] !== "0") { target = rel.revisions.filter(function (r) { return r.revision === +f._[1]; })[0]; if (!target) throw herr("Error: release has no " + f._[1] + " version"); }
    else {
      var cur = rel.revisions.filter(function (r) { return r.status === "deployed"; }).pop();
      target = cur && cur !== last ? cur : rel.revisions.filter(function (r) { return r.revision < last.revision && (r.status === "superseded" || r.status === "deployed"); }).pop();
      if (!target) throw herr("Error: release has no " + (last.revision - 1) + " version");
    }
    rollbackTo(sim, rel, target, "Rollback to " + target.revision);
    io.out("Rollback was a success! Happy Helming!\n");
  };
  cmds.list = cmds.ls = function (a, io, sim) {
    var f = U.flags(a, { str: "n namespace o output filter l selector max", bool: "A all-namespaces a all q short failed deployed pending uninstalled superseded d date r reverse no-headers", alias: { n: "namespace", A: "all-namespaces", a: "all", q: "short", o: "output" }, unknown: COMMON.unknown });
    var ns = nsOf(sim, f), rows = [];
    Object.keys(sim.helm.releases).sort().forEach(function (key) {
      var rel = sim.helm.releases[key], last = rel.revisions[rel.revisions.length - 1];
      if (!f["all-namespaces"] && rel.namespace !== ns) return;
      var st = last.status, show = f.all || (f.failed && st === "failed") || (f.pending && /^pending/.test(st)) || (f.uninstalled && st === "uninstalled") || (f.deployed && st === "deployed") || (!f.failed && !f.pending && !f.uninstalled && !f.deployed && (st === "deployed" || st === "failed"));
      if (!show) return;
      if (f.filter && !new RegExp(f.filter).test(rel.name)) return;
      rows.push([rel.name, rel.namespace, last.revision, longStamp(sim, last.updated), st, chartLabel(last), last.chart.appVersion]);
    });
    if (f.short) { if (rows.length) io.out(rows.map(function (r) { return r[0]; }).join("\n") + "\n"); return; }
    if (f.output === "json") { io.out(JSON.stringify(rows.map(function (r) { return { name: r[0], namespace: r[1], revision: String(r[2]), updated: r[3], status: r[4], chart: r[5], app_version: r[6] }; })) + "\n"); return; }
    io.out(tabTable((f["no-headers"] ? [] : [["NAME", "NAMESPACE", "REVISION", "UPDATED", "STATUS", "CHART", "APP VERSION"]]).concat(rows)));
  };
  cmds.status = function (a, io, sim) {
    var f = U.flags(a, { str: "n namespace revision o output", bool: "show-desc show-resources", alias: { n: "namespace", o: "output" }, unknown: COMMON.unknown });
    if (!f._.length) throw herr("Error: \"helm status\" requires 1 argument\n\nUsage:  helm status RELEASE_NAME [flags]");
    var rel = getRel(sim, f, f._[0]), rev = f.revision ? rel.revisions.filter(function (r) { return r.revision === +f.revision; })[0] : rel.revisions[rel.revisions.length - 1];
    if (!rev) throw herr("Error: release: not found");
    io.out(statusBlock(sim, rel, rev));
  };
  cmds.history = cmds.hist = function (a, io, sim) {
    var f = U.flags(a, { str: "n namespace max o output", alias: { n: "namespace", o: "output" }, unknown: COMMON.unknown });
    if (!f._.length) throw herr("Error: \"helm history\" requires 1 argument\n\nUsage:  helm history RELEASE_NAME [flags]");
    var rel = getRel(sim, f, f._[0]);
    io.out(tabTable([["REVISION", "UPDATED", "STATUS", "CHART", "APP VERSION", "DESCRIPTION"]].concat(rel.revisions.map(function (r) { return [r.revision, stamp(sim, r.updated), r.status, chartLabel(r), r.chart.appVersion, r.description]; }))));
  };
  cmds.get = function (a, io, sim) {
    var f = U.flags(a, { str: "n namespace revision o output", bool: "a all", alias: { n: "namespace", a: "all", o: "output" }, unknown: COMMON.unknown }), what = f._[0];
    if (["values", "manifest", "notes", "all", "hooks", "metadata"].indexOf(what) < 0 || !f._[1]) throw herr("Error: usage: helm get values|manifest|notes|all RELEASE_NAME");
    var rel = getRel(sim, f, f._[1]), rev = f.revision ? rel.revisions.filter(function (r) { return r.revision === +f.revision; })[0] : rel.revisions[rel.revisions.length - 1];
    if (!rev) throw herr("Error: release: not found");
    var vals = function () { var v = f.all ? rev.computed : rev.values; return (f.all ? "COMPUTED VALUES:\n" : "USER-SUPPLIED VALUES:\n") + (v && Object.keys(v).length ? S.yamlDump(v, true) : "null\n"); };
    if (what === "values") io.out(f.output === "json" ? JSON.stringify(f.all ? rev.computed : rev.values || null) + "\n" : vals());
    else if (what === "manifest") io.out(rev.manifest + "\n");
    else if (what === "notes") io.out("NOTES:\n" + rev.notes + "\n");
    else if (what === "hooks") io.out("");
    else if (what === "metadata") io.out("NAME: " + rel.name + "\nCHART: " + rev.chart.name + "\nVERSION: " + rev.chart.version + "\nAPP_VERSION: " + rev.chart.appVersion + "\nNAMESPACE: " + rel.namespace + "\nREVISION: " + rev.revision + "\nSTATUS: " + rev.status + "\nDEPLOYED_AT: " + sim.iso(rev.updated) + "\n");
    else io.out(statusBlock(sim, rel, rev, false) + vals().replace(/^/, "") + "\nCOMPUTED VALUES:\n" + S.yamlDump(rev.computed, true) + "\nHOOKS:\nMANIFEST:\n" + rev.manifest + "\nNOTES:\n" + rev.notes + "\n");
  };
  cmds.template = function (a, io, sim, sc) {
    var f = flags(a), name = f._.length > 1 ? f._[0] : "release-name", chartRef = f._.length > 1 ? f._[1] : f._[0];
    if (!chartRef) throw herr("Error: \"helm template\" requires at least 1 argument\n\nUsage:  helm template [NAME] [CHART] [flags]");
    f._cmd = "";
    var chart = findChart(sim, sc, chartRef, f), out;
    try { out = H.render(sim, chart, { name: name, namespace: nsOf(sim, f), values: userValues(sim, sc, f) }); }
    catch (e) { if (e instanceof CmdError && e.rendered && f.debug) io.out(e.rendered); if (e instanceof CmdError && /YAML parse error/.test(e.message)) throw herr(e.message + "\n\nUse --debug flag to render out invalid YAML"); throw e; }
    var text = out.manifest;
    if (f["show-only"]) {
      var parts = out.manifest.split(/^---\n/m).filter(Boolean), keep = parts.filter(function (p) { return f["show-only"].some(function (s) { return p.indexOf("# Source: " + chart.meta.name + "/" + s + "\n") === 0; }); });
      if (!keep.length) throw herr("Error: could not find template " + f["show-only"][0] + " in chart");
      text = keep.map(function (p) { return "---\n" + p; }).join("");
    }
    io.out(text);
  };
  cmds.lint = function (a, io, sim, sc) {
    var f = flags(a), code = 0, n = 0;
    (f._.length ? f._ : ["."]).forEach(function (dir) {
      n++;
      var msgs = [], bad = false, path = U.norm(dir, sc.cwd), files = {};
      io.out("==> Linting " + dir + "\n");
      if (!sim.fs.isDir(path)) { io.out("Error unable to check Chart.yaml file in chart: stat " + path + "/Chart.yaml: no such file or directory\n\n"); code = 1; return; }
      S.docker.walk(sim.fs, path).forEach(function (e) { files[e[0]] = e[1]; });
      try {
        var chart = H.loadChart(files, dir);
        if (!chart.meta.icon) msgs.push("[INFO] Chart.yaml: icon is recommended");
        if (chart.meta.apiVersion !== "v2" && chart.meta.apiVersion !== "v1") { msgs.push("[ERROR] Chart.yaml: apiVersion is required. The value must be either \"v1\" or \"v2\""); bad = true; }
        if (!files["values.yaml"]) msgs.push("[WARNING] values.yaml: file does not exist");
        if (!Object.keys(files).some(function (k) { return /^templates\//.test(k); })) msgs.push("[ERROR] templates/: directory does not exist"), bad = true;
        var out = H.render(sim, chart, { name: "test-release", namespace: nsOf(sim, f), values: userValues(sim, sc, f) });
        out.objects.forEach(function (d) {
          var src = d.source.slice(chart.meta.name.length + 1);
          if (!d.obj.metadata || !d.obj.metadata.name) { msgs.push("[ERROR] " + src + ": object name does not conform to Kubernetes naming requirements: \"\""); bad = true; }
          try { sim.k8s.kindFor(U.clone(d.obj)); } catch (e) { msgs.push("[ERROR] " + src + ": unable to validate against any schema: no matches for kind \"" + d.obj.kind + "\" in version \"" + d.obj.apiVersion + "\""); bad = true; }
        });
      } catch (e) {
        if (!(e instanceof CmdError)) throw e;
        var m = e.message.replace(/^Error: /, ""), tm = /^(?:template: |parse error at \()[^/]+\/(templates\/[^:)]+)/.exec(m) || /YAML parse error on [^/]+\/(templates\/\S+?):/.exec(m);
        msgs.push("[ERROR] " + (tm ? tm[1] : /values/.test(m) ? "values.yaml" : /Chart\.yaml|chart\.metadata/.test(m) ? "Chart.yaml" : "templates/") + ": " + (/YAML parse error/.test(m) ? "unable to parse YAML: " + m.replace(/^YAML parse error on \S+ /, "") : m)); bad = true;
      }
      io.out(msgs.join("\n") + (msgs.length ? "\n" : "") + "\n");
      if (bad) code++;
    });
    if (code) throw herr("Error: " + n + " chart(s) linted, " + code + " chart(s) failed");
    io.out(n + " chart(s) linted, 0 chart(s) failed\n");
  };
  cmds.create = function (a, io, sim, sc) {
    var name = a.filter(function (x) { return x[0] !== "-"; })[0];
    if (!name) throw herr("Error: \"helm create\" requires 1 argument\n\nUsage:  helm create NAME [flags]");
    var dir = U.norm(name, sc.cwd), files = H.scaffold(U.basename(dir));
    Object.keys(files).forEach(function (k) { sim.fs.write(dir + "/" + k, files[k]); });
    io.out("Creating " + name + "\n");
  };
  cmds.show = cmds.inspect = function (a, io, sim, sc) {
    var f = flags(a), what = f._[0], ref = f._[1];
    if (["values", "chart", "all", "readme"].indexOf(what) < 0 || !ref) throw herr("Error: usage: helm show values|chart|all CHART");
    f._cmd = "";
    var chart = findChart(sim, sc, ref, f);
    if (what === "values") io.out(chart.files["values.yaml"] || "");
    else if (what === "chart") io.out(chart.files["Chart.yaml"]);
    else if (what === "readme") io.out("");
    else io.out(chart.files["Chart.yaml"] + "\n---\n" + (chart.files["values.yaml"] || ""));
  };
  cmds.pull = cmds.fetch = function (a, io, sim, sc) {
    var f = U.flags(a, { str: "version d destination untardir repo", bool: "untar", alias: { d: "destination" }, unknown: COMMON.unknown });
    if (!f._.length) throw herr("Error: \"helm pull\" requires at least 1 argument");
    f._cmd = "";
    var chart = findChart(sim, sc, f._[0], f);
    if (!f.untar) throw herr("Error: the sandbox can't store .tgz archives; add --untar to unpack the chart into a directory:\n  helm pull " + f._[0] + " --untar");
    var dir = U.norm(chart.meta.name, U.norm(f.untardir || f.destination || ".", sc.cwd));
    Object.keys(chart.files).forEach(function (k) { sim.fs.write(dir + "/" + k, chart.files[k]); });
  };
  var repo = {
    add: function (a, io, sim) {
      var f = U.flags(a, { str: "username password", bool: "force-update pass-credentials insecure-skip-tls-verify", unknown: COMMON.unknown });
      if (f._.length !== 2) throw herr("Error: \"helm repo add\" requires 2 arguments\n\nUsage:  helm repo add [NAME] [URL] [flags]");
      var url = f._[1].replace(/\/$/, "");
      if (!H.catalog[url]) throw herr("Error: looks like \"" + f._[1] + "\" is not a valid chart repository or cannot be reached: Get \"" + url + "/index.yaml\": dial tcp: lookup " + url.replace(/^\w+:\/\//, "").split("/")[0] + ": no such host\n(the sandbox has no internet access; the course repository is " + H.REPO_URL + ")");
      if (sim.helm.repos[f._[0]] && sim.helm.repos[f._[0]] !== url && !f["force-update"]) throw herr("Error: repository name (" + f._[0] + ") already exists, please specify a different name");
      var had = sim.helm.repos[f._[0]] === url;
      sim.helm.repos[f._[0]] = url;
      io.out(had ? "\"" + f._[0] + "\" already exists with the same configuration, skipping\n" : "\"" + f._[0] + "\" has been added to your repositories\n");
    },
    list: function (a, io, sim) { var names = Object.keys(sim.helm.repos); if (!names.length) throw herr("Error: no repositories to show"); io.out(tabTable([["NAME", "URL"]].concat(names.map(function (n) { return [n, sim.helm.repos[n]]; })))); },
    update: async function (a, io, sim) {
      var names = Object.keys(sim.helm.repos);
      if (!names.length) throw herr("Error: no repositories found. You must add one before updating");
      io.out("Hang tight while we grab the latest from your chart repositories...\n");
      await sim.wait(1000);
      names.forEach(function (n) { io.out("...Successfully got an update from the \"" + n + "\" chart repository\n"); });
      io.out("Update Complete. ⎈Happy Helming!⎈\n");
    },
    remove: function (a, io, sim) { a.forEach(function (n) { if (!sim.helm.repos[n]) throw herr("Error: no repo named \"" + n + "\" found"); delete sim.helm.repos[n]; io.out("\"" + n + "\" has been removed from your repositories\n"); }); }
  };
  repo.ls = repo.list; repo.rm = repo.remove;
  cmds.repo = function (a, io, sim) { var sub = repo[a[0]]; if (!sub) throw herr("Error: unknown command \"" + (a[0] || "") + "\" for \"helm repo\"\nAvailable Commands: add, list, remove, update"); return sub(a.slice(1), io, sim); };
  cmds.search = function (a, io, sim) {
    var f = U.flags(a, { str: "version o output max-col-width", bool: "l versions devel r regexp", alias: { l: "versions" }, unknown: COMMON.unknown });
    if (f._[0] === "hub") throw herr("Error: Artifact Hub can't be reached from the sandbox. Search the repositories you have added with: helm search repo");
    if (f._[0] !== "repo") throw herr("Error: usage: helm search repo [KEYWORD]");
    var kw = (f._[1] || "").toLowerCase(), rows = [];
    if (!Object.keys(sim.helm.repos).length) throw herr("Error: no repositories configured");
    Object.keys(sim.helm.repos).forEach(function (rn) {
      var charts = H.catalog[sim.helm.repos[rn]] || {};
      Object.keys(charts).sort().forEach(function (cn) {
        if (kw && (rn + "/" + cn).indexOf(kw) < 0 && charts[cn][0].description.toLowerCase().indexOf(kw) < 0) return;
        (f.versions ? charts[cn].slice().reverse() : [charts[cn][charts[cn].length - 1]]).forEach(function (v) { rows.push([rn + "/" + cn, v.version, v.appVersion, v.description]); });
      });
    });
    if (!rows.length) { io.out("No results found\n"); return; }
    io.out(tabTable([["NAME", "CHART VERSION", "APP VERSION", "DESCRIPTION"]].concat(rows)));
  };
  cmds.version = function (a, io) { io.out(a.indexOf("--short") >= 0 ? "v4.3.0+g1a2b3c4\n" : "version.BuildInfo{Version:\"v4.3.0\", GitCommit:\"1a2b3c4d5e6f\", GitTreeState:\"clean\", GoVersion:\"go1.25.1\", KubeClientVersion:\"v1.37\"}\n"); };
  cmds.env = function (a, io, sim) { io.out("HELM_BIN=\"helm\"\nHELM_DRIVER=\"secret\"\nHELM_NAMESPACE=\"" + sim.k8s.currentNs + "\"\nHELM_REPOSITORY_CONFIG=\"/home/learner/.config/helm/repositories.yaml\"\n"); };
  cmds.dependency = cmds.dep = function () { throw herr("Error: chart dependencies (subcharts) are not simulated in this sandbox"); };
  cmds.package = function () { throw herr("Error: packaging charts into .tgz archives is not simulated in this sandbox"); };
  cmds.test = function (a, io) { io.out("TEST SUITE: None\n"); };

  var USAGE = "The Kubernetes package manager\n\nUsage:\n  helm [command]\n\nSimulated commands:\n  create      create a new chart with the given name\n  get         download extended information of a named release (values, manifest, notes, all)\n  history     fetch release history\n  install     install a chart\n  lint        examine a chart for possible issues\n  list        list releases\n  pull        download a chart from a repository (use --untar)\n  repo        add, list, remove, update chart repositories\n  rollback    roll back a release to a previous revision\n  search      search for a keyword in charts (helm search repo)\n  show        show information of a chart (values, chart, all)\n  status      display the status of the named release\n  template    locally render templates\n  uninstall   uninstall a release\n  upgrade     upgrade a release\n  version     print the helm version information\n\nThe course chart repository:  helm repo add shop " + H.REPO_URL + "\n";
  S.commands.helm = async function (a, io, sim, sc) {
    if (!a.length || a[0] === "--help" || a[0] === "-h" || a[0] === "help") { io.out(USAGE); return 0; }
    var pre = [];
    while (a.length && a[0][0] === "-") { if (/^(-n|--namespace|--kube-context)$/.test(a[0])) { pre.push(a[0], a[1]); a = a.slice(2); } else { pre.push(a[0]); a = a.slice(1); } }
    var fn = cmds[a[0]];
    if (!fn) throw herr("Error: unknown command \"" + a[0] + "\" for \"helm\"\nRun 'helm --help' for usage.");
    return fn(pre.concat(a.slice(1)), io, sim, sc);
  };
})(typeof window !== "undefined" ? window : globalThis);
