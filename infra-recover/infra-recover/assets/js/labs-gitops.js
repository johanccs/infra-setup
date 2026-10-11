/* infra-sim — Helm and Argo CD scenarios (lessons 20–25). */
(function (g) {
  "use strict";
  var S = g.InfraSim, lab = S.lab, K8 = S.k8s, G = S.git, REPO = S.helm.REPO_URL, GIT = G.DEFAULT_URL;
  function backend(h, ns) { var s = S.shop(); h.apply([s.secret, s.db, s.dbSvc, s.api, s.apiSvc], ns); h.settle(40); }
  function rel(h, ns, name) { return h.release(ns, name); }
  function application(name, source, policy, ns) {
    var app = { apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: { name: name, namespace: "argocd" }, spec: { project: "default", source: Object.assign({ repoURL: GIT, targetRevision: "HEAD" }, source), destination: { server: "https://kubernetes.default.svc", namespace: ns || "shop" }, syncPolicy: { syncOptions: ["CreateNamespace=true"] } } };
    if (policy) app.spec.syncPolicy.automated = policy;
    return app;
  }
  function headFile(sim, path) { var c = G.resolve(G.remote(sim, GIT), "HEAD"); return (c && c.files[path]) || ""; }

  lab("h-basics", {
    lesson: 20, tech: "helm", level: 2, title: "Install, inspect and upgrade a release",
    story: "<p>The shop's database and API already run in the namespace <code>shop</code>. The front end is published as a Helm chart in the team's chart repository, <code>" + REPO + "</code>. Install it with Helm instead of hand-written manifests.</p>",
    setup: function (sim, h) { backend(h, "shop"); },
    tasks: [
      { text: "Add the repository under the name <code>shop</code> and list the charts it offers.", hint: "<code>helm repo add shop " + REPO + "</code>, <code>helm repo update</code>, <code>helm search repo shop</code>", check: function (sim, h) { return sim.helm.repos.shop === REPO && h.ran(/^helm search repo/); }, sticky: true },
      { text: "Look at the settings the <code>web</code> chart exposes.", hint: "<code>helm show values shop/web</code>", check: function (sim, h) { return h.ran(/^helm (show|inspect) (values|all)/); }, sticky: true },
      { text: "Install chart version 1.0.0 as the release <code>web</code> in the namespace <code>shop</code>, with one replica.", hint: "<code>helm install web shop/web --version 1.0.0 -n shop --set replicaCount=1</code>", check: function (sim, h) { var r = rel(h, "shop", "web"); if (r && r.status === "deployed" && r.chart.version === "1.0.0" && h.deployReady("shop", "web")) h.flags.v1 = 1; return !!h.flags.v1; } },
      { text: "See what Helm created: list the release and print the manifest it applied.", hint: "<code>helm list -n shop</code>, <code>helm get manifest web -n shop</code>, <code>kubectl -n shop get all</code>", check: function (sim, h) { return h.ran(/^helm (list|ls)/) && h.ran(/^helm get (manifest|all)/); }, sticky: true },
      { text: "Upgrade the release to chart version 1.1.0 with three replicas, and wait until the rollout is complete.", hint: "<code>helm upgrade web shop/web --version 1.1.0 -n shop --set replicaCount=3 --wait</code>", check: function (sim, h) { var r = rel(h, "shop", "web"); return !!h.flags.v1 && !!r && r.status === "deployed" && r.chart.version === "1.1.0" && h.deployReady("shop", "web", 3) && h.shopOk("shop"); } }
    ],
    solution: ["helm repo add shop " + REPO, "helm repo update", "helm search repo shop", "helm show values shop/web", "helm install web shop/web --version 1.0.0 -n shop --set replicaCount=1", "kubectl -n shop rollout status deployment/web", "helm list -n shop", "helm get manifest web -n shop", "kubectl -n shop get all", "helm upgrade web shop/web --version 1.1.0 -n shop --set replicaCount=3 --wait", "helm history web -n shop"],
    explain: "<p>A <b>chart</b> is a package of templated manifests plus default values; a <b>release</b> is one installation of a chart under a name in a namespace. Helm rendered the templates with your values, applied the result, and stored a record of each <b>revision</b> as a Secret in the release's namespace (<code>kubectl -n shop get secrets</code>). Helm only <em>submits</em> manifests: without <code>--wait</code> it reports <i>deployed</i> the moment the API server accepts them, whether or not the pods ever start.</p>"
  });

  lab("h-chart", {
    lesson: 21, tech: "helm", level: 3, title: "Create a chart and drive it with values", cwd: "/home/learner/charts",
    story: "<p>Create your own chart, see how values flow into templates, and install it twice-over with different settings without touching the templates.</p>",
    setup: function (sim, h) { sim.fs.mkdirp("/home/learner/charts"); },
    tasks: [
      { text: "Scaffold a chart called <code>hello</code> and look at its files.", hint: "<code>helm create hello</code>, <code>ls hello hello/templates</code>, <code>cat hello/values.yaml</code>", check: function (sim, h) { return !!h.file("charts/hello/Chart.yaml"); } },
      { text: "Check the chart and render it locally without installing anything.", hint: "<code>helm lint hello</code>, <code>helm template demo hello</code>", check: function (sim, h) { return h.ran(/^helm lint/) && h.ran(/^helm template/); }, sticky: true },
      { text: "Write a values file <code>my-values.yaml</code> that sets <code>replicaCount: 2</code> and the Service type to <code>NodePort</code>. Install the chart as release <code>hello</code> with it.", hint: "<pre><code>replicaCount: 2\nservice:\n  type: NodePort</code></pre><code>helm install hello ./hello -f my-values.yaml --wait</code>", check: function (sim, h) { var r = rel(h, "default", "hello"), s = h.get("Service", "default", "hello"); return !!r && r.status === "deployed" && h.deployReady("default", "hello", 2) && !!s && s.spec.type === "NodePort"; } },
      { text: "Add an environment variable <code>GREETING</code> to the pods through the chart's <code>env</code> value, <em>keeping</em> the two replicas.", hint: "<code>helm upgrade hello ./hello --reuse-values --set env.GREETING=hello --wait</code>. Without <code>--reuse-values</code>, the settings from your values file would be dropped.", check: function (sim, h) { var d = h.get("Deployment", "default", "hello"); return !!d && (d.spec.template.spec.containers[0].env || []).some(function (e) { return e.name === "GREETING"; }) && h.deployReady("default", "hello", 2); } }
    ],
    solution: ["helm create hello", "ls hello hello/templates", "cat hello/values.yaml", "helm lint hello", "helm template demo hello", { file: "my-values.yaml", content: "replicaCount: 2\nservice:\n  type: NodePort\n" }, "helm install hello ./hello -f my-values.yaml --wait", "kubectl get deployment,service hello", "helm upgrade hello ./hello --reuse-values --set env.GREETING=hello --wait", "helm get values hello", "kubectl get deployment hello -o jsonpath='{.spec.template.spec.containers[0].env}'"],
    explain: "<p>Templates are ordinary manifests with holes: <code>{{ .Values.replicaCount }}</code> is filled from <code>values.yaml</code>, overridden by <code>-f</code> files, overridden in turn by <code>--set</code>. <code>helm template</code> shows the exact YAML that would be sent to the cluster, which makes it the main debugging tool for charts. The sandbox's <code>helm create</code> produces a trimmed scaffold (the real one also adds a ServiceAccount, an autoscaler, a Gateway route and a test), but the structure and the helper templates in <code>_helpers.tpl</code> are the same.</p>"
  });

  var GOOD = S.helm.catalog[REPO].web[0].files;
  lab("h-fix-template", {
    lesson: 21, tech: "helm", level: 4, fix: true, title: "The chart that won't render", cwd: "/home/learner/charts",
    story: "<p>A colleague \"cleaned up\" the front end's chart in <code>~/charts/web</code>. Now <code>helm install web ./web -n shop</code> fails before anything reaches the cluster. There are <b>two</b> mistakes in two different template files. Use <code>helm lint</code> and <code>helm template</code>: they report one problem at a time, with file and line.</p>",
    setup: function (sim, h) {
      backend(h, "shop");
      Object.keys(GOOD).forEach(function (f) { h.write("charts/web/" + f, GOOD[f]); });
      h.write("charts/web/templates/service.yaml", GOOD["templates/service.yaml"].replace(".Values.service.port }}", ".Values.service.ports.http }}"));
      h.write("charts/web/templates/deployment.yaml", GOOD["templates/deployment.yaml"].replace("            - name: {{ $key }}\n              value: {{ $value | quote }}", "          - name: {{ $key }}\n            value: {{ $value | quote }}"));
    },
    tasks: [
      { text: "Lint the chart and read the first error: which file, which line, which expression?", hint: "<code>helm lint web</code>", check: function (sim, h) { return h.ran(/^helm (lint|template|install)/); }, sticky: true },
      { text: "Fix the template error. (Compare the expression with the structure of <code>values.yaml</code>.)", hint: "<i>nil pointer evaluating interface {}.http</i> means <code>.Values.service.ports</code> does not exist, so asking it for <code>.http</code> fails. <code>values.yaml</code> defines <code>service.port</code>. Edit <code>web/templates/service.yaml</code>.", check: function (sim, h) { return /\.Values\.service\.port }}/.test(h.file("charts/web/templates/service.yaml") || ""); } },
      { text: "Lint again. The next error is a <em>YAML</em> error: render the broken file to see what the template produced, and fix the indentation.", hint: "<code>helm template web ./web --debug</code> prints the rendered text even though it is invalid. In the <code>env:</code> list the generated entries are indented less than the first one. In <code>web/templates/deployment.yaml</code> the two lines inside <code>{{- range … }}</code> need two more spaces each.", check: function (sim, h) { try { S.helm.render(sim, S.helm.loadChart((function () { var o = {}; S.docker.walk(sim.fs, "/home/learner/charts/web").forEach(function (e) { o[e[0]] = e[1]; }); return o; })(), "web"), { name: "web", namespace: "shop", values: {} }); return true; } catch (e) { return false; } } },
      { text: "Install the chart as release <code>web</code> in the namespace <code>shop</code>. The shop must list its products.", hint: "<code>helm install web ./web -n shop --wait</code>", check: function (sim, h) { var r = rel(h, "shop", "web"); return !!r && r.status === "deployed" && h.deployReady("shop", "web") && h.shopOk("shop"); } }
    ],
    diagnose: { q: "Helm reported the first problem as a <i>template</i> error and the second as a <i>YAML parse</i> error. What is the difference?", options: ["There is none", "A template error happens while Go templates are evaluated; a YAML error means the templates ran fine but their output is not valid YAML", "YAML errors come from the cluster", "Template errors only occur with --debug"], answer: 1, why: "Rendering has two stages: evaluate the templates into text, then parse that text as YAML. Indentation mistakes only surface in the second stage, and the line number then refers to the <em>rendered</em> output." },
    solution: ["helm lint web", "sed -i 's/.Values.service.ports.http/.Values.service.port/' web/templates/service.yaml", "helm lint web", "helm template web ./web --debug", { file: "web/templates/deployment.yaml", content: GOOD["templates/deployment.yaml"] }, "helm lint web", "helm install web ./web -n shop --wait", "kubectl -n shop get pods"],
    explain: "<p>Both mistakes are classics. Reading a key from something that does not exist (<code>.Values.service.ports.http</code>) aborts rendering with <i>nil pointer evaluating interface {}</i>, and the message quotes the exact expression. Wrong indentation produces syntactically valid templates and broken YAML; because the reported line belongs to the rendered text, <code>helm template --debug</code> is how you see what the YAML parser saw. Inside a list, generated lines must line up with their hand-written neighbours, which is why real charts lean on <code>nindent</code> for blocks. Run <code>helm lint</code> and <code>helm template</code> in CI and neither mistake reaches a cluster.</p>"
  });

  lab("h-upgrade", {
    lesson: 22, tech: "helm", level: 3, title: "Upgrade without losing your settings, then roll back",
    story: "<p>The release <code>web</code> in the namespace <code>shop</code> was installed from chart 1.0.0 with <code>--set replicaCount=3,env.BANNER=\"Autumn sale\"</code>. Upgrade it to chart 1.1.0 and change the banner, without accidentally resetting the replica count.</p>",
    setup: async function (sim, h) { backend(h, "shop"); await h.sh("helm repo add shop " + REPO + "\nhelm install web shop/web --version 1.0.0 -n shop --set replicaCount=3 --set env.BANNER='Autumn sale'"); h.settle(40); },
    tasks: [
      { text: "Look at the values this release was installed with.", hint: "<code>helm get values web -n shop</code>", check: function (sim, h) { return h.ran(/^helm get values/); }, sticky: true },
      { text: "Upgrade to chart 1.1.0 and set the banner to a new text. Afterwards the release must still have three replicas.", hint: "<code>helm upgrade web shop/web --version 1.1.0 -n shop --reuse-values --set env.BANNER=\"Winter sale\" --wait</code>. Try it once without <code>--reuse-values</code> and check <code>helm get values</code> if you want to see the trap.", check: function (sim, h) { var r = rel(h, "shop", "web"); if (r && r.status === "deployed" && r.chart.version === "1.1.0" && r.values.replicaCount === 3 && r.values.env && r.values.env.BANNER && r.values.env.BANNER !== "Autumn sale" && h.deployReady("shop", "web", 3)) h.flags.up = 1; return !!h.flags.up; } },
      { text: "Read the release history, then roll back to revision 1.", hint: "<code>helm history web -n shop</code>, <code>helm rollback web 1 -n shop</code>", check: function (sim, h) { var r = rel(h, "shop", "web"); return !!h.flags.up && !!r && r.status === "deployed" && r.chart.version === "1.0.0" && /Rollback/.test(r.description) && h.ran(/^helm (history|hist)/); } }
    ],
    solution: ["helm list -n shop", "helm get values web -n shop", "helm upgrade web shop/web --version 1.1.0 -n shop --reuse-values --set env.BANNER=\"Winter sale\" --wait", "helm get values web -n shop", "helm history web -n shop", "helm rollback web 1 -n shop", "helm history web -n shop"],
    explain: "<p>On <code>helm upgrade</code> the values are computed afresh: chart defaults, then whatever you pass. If you pass <em>any</em> <code>--set</code> or <code>-f</code> without <code>--reuse-values</code>, the settings from earlier revisions are gone, and a release silently drops from three replicas to the chart's default. The robust habit is to keep all settings in a values file under version control and pass it on every upgrade (<code>helm upgrade --install web shop/web -f values.yaml</code>). A rollback does not delete history: it creates a <em>new</em> revision whose content is a copy of the old one.</p>"
  });

  lab("h-fix-release", {
    lesson: 22, tech: "helm", level: 4, fix: true, title: "Another operation is in progress",
    story: "<p>Yesterday's upgrade of the release <code>web</code> (namespace <code>shop</code>) to chart 1.2.0 failed. Today's retry was started in CI and the job was cancelled half-way. Now every attempt ends with:</p><pre><code>Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress</code></pre><p>and <code>helm list -n shop</code> shows no release at all. Version 2.0.0 of the chart contains the fix and is ready to ship.</p>",
    setup: async function (sim, h) {
      backend(h, "shop");
      await h.sh("helm repo add shop " + REPO + "\nhelm install web shop/web --version 1.0.0 -n shop"); h.settle(40);
      await h.sh("helm upgrade web shop/web --version 1.2.0 -n shop --wait --timeout 20s"); h.settle(600);
      var r = sim.helm.releases["shop/web"], failed = r.revisions[r.revisions.length - 1];
      r.revisions.push(Object.assign({}, failed, { revision: failed.revision + 1, status: "pending-upgrade", description: "Preparing upgrade", updated: sim.now })); h.settle(300);
    },
    tasks: [
      { text: "Make the release visible and read its history.", hint: "<code>helm list -n shop</code> hides releases in a pending state. Add <code>-a</code>, then <code>helm history web -n shop</code>.", check: function (sim, h) { return h.ran(/^helm (list|ls) .*(-a\b|--all\b|--pending)|^helm (history|hist|status)/); }, sticky: true },
      { text: "Clear the stuck operation by rolling back to the last revision that worked.", hint: "<code>helm rollback web 1 -n shop</code>", check: function (sim, h) { var r = rel(h, "shop", "web"); return !!r && !/^pending/.test(r.status); } },
      { text: "Upgrade to chart 2.0.0, this time letting Helm wait for the pods so that a failure is reported instead of being left behind.", hint: "<code>helm upgrade web shop/web --version 2.0.0 -n shop --wait</code> (add <code>--rollback-on-failure</code> to have Helm undo a failed upgrade by itself).", check: function (sim, h) { var r = rel(h, "shop", "web"); return !!r && r.status === "deployed" && r.chart.version === "2.0.0" && h.deployReady("shop", "web") && h.shopOk("shop"); } }
    ],
    diagnose: { q: "Why does Helm refuse every upgrade?", options: ["The chart repository is down", "The newest revision is stuck in <code>pending-upgrade</code>: the Helm process died before it could mark the revision deployed or failed, and Helm treats that record as a lock", "The namespace is being deleted", "The cluster has no capacity"], answer: 1, why: "<code>helm history</code> shows the last revision as <i>pending-upgrade</i>. No Helm process is actually running; only the record says so." },
    solution: ["helm list -n shop", "helm list -n shop -a", "helm history web -n shop", "helm upgrade web shop/web --version 2.0.0 -n shop", "helm rollback web 1 -n shop", "helm history web -n shop", "helm upgrade web shop/web --version 2.0.0 -n shop --wait", "helm history web -n shop", "kubectl -n shop get pods"],
    explain: "<p>Helm has no server: its only memory is the revision records stored as Secrets. A revision is written as <i>pending-…</i> first and updated when the operation ends. If the process is killed in between, the record stays pending forever and blocks the next operation. <code>helm rollback</code> to a good revision marks the stuck one as failed and re-applies the known-good manifest. The first failure had a different cause: chart 1.2.0 ships an image that crashes at startup, and only <code>--wait</code> made Helm notice. <code>--wait</code> combined with <code>--rollback-on-failure</code> (called <code>--atomic</code> before Helm 4) keeps a bad release from lingering.</p>"
  });

  lab("a-first", {
    lesson: 23, tech: "argocd", level: 3, title: "Your first Argo CD Application",
    story: "<p>The team keeps the shop's manifests in git: <code>" + GIT + "</code>. Argo CD is installed in the namespace <code>argocd</code>, and your <code>argocd</code> CLI is already logged in. Tell Argo CD to deploy what is in the repository.</p>",
    tasks: [
      { text: "Clone the repository and look at what it contains.", hint: "<code>git clone " + GIT + "</code>, <code>ls gitops/apps gitops/apps/web</code>, <code>cat gitops/apps/web/deployment.yaml</code>", check: function (sim, h) { return h.ran(/^git clone/); }, sticky: true },
      { text: "Create an Application named <code>shop</code> that deploys the directory <code>apps</code> (with its subdirectories) into the namespace <code>shop</code> of this cluster.", hint: "<code>argocd app create shop --repo " + GIT + " --path apps --directory-recurse --dest-server https://kubernetes.default.svc --dest-namespace shop --sync-option CreateNamespace=true</code>", check: function (sim, h) { return !!h.get("Application", "argocd", "shop"); } },
      { text: "Look at the application before syncing: what do <b>OutOfSync</b> and <b>Missing</b> mean?", hint: "<code>argocd app get shop</code>", check: function (sim, h) { return h.ran(/^argocd app (get|list)/); }, sticky: true },
      { text: "Synchronise it and wait until it is <b>Synced</b> and <b>Healthy</b>. The shop must answer inside the cluster.", hint: "<code>argocd app sync shop</code>, then <code>argocd app wait shop --health</code>, <code>kubectl -n shop get pods</code>", check: function (sim, h) { return h.appOk("shop") && h.shopOk("shop"); } }
    ],
    solution: ["git clone " + GIT, "ls gitops/apps gitops/apps/web", "argocd app create shop --repo " + GIT + " --path apps --directory-recurse --dest-server https://kubernetes.default.svc --dest-namespace shop --sync-option CreateNamespace=true", "argocd app get shop", "argocd app sync shop", "argocd app wait shop --health", "kubectl -n shop get pods", "kubectl -n argocd get applications"],
    explain: "<p>An Application is a pointer with two ends: a <b>source</b> (repository, revision, path) and a <b>destination</b> (cluster, namespace). Argo CD continuously compares the manifests in git with the live objects. <b>Sync status</b> answers \"does the cluster match git?\"; <b>health</b> answers \"are the resources actually working?\". They are independent: right after a sync the app is Synced but still Progressing until the pods are ready. The Application itself is just a Kubernetes object in the <code>argocd</code> namespace, which is why <code>kubectl get applications</code> shows it.</p>"
  });

  lab("a-gitops", {
    lesson: 24, tech: "argocd", level: 3, title: "Change production with a commit",
    story: "<p>The Application <code>shop</code> now has an automated sync policy with pruning and self-healing. From here on nobody changes the cluster by hand: the way to production is a git commit.</p>",
    setup: function (sim, h) { h.K.create(application("shop", { path: "apps", directory: { recurse: true } }, { prune: true, selfHeal: true })); h.settle(80); },
    tasks: [
      { text: "Clone the repository, change the web Deployment to 3 replicas, commit and push.", hint: "<code>git clone " + GIT + "</code>, <code>cd gitops</code>, <code>sed -i 's/replicas: 2/replicas: 3/' apps/web/deployment.yaml</code>, <code>git add .</code>, <code>git commit -m \"web: 3 replicas\"</code>, <code>git push</code>", check: function (sim, h) { if (/replicas: 3/.test(headFile(sim, "apps/web/deployment.yaml"))) h.flags.pushed = 1; return !!h.flags.pushed; } },
      { text: "Watch Argo CD notice the commit and apply it. (It polls git every few minutes; a refresh makes it look now.)", hint: "<code>argocd app get shop --refresh</code>, then <code>kubectl -n shop get deployment web</code>", check: function (sim, h) { if (h.flags.pushed && h.deployReady("shop", "web", 3)) h.flags.three = 1; return !!h.flags.three; } },
      { text: "Now cause drift: scale the Deployment to 1 with kubectl and watch what Argo CD does about it.", hint: "<code>kubectl -n shop scale deployment web --replicas=1</code>, wait ten seconds, <code>kubectl -n shop get deployment web</code>", check: function (sim, h) { var d = h.get("Deployment", "shop", "web"); if (h.flags.three && d && d.spec.replicas === 1) h.flags.drift = 1; return !!h.flags.drift && !!d && d.spec.replicas !== 1 && h.deployReady("shop", "web"); } },
      { text: "Roll the change back the GitOps way: revert the commit and push. The Deployment returns to 2 replicas.", hint: "<code>git revert HEAD --no-edit</code>, <code>git push</code>, <code>argocd app get shop --refresh</code>", check: function (sim, h) { return !!h.flags.drift && /replicas: 2/.test(headFile(sim, "apps/web/deployment.yaml")) && h.deployReady("shop", "web", 2) && h.appOk("shop"); } }
    ],
    solution: ["git clone " + GIT, "cd gitops", "sed -i 's/replicas: 2/replicas: 3/' apps/web/deployment.yaml", "git diff", "git add .", "git commit -m \"web: 3 replicas\"", "git push", "argocd app get shop --refresh", "sleep 10", "kubectl -n shop get deployment web", "kubectl -n shop scale deployment web --replicas=1", "sleep 10", "kubectl -n shop get deployment web", "git revert HEAD --no-edit", "git push", "argocd app get shop --refresh", "sleep 10", "kubectl -n shop get deployment web", "argocd app history shop"],
    explain: "<p>With automated sync, git is the only input: a new commit is detected and applied, and with <b>self-heal</b> a manual change to a managed resource is detected and reverted within seconds. That makes the repository's history your deployment history, with authors, reviews and messages, and it makes a rollback an ordinary <code>git revert</code>. It also changes how you fix incidents: a <code>kubectl</code> hot-fix on a self-healing application simply disappears, so the fix has to go through git.</p>"
  });

  lab("a-fix-drift", {
    lesson: 24, tech: "argocd", level: 3, fix: true, title: "OutOfSync: who changed production?",
    story: "<p>The Application <code>shop</code> is on <b>manual</b> sync. This morning it shows <b>OutOfSync</b>, and one web pod is crash-looping, although nobody merged anything. Find out what differs between git and the cluster, restore the declared state, and make sure this can't happen silently again.</p>",
    setup: function (sim, h) {
      var app = h.K.create(application("shop", { path: "apps", directory: { recurse: true } }, null));
      h.settle(5); S.argo.sync(sim, app, {}); h.settle(60);
      var d = h.get("Deployment", "shop", "web"); d.spec.template.spec.containers[0].image = "shop/web:1.2"; d.metadata.generation++; h.settle(120);
    },
    tasks: [
      { text: "List the applications and inspect the one that is out of sync.", hint: "<code>argocd app list</code>, <code>argocd app get shop</code>: the resource table shows which object is OutOfSync.", check: function (sim, h) { return h.ran(/^argocd app (get|list)/); }, sticky: true },
      { text: "Show exactly what differs between the live object and git.", hint: "<code>argocd app diff shop</code>: lines starting with <code>&lt;</code> are the live cluster, <code>&gt;</code> is git.", check: function (sim, h) { return h.ran(/^argocd app diff/); }, sticky: true },
      { text: "Bring the cluster back to the state declared in git.", hint: "<code>argocd app sync shop</code>, <code>argocd app wait shop --health</code>", check: function (sim, h) { return h.appOk("shop") && h.image0("shop", "web") === "shop/web:1.0"; } },
      { text: "Turn on automated sync with self-healing so that manual changes are reverted automatically.", hint: "<code>argocd app set shop --sync-policy automated --self-heal</code>", check: function (sim, h) { var a = h.get("Application", "argocd", "shop"), p = a && (a.spec.syncPolicy || {}).automated; return !!p && !!p.selfHeal && h.appOk("shop"); } }
    ],
    diagnose: { q: "What caused the OutOfSync status?", options: ["A new commit in git that was not applied", "Someone changed the live Deployment's image with kubectl; git still says 1.0", "Argo CD lost its connection to the repository", "The namespace was deleted"], answer: 1, why: "The diff shows the live image <code>shop/web:1.2</code> against <code>shop/web:1.0</code> in git, and the application's revision has not changed." },
    solution: ["argocd app list", "argocd app get shop", "argocd app diff shop", "kubectl -n shop get pods", "argocd app sync shop", "argocd app wait shop --health", "argocd app set shop --sync-policy automated --self-heal", "argocd app get shop"],
    explain: "<p><b>OutOfSync</b> has two possible directions: git moved (a commit not yet applied) or the cluster moved (drift). <code>argocd app diff</code> tells you which, field by field. Here somebody tested an image straight on the cluster, and the test image crashes. Syncing re-applies git, which removes the experiment. On manual sync Argo CD only <em>reports</em> drift; with <code>selfHeal</code> it corrects it, which turns \"please don't kubectl in production\" from a rule people forget into something the system enforces.</p>"
  });

  lab("a-fix-badcommit", {
    lesson: 25, tech: "argocd", level: 4, fix: true, title: "The hot-fix that keeps disappearing",
    story: "<p>The Application <code>shop</code> (automated sync, self-heal) is <b>Synced</b> but stuck in <b>Progressing</b>, and a new <code>api</code> pod is in <i>ImagePullBackOff</i>. A colleague already tried <code>kubectl -n shop set image deployment/api api=shop/api:1.0</code> twice; each time the bad image was back a few seconds later.</p>",
    setup: function (sim, h) {
      h.K.create(application("shop", { path: "apps", directory: { recurse: true } }, { prune: true, selfHeal: true })); h.settle(80);
      G.seed(sim, GIT, { "apps/api/deployment.yaml": headFile(sim, "apps/api/deployment.yaml").replace("shop/api:1.0", "shop/api:1.9") }, "api: bump image to 1.9", { patch: true, author: "Dana Dev <dana@shop.example>" }); h.settle(150);
    },
    tasks: [
      { text: "Confirm the symptom and find the image the pod is trying to pull.", hint: "<code>argocd app get shop</code>, <code>kubectl -n shop get pods</code>, <code>kubectl -n shop describe pod -l app=api | tail</code>", check: function (sim, h) { return h.ran(/^argocd app get/) || h.ran(/^(kubectl|k) .*(describe|get) /); }, sticky: true },
      { text: "Find where that image tag comes from.", hint: "Argo CD applies what git says: <code>git clone " + GIT + "</code>, <code>cd gitops</code>, <code>git log --oneline</code>. Or <code>argocd app history shop</code> to see which revision was deployed when.", check: function (sim, h) { return h.ran(/^git log|^argocd app history|^git show|^cat .*deployment/); }, sticky: true },
      { text: "Fix it at the source: get a working image tag back into git.", hint: "<code>git revert HEAD --no-edit</code> then <code>git push</code> (or edit the file, commit and push).", check: function (sim, h) { var m = /image: (\S+)/.exec(headFile(sim, "apps/api/deployment.yaml")); return !!m && !!S.catalogImage(m[1]); } },
      { text: "Let Argo CD deploy the fix and confirm the application is Synced and Healthy and the shop works.", hint: "<code>argocd app get shop --refresh</code>, <code>argocd app wait shop --health</code>", check: function (sim, h) { return h.appOk("shop") && h.shopOk("shop"); } }
    ],
    diagnose: { q: "Why does the kubectl fix not stick?", options: ["kubectl has no permission", "Self-heal: Argo CD sees that the live image differs from git and re-applies git, and git contains the bad tag", "The Deployment is immutable", "The node cache holds the old image"], answer: 1, why: "The application is <b>Synced</b>: the cluster matches git exactly. The mistake is <em>in git</em>, so the cluster is faithfully wrong." },
    solution: ["argocd app get shop", "kubectl -n shop get pods", "kubectl -n shop describe pod -l app=api | tail -8", "git clone " + GIT, "cd gitops", "git log --oneline", "git revert HEAD --no-edit", "git push", "argocd app get shop --refresh", "argocd app wait shop --health", "kubectl -n shop get pods"],
    explain: "<p><b>Synced + not Healthy</b> is the signature of a bad commit: Argo CD did its job perfectly and deployed something that does not work. In that state every manual correction is drift, and self-heal removes it. The repair has to be a commit, and <code>git revert</code> is the safest one because it restores a state that is known to have worked and leaves a record of what happened. Notice also that customers were never affected: the rolling update kept the old API pod serving while the new one failed to pull its image.</p>"
  });

  lab("a-fix-comparison", {
    lesson: 25, tech: "argocd", level: 3, fix: true, title: "ComparisonError",
    story: "<p>A new Application <code>web</code> was created yesterday. It has never deployed anything. <code>argocd app list</code> shows its sync status as <b>Unknown</b> with a <b>ComparisonError</b> condition. Get it deployed.</p>",
    setup: function (sim, h) { var a = application("web", { path: "apps/frontend" }, null, "storefront"); a.spec.syncPolicy = {}; h.K.create(a); h.settle(60); },
    tasks: [
      { text: "Read the application's condition message.", hint: "<code>argocd app get web</code>: the CONDITION table has the full error.", check: function (sim, h) { return h.ran(/^argocd app get/); }, sticky: true },
      { text: "Compare the application's path with the directories that exist in the repository, and correct the path.", hint: "<code>git clone " + GIT + "</code>, <code>ls gitops/apps</code>. Fix: <code>argocd app set web --path apps/web</code>", check: function (sim, h) { var s = h.app("web"); return !!s && (s.sync || {}).status && s.sync.status !== "Unknown"; } },
      { text: "Sync the application. If the sync itself fails, read its message and fix that too, until the app is Synced and Healthy.", hint: "The sync fails with <i>namespaces \"storefront\" not found</i>. Either create the namespace or let Argo CD do it: <code>argocd app set web --sync-option CreateNamespace=true</code>, then <code>argocd app sync web</code>.", check: function (sim, h) { return h.appOk("web"); } }
    ],
    diagnose: { q: "What does a ComparisonError tell you?", options: ["The cluster rejected a manifest", "Argo CD could not even produce the desired manifests (bad repo, revision, path, or a rendering failure), so it has nothing to compare the cluster with", "The pods are unhealthy", "The application was deleted"], answer: 1, why: "The message ends with <i>apps/frontend: app path does not exist</i>. The failure is on the source side, before the cluster is involved at all." },
    solution: ["argocd app list", "argocd app get web", "git clone " + GIT, "ls gitops/apps", "argocd app set web --path apps/web", "argocd app get web", "argocd app sync web", "argocd app set web --sync-option CreateNamespace=true", "argocd app sync web", "argocd app wait web --health", "argocd app get web"],
    explain: "<p>Argo CD's work has stages, and each failure names its stage. <b>ComparisonError</b>: it could not build the target manifests (repository unreachable, revision missing, path wrong, Helm or YAML failing to render). <b>Sync failed</b>: the manifests were built, but applying them was rejected (here: the destination namespace did not exist). <b>Degraded / Progressing</b>: everything was applied, and the workload itself is not healthy. Identify the stage first and you know whether to look at git, at the Application's settings, or at the pods.</p>"
  });

  function capstoneRepo() {
    var files = { "README.md": "# shop gitops\n\n- charts/web      Helm chart of the front end\n- envs/prod       values per environment\n- apps/api        API manifests\n- apps/db         database manifests\n" };
    var chart = S.helm.catalog[REPO].web[3].files;
    Object.keys(chart).forEach(function (f) { files["charts/web/" + f] = chart[f]; });
    files["envs/prod/web-values.yaml"] = "replicaCount: 2\n\nenv:\n  API_URL: http://api:3000\n\ningress:\n  enabled: true\n  className: traefik\n  host: shop.local\n";
    var s = S.shop(), svc = JSON.parse(JSON.stringify(s.apiSvc)); svc.spec.ports[0].targetPort = 8080;
    files["apps/api/deployment.yaml"] = S.yamlDump(s.api); files["apps/api/service.yaml"] = S.yamlDump(svc);
    files["apps/db/deployment.yaml"] = S.yamlDump(s.db); files["apps/db/service.yaml"] = S.yamlDump(s.dbSvc);
    return files;
  }
  lab("a-capstone", {
    lesson: 25, tech: "mixed", level: 5, fix: true, title: "Capstone: launch day",
    story: "<p>It is launch day. The shop is deployed by three Argo CD Applications (all automated, self-healing) from <code>" + GIT + "</code>: <code>web</code> (a Helm chart with per-environment values), <code>api</code> and <code>db</code> (plain manifests). The platform team restructured the repository last night. This morning <code>curl http://shop.local/</code> does not show the shop.</p><p>There are <b>three</b> independent faults, in three different layers. Work through the applications one by one, and remember what self-healing means for where a fix has to go. Database credentials are deliberately not stored in git: the API expects the user <code>shop</code> with the password <code>secret</code>.</p>",
    setup: function (sim, h) {
      G.seed(sim, GIT, capstoneRepo(), "Restructure: chart for web, values per environment", { author: "Platform Team <platform@shop.example>" });
      var auto = { prune: true, selfHeal: true };
      h.K.create(application("db", { path: "apps/db" }, auto)); h.K.create(application("api", { path: "apps/api" }, auto));
      h.K.create(application("web", { path: "charts/web", helm: { valueFiles: ["../../envs/production/web-values.yaml"] } }, auto));
      h.settle(150);
    },
    tasks: [
      { text: "Get an overview of the three applications.", hint: "<code>argocd app list</code>: note the STATUS, HEALTH and CONDITIONS of each.", check: function (sim, h) { return h.ran(/^argocd app (list|get)/); }, sticky: true },
      { text: "<b>web</b> has a ComparisonError and has deployed nothing. Fix the Application so that it renders.", hint: "<code>argocd app get web</code> names a values file that can't be opened. <code>git clone " + GIT + "</code> and <code>ls gitops/envs</code> show the real directory name. Fix: <code>argocd app set web --values ../../envs/prod/web-values.yaml</code>", check: function (sim, h) { var s = h.app("web"); return !!s && (s.sync || {}).status === "Synced"; } },
      { text: "<b>db</b> is Synced but not Healthy. Find out why its pod does not start and provide what is missing.", hint: "<code>kubectl -n shop describe pod -l app=db | tail</code> shows <i>secret \"db-auth\" not found</i>. Secrets are not in git here, so create it: <code>kubectl -n shop create secret generic db-auth --from-literal=password=secret</code>", check: function (sim, h) { return h.deployReady("shop", "db"); } },
      { text: "The front end now answers but reports the API as refusing connections, although the api pod is ready. Find the faulty object and fix it where the fix will last.", hint: "<code>kubectl -n shop get endpoints api</code> lists port 8080; the API listens on 3000. A <code>kubectl patch</code> would be reverted by self-heal, so fix <code>apps/api/service.yaml</code> in git: <code>sed -i 's/targetPort: 8080/targetPort: 3000/' apps/api/service.yaml</code>, commit, push, <code>argocd app get api --refresh</code>.", check: function (sim, h) { return /targetPort: 3000/.test(headFile(sim, "apps/api/service.yaml")); } },
      { text: "Done when <code>curl http://shop.local/</code> lists the products and all three applications are Synced and Healthy.", check: function (sim, h) { return h.ok("http://shop.local/", "Keyboard") && h.appOk("web") && h.appOk("api") && h.appOk("db"); } }
    ],
    solution: ["argocd app list", "argocd app get web", "git clone " + GIT, "ls gitops gitops/envs", "argocd app set web --values ../../envs/prod/web-values.yaml", "argocd app get web --refresh", "kubectl -n shop get pods", "kubectl -n shop describe pod -l app=db | tail -6", "kubectl -n shop create secret generic db-auth --from-literal=password=secret", "sleep 20", "curl http://shop.local/", "kubectl -n shop get endpoints", "cd gitops", "sed -i 's/targetPort: 8080/targetPort: 3000/' apps/api/service.yaml", "git commit -am \"api: service targets port 3000\"", "git push", "argocd app get api --refresh", "sleep 15", "curl http://shop.local/", "argocd app list"],
    explain: "<p>Three faults, three layers, three kinds of fix. The <b>web</b> application failed at <em>manifest generation</em> (a values file path that no longer exists after the restructuring), so the fix was in the Application's own settings. The <b>db</b> application was Synced but <em>unhealthy at runtime</em>: its pod referenced a Secret that is intentionally kept out of git, so the fix was to create that Secret in the cluster. The <b>api</b> Service had a wrong <code>targetPort</code> <em>declared in git</em>; with self-heal on, the only fix that lasts is a commit. At each step the method was the one you have used all course long: read the status, read the message, identify the layer, change one thing, test again.</p>"
  });
})(typeof window !== "undefined" ? window : globalThis);
