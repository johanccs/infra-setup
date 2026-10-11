/* infra-sim — a small git simulation plus Argo CD (application controller + `argocd` CLI, modelled on Argo CD v3). */
(function (g) {
  "use strict";
  var S = g.InfraSim, U = S.util, CmdError = S.CmdError, K8 = S.k8s;
  function fatal(msg, code) { return new CmdError("FATA[0000] " + msg, code == null ? 20 : code); }
  function gerr(msg, code) { return new CmdError(msg, code == null ? 1 : code); }

  /* ====================== git ====================== */
  var G = S.git = {};
  G.DEFAULT_URL = "https://git.shop.example/shop/gitops.git";
  function norm(url) { return String(url || "").replace(/\/$/, "").replace(/\.git$/, ""); }
  G.remote = function (sim, url) { return sim.git.remotes[norm(url)] || null; };
  /* Add a commit to a remote (used to seed labs). files: full snapshot or patch when opts.patch is true. */
  G.seed = function (sim, url, files, message, opts) {
    opts = opts || {};
    var key = norm(url), r = sim.git.remotes[key] = sim.git.remotes[key] || { url: url, branches: {}, head: "main", "private": false, creds: null };
    if (opts["private"]) { r["private"] = true; r.creds = opts.creds || { username: "git", password: "token" }; }
    var br = opts.branch || "main", list = r.branches[br] = r.branches[br] || (opts.from && r.branches[opts.from] ? r.branches[opts.from].slice() : []), prev = list.length ? list[list.length - 1].files : {};
    var snap = opts.patch ? Object.assign({}, prev) : {};
    Object.keys(files).forEach(function (p) { if (files[p] === null) delete snap[p]; else snap[p] = files[p]; });
    var c = { sha: S.hex(key + br + list.length + message + JSON.stringify(snap), 40), message: message || "update", author: opts.author || "Platform Team <platform@shop.example>", time: opts.time != null ? opts.time : sim.now, files: snap };
    list.push(c);
    return c;
  };
  G.resolve = function (remote, rev) {   // -> commit or null
    rev = rev || "HEAD";
    if (rev === "HEAD") rev = remote.head;
    if (remote.branches[rev]) { var l = remote.branches[rev]; return l[l.length - 1] || null; }
    var hit = null;
    Object.keys(remote.branches).forEach(function (b) { remote.branches[b].forEach(function (c) { if (rev.length >= 7 && c.sha.indexOf(rev) === 0) hit = c; }); });
    return hit;
  };
  S.inits.push(function (sim) {
    sim.git = { remotes: {}, clones: {} };
    G.seed(sim, G.DEFAULT_URL, G.defaultRepo(), "Initial shop manifests", { time: -3 * 86400000 });
  });
  function manifest(objs) { return objs.map(function (o) { return S.yamlDump(o); }).join("---\n"); }
  G.deployment = function (name, image, replicas, port, env, extra) {
    var c = { name: name, image: image, ports: [{ containerPort: port }] };
    if (env && Object.keys(env).length) c.env = Object.keys(env).map(function (k) { return { name: k, value: String(env[k]) }; });
    Object.assign(c, extra || {});
    return { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: name, labels: { app: name } }, spec: { replicas: replicas, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers: [c] } } } };
  };
  G.service = function (name, port, target) { return { apiVersion: "v1", kind: "Service", metadata: { name: name, labels: { app: name } }, spec: { selector: { app: name }, ports: [{ port: port, targetPort: target }] } }; };
  G.defaultRepo = function () {
    return {
      "README.md": "# shop gitops\n\nKubernetes manifests for the shop. Argo CD deploys whatever is on the main branch.\n\n- apps/web  the web front end\n- apps/api  the REST API\n- apps/db   PostgreSQL\n",
      "apps/web/deployment.yaml": S.yamlDump(G.deployment("web", "shop/web:1.0", 2, 8080, { API_URL: "http://api:3000" }, { readinessProbe: { httpGet: { path: "/healthz", port: 8080 } } })),
      "apps/web/service.yaml": S.yamlDump(G.service("web", 80, 8080)),
      "apps/api/deployment.yaml": S.yamlDump(G.deployment("api", "shop/api:1.0", 1, 3000, { DATABASE_URL: "postgres://shop:secret@db:5432/shop" }, { readinessProbe: { httpGet: { path: "/healthz", port: 3000 } } })),
      "apps/api/service.yaml": S.yamlDump(G.service("api", 3000, 3000)),
      "apps/db/deployment.yaml": S.yamlDump(G.deployment("db", "postgres:17", 1, 5432, { POSTGRES_USER: "shop", POSTGRES_PASSWORD: "secret", POSTGRES_DB: "shop" })),
      "apps/db/service.yaml": S.yamlDump(G.service("db", 5432, 5432))
    };
  };

  function cloneAt(sim, sc) {
    var best = null;
    Object.keys(sim.git.clones).forEach(function (dir) { if ((sc.cwd === dir || sc.cwd.indexOf(dir + "/") === 0) && (!best || dir.length > best.length)) best = dir; });
    if (!best || !sim.fs.isDir(best)) throw gerr("fatal: not a git repository (or any of the parent directories): .git", 128);
    return sim.git.clones[best];
  }
  function tree(sim, cl) { var o = {}; S.docker.walk(sim.fs, cl.dir).forEach(function (e) { o[e[0]] = e[1]; }); return o; }
  function headFiles(cl) { return cl.commits.length ? cl.commits[cl.commits.length - 1].files : {}; }
  function changes(sim, cl) {
    var head = headFiles(cl), work = tree(sim, cl), staged = [], unstaged = [], untracked = [];
    Object.keys(cl.index).forEach(function (p) { var v = cl.index[p]; if (v === null ? head[p] != null : head[p] !== v) staged.push([p, v === null ? "deleted" : head[p] == null ? "new file" : "modified"]); });
    Object.keys(Object.assign({}, head, work, cl.index)).sort().forEach(function (p) {
      var base = Object.prototype.hasOwnProperty.call(cl.index, p) ? cl.index[p] : (head[p] == null ? null : head[p]);
      if (work[p] == null) { if (base != null) unstaged.push([p, "deleted"]); }
      else if (base == null) { if (!Object.prototype.hasOwnProperty.call(cl.index, p) || cl.index[p] === null) untracked.push(p); else if (work[p] !== cl.index[p]) unstaged.push([p, "modified"]); }
      else if (work[p] !== base) unstaged.push([p, "modified"]);
    });
    return { staged: staged, unstaged: unstaged, untracked: untracked };
  }
  function short(sha) { return sha.slice(0, 7); }
  var git = {};
  git.clone = async function (a, io, sim, sc) {
    var f = U.flags(a, { str: "b branch depth o origin", bool: "q quiet", alias: { b: "branch" } });
    if (!f._.length) throw gerr("fatal: You must specify a repository to clone.", 129);
    var r = G.remote(sim, f._[0]), name = f._[1] || U.basename(norm(f._[0])), dir = U.norm(name, sc.cwd);
    if (sim.fs.exists(dir) && sim.fs.list(dir).length) throw gerr("fatal: destination path '" + name + "' already exists and is not an empty directory.", 128);
    io.err("Cloning into '" + name + "'...\n");
    await sim.wait(1000);
    if (!r) throw gerr("fatal: unable to access '" + f._[0] + "': Could not resolve host: " + norm(f._[0]).replace(/^\w+:\/\//, "").split("/")[0] + "\n(the sandbox has no internet access; the course repository is " + G.DEFAULT_URL + ")", 128);
    if (r["private"] && !sim.git.authed) throw gerr("fatal: could not read Username for '" + norm(f._[0]).split("/").slice(0, 3).join("/") + "': terminal prompts disabled", 128);
    var br = f.branch || r.head;
    if (!r.branches[br]) throw gerr("fatal: Remote branch " + br + " not found in upstream origin", 128);
    sim.fs.mkdirp(dir);
    var commits = r.branches[br].slice(), files = commits.length ? commits[commits.length - 1].files : {};
    Object.keys(files).forEach(function (p) { sim.fs.write(dir + "/" + p, files[p]); });
    sim.git.clones[dir] = { dir: dir, url: f._[0], branch: br, commits: commits, index: {}, local: {} };
    var n = Object.keys(files).length;
    io.err("remote: Enumerating objects: " + (n * 3) + ", done.\nremote: Total " + (n * 3) + " (delta 0), reused 0 (delta 0)\nReceiving objects: 100% (" + (n * 3) + "/" + (n * 3) + "), done.\n");
  };
  git.status = function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), ch = changes(sim, cl), r = G.remote(sim, cl.url), remoteList = (r && r.branches[cl.branch]) || [], L = ["On branch " + cl.branch];
    var ahead = cl.commits.filter(function (c) { return !remoteList.some(function (x) { return x.sha === c.sha; }); }).length, behind = remoteList.filter(function (c) { return !cl.commits.some(function (x) { return x.sha === c.sha; }); }).length;
    if (a.indexOf("-s") >= 0 || a.indexOf("--short") >= 0) { ch.staged.forEach(function (x) { L.push((x[1] === "new file" ? "A " : x[1] === "deleted" ? "D " : "M ") + " " + x[0]); }); ch.unstaged.forEach(function (x) { L.push(" " + (x[1] === "deleted" ? "D" : "M") + " " + x[0]); }); ch.untracked.forEach(function (x) { L.push("?? " + x); }); io.out(L.slice(1).join("\n") + (L.length > 1 ? "\n" : "")); return; }
    if (!remoteList.length && !r.branches[cl.branch]) { /* a local-only branch */ }
    else if (ahead && behind) L.push("Your branch and 'origin/" + cl.branch + "' have diverged,\nand have " + ahead + " and " + behind + " different commits each, respectively.");
    else if (ahead) L.push("Your branch is ahead of 'origin/" + cl.branch + "' by " + ahead + " commit" + (ahead > 1 ? "s" : "") + ".\n  (use \"git push\" to publish your local commits)");
    else if (behind && cl.fetched) L.push("Your branch is behind 'origin/" + cl.branch + "' by " + behind + " commit" + (behind > 1 ? "s" : "") + ", and can be fast-forwarded.\n  (use \"git pull\" to update your local branch)");
    else L.push("Your branch is up to date with 'origin/" + cl.branch + "'.");
    L.push("");
    if (ch.staged.length) { L.push("Changes to be committed:", "  (use \"git restore --staged <file>...\" to unstage)"); ch.staged.forEach(function (x) { L.push("\t" + (x[1] + ":").padEnd(12) + x[0]); }); L.push(""); }
    if (ch.unstaged.length) { L.push("Changes not staged for commit:", "  (use \"git add <file>...\" to update what will be committed)", "  (use \"git restore <file>...\" to discard changes in working directory)"); ch.unstaged.forEach(function (x) { L.push("\t" + (x[1] + ":").padEnd(12) + x[0]); }); L.push(""); }
    if (ch.untracked.length) { L.push("Untracked files:", "  (use \"git add <file>...\" to include in what will be committed)"); ch.untracked.forEach(function (x) { L.push("\t" + x); }); L.push(""); }
    if (!ch.staged.length && !ch.unstaged.length && !ch.untracked.length) L.push("nothing to commit, working tree clean");
    else if (!ch.staged.length) L.push(ch.unstaged.length ? "no changes added to commit (use \"git add\" and/or \"git commit -a\")" : "nothing added to commit but untracked files present (use \"git add\" to track)");
    io.out(L.join("\n") + "\n");
  };
  function stage(sim, cl, sc, paths, all) {
    var work = tree(sim, cl), head = headFiles(cl);
    var rel = function (p) { var abs = U.norm(p, sc.cwd); if (abs !== cl.dir && abs.indexOf(cl.dir + "/") !== 0) throw gerr("fatal: " + p + ": '" + p + "' is outside repository at '" + cl.dir + "'", 128); return abs === cl.dir ? "" : abs.slice(cl.dir.length + 1); };
    var prefixes = all ? [""] : paths.map(rel), matched = false;
    Object.keys(Object.assign({}, head, work, cl.index)).forEach(function (p) {
      if (!prefixes.some(function (pre) { return pre === "" || p === pre || p.indexOf(pre + "/") === 0; })) return;
      matched = true;
      cl.index[p] = work[p] == null ? null : work[p];
    });
    if (!matched && !all) throw gerr("fatal: pathspec '" + paths[0] + "' did not match any files", 128);
  }
  git.add = function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), f = U.flags(a, { bool: "A all u update v f" });
    if (!f._.length && !f.A && !f.all && !f.u) { io.err("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\n"); return 0; }
    stage(sim, cl, sc, f._, f.A || f.all || f.u);
  };
  git.commit = function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), f = U.flags(a, { str: "author", multi: "m message", bool: "a all amend no-edit allow-empty q", alias: { m: "message", a: "all" } });
    if (f.all) { var head0 = headFiles(cl), work0 = tree(sim, cl); Object.keys(head0).forEach(function (p) { cl.index[p] = work0[p] == null ? null : work0[p]; }); Object.keys(cl.index).forEach(function (p) { if (cl.index[p] !== null && work0[p] != null) cl.index[p] = work0[p]; }); }
    var ch = changes(sim, cl);
    if (!ch.staged.length && !f["allow-empty"]) {
      io.out("On branch " + cl.branch + "\n" + (ch.unstaged.length ? "Changes not staged for commit:\n" + ch.unstaged.map(function (x) { return "\t" + (x[1] + ":").padEnd(12) + x[0]; }).join("\n") + "\n\nno changes added to commit (use \"git add\" and/or \"git commit -a\")\n" : ch.untracked.length ? "Untracked files:\n" + ch.untracked.map(function (x) { return "\t" + x; }).join("\n") + "\n\nnothing added to commit but untracked files present (use \"git add\" to track)\n" : "nothing to commit, working tree clean\n"));
      return 1;
    }
    if (!f.message) throw gerr("error: the sandbox has no commit-message editor; pass the message with -m \"...\"", 1);
    var snap = Object.assign({}, headFiles(cl));
    Object.keys(cl.index).forEach(function (p) { if (cl.index[p] === null) delete snap[p]; else snap[p] = cl.index[p]; });
    var msg = f.message.join("\n\n"), c = { sha: S.hex(cl.dir + cl.commits.length + msg + JSON.stringify(snap) + sim.now, 40), message: msg, author: "learner <learner@sandbox.local>", time: sim.now, files: snap };
    cl.commits.push(c); cl.index = {};
    io.out("[" + cl.branch + " " + short(c.sha) + "] " + msg.split("\n")[0] + "\n " + ch.staged.length + " file" + (ch.staged.length === 1 ? "" : "s") + " changed\n");
  };
  git.push = async function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), f = U.flags(a, { bool: "u set-upstream f force force-with-lease tags q" }), r = G.remote(sim, cl.url), br = f._[1] || cl.branch;
    await sim.wait(1000);
    if (r["private"] && !sim.git.authed) throw gerr("remote: Permission to " + norm(cl.url).split("/").slice(3).join("/") + ".git denied.\nfatal: unable to access '" + cl.url + "': The requested URL returned error: 403", 128);
    var list = r.branches[br] = r.branches[br] || [], last = list[list.length - 1];
    if (last && !cl.commits.some(function (c) { return c.sha === last.sha; }) && !f.f && !f.force) throw gerr("To " + cl.url + "\n ! [rejected]        " + br + " -> " + br + " (fetch first)\nerror: failed to push some refs to '" + cl.url + "'\nhint: Updates were rejected because the remote contains work that you do not\nhint: have locally. Integrate the remote changes (e.g. 'git pull ...') before pushing again.", 1);
    if (last && cl.commits[cl.commits.length - 1].sha === last.sha) { io.err("Everything up-to-date\n"); return 0; }
    var from = last ? short(last.sha) : null, to = cl.commits[cl.commits.length - 1];
    r.branches[br] = cl.commits.slice();
    io.err("Enumerating objects: 5, done.\nWriting objects: 100% (3/3), done.\nTo " + cl.url + "\n" + (from ? "   " + from + ".." + short(to.sha) + "  " + br + " -> " + br : " * [new branch]      " + br + " -> " + br) + "\n" + (f.u || f["set-upstream"] ? "branch '" + br + "' set up to track 'origin/" + br + "'.\n" : ""));
    sim.git.pushedAt = sim.now;
  };
  git.pull = git.fetch = async function (a, io, sim, sc, name) {
    var cl = cloneAt(sim, sc), r = G.remote(sim, cl.url), list = r.branches[cl.branch] || [];
    await sim.wait(1000);
    cl.fetched = true;
    if (name === "fetch") return 0;
    var last = list[list.length - 1], mine = cl.commits[cl.commits.length - 1];
    if (!last || (mine && last.sha === mine.sha) || cl.commits.some(function (c) { return c.sha === last.sha; })) { io.out("Already up to date.\n"); return 0; }
    if (mine && !list.some(function (c) { return c.sha === mine.sha; })) throw gerr("hint: You have divergent branches and need to specify how to reconcile them.\nfatal: Need to specify how to reconcile divergent branches.\n(sandbox) merging is not simulated: `git reset --hard origin/" + cl.branch + "` discards your local commits.", 128);
    var ch = changes(sim, cl);
    if (ch.unstaged.length || ch.staged.length) throw gerr("error: Your local changes to the following files would be overwritten by merge:\n\t" + ch.unstaged.concat(ch.staged).map(function (x) { return x[0]; }).join("\n\t") + "\nPlease commit your changes or stash them before you merge.\nAborting", 1);
    var old = headFiles(cl);
    cl.commits = list.slice();
    Object.keys(old).forEach(function (p) { if (last.files[p] == null) sim.fs.rm(cl.dir + "/" + p); });
    Object.keys(last.files).forEach(function (p) { sim.fs.write(cl.dir + "/" + p, last.files[p]); });
    io.out("Updating " + (mine ? short(mine.sha) : "0000000") + ".." + short(last.sha) + "\nFast-forward\n");
  };
  git.log = function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), f = U.flags(a.map(function (x) { return /^-\d+$/.test(x) ? "-n" + x.slice(1) : x; }), { str: "n max-count format pretty", bool: "oneline graph decorate all stat" });
    var list = cl.commits.slice().reverse().slice(0, f.n ? +f.n : undefined), r = G.remote(sim, cl.url), rl = (r && r.branches[cl.branch]) || [], rhead = rl.length ? rl[rl.length - 1].sha : null;
    if (!list.length) throw gerr("fatal: your current branch '" + cl.branch + "' does not have any commits yet", 128);
    io.out(list.map(function (c, i) {
      var deco = (i === 0 ? ["HEAD -> " + cl.branch] : []).concat(c.sha === rhead ? ["origin/" + cl.branch] : []), d = deco.length ? " (" + deco.join(", ") + ")" : "";
      if (f.oneline) return short(c.sha) + d + " " + c.message.split("\n")[0];
      return "commit " + c.sha + d + "\nAuthor: " + c.author + "\nDate:   " + sim.date(c.time).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (\S+) GMT$/, "$1 $3 $2 $5 $4 +0000") + "\n\n    " + c.message.split("\n").join("\n    ") + "\n";
    }).join("\n") + "\n");
  };
  git.diff = function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), f = U.flags(a, { bool: "staged cached stat name-only" }), head = headFiles(cl), work = tree(sim, cl), out = "";
    var staged = f.staged || f.cached, base = function (p) { return staged ? head[p] : (Object.prototype.hasOwnProperty.call(cl.index, p) ? cl.index[p] : head[p]); }, cur = function (p) { return staged ? (Object.prototype.hasOwnProperty.call(cl.index, p) ? cl.index[p] : head[p]) : work[p]; };
    Object.keys(Object.assign({}, head, work, cl.index)).sort().forEach(function (p) {
      var x = base(p), y = cur(p);
      if (!staged && x == null) return;   // untracked files are not shown by git diff
      if (x === y || (x == null && y == null)) return;
      if (f._.length && !f._.some(function (q) { var rp = U.norm(q, sc.cwd).slice(cl.dir.length + 1); return p === rp || p.indexOf(rp + "/") === 0; })) return;
      if (f["name-only"]) { out += p + "\n"; return; }
      var d = S.kubectl.diffText("a/" + p, "b/" + p, (x || "").replace(/\n$/, ""), (y || "").replace(/\n$/, ""));
      out += "diff --git a/" + p + " b/" + p + "\n" + (x == null ? "new file mode 100644\n" : y == null ? "deleted file mode 100644\n" : "") + "index " + (x == null ? "0000000" : S.hex(x, 7)) + ".." + (y == null ? "0000000" : S.hex(y, 7)) + (x != null && y != null ? " 100644" : "") + "\n" + d.replace(/^--- a\/.*$/m, x == null ? "--- /dev/null" : "--- a/" + p).replace(/^\+\+\+ b\/.*$/m, y == null ? "+++ /dev/null" : "+++ b/" + p);
    });
    io.out(out);
  };
  git.restore = git.checkout = function (a, io, sim, sc, name) {
    var cl = cloneAt(sim, sc), f = U.flags(a, { bool: "staged b f q", str: "source" }), head = headFiles(cl);
    if (name === "checkout" && f.b) { cl.branch = f._[0]; io.err("Switched to a new branch '" + cl.branch + "'\n"); return 0; }
    if (name === "checkout" && f._.length === 1 && !sim.fs.exists(U.norm(f._[0], sc.cwd))) {
      var r = G.remote(sim, cl.url);
      if (!r.branches[f._[0]]) throw gerr("error: pathspec '" + f._[0] + "' did not match any file(s) known to git", 1);
      var ch = changes(sim, cl); if (ch.unstaged.length || ch.staged.length) throw gerr("error: Your local changes would be overwritten by checkout. Commit or restore them first.", 1);
      Object.keys(head).forEach(function (p) { sim.fs.rm(cl.dir + "/" + p); });
      cl.branch = f._[0]; cl.commits = r.branches[cl.branch].slice();
      var hf = headFiles(cl); Object.keys(hf).forEach(function (p) { sim.fs.write(cl.dir + "/" + p, hf[p]); });
      io.err("Switched to branch '" + cl.branch + "'\n"); return 0;
    }
    if (!f._.length) throw gerr("fatal: you must specify path(s) to restore", 128);
    f._.forEach(function (q) {
      var abs = U.norm(q, sc.cwd), rel = abs === cl.dir ? "" : abs.slice(cl.dir.length + 1), hit = false;
      Object.keys(Object.assign({}, head, cl.index)).forEach(function (p) {
        if (rel !== "" && p !== rel && p.indexOf(rel + "/") !== 0) return;
        hit = true;
        if (f.staged) { delete cl.index[p]; return; }
        var v = Object.prototype.hasOwnProperty.call(cl.index, p) ? cl.index[p] : head[p];
        if (v == null) sim.fs.rm(cl.dir + "/" + p); else sim.fs.write(cl.dir + "/" + p, v);
      });
      if (!hit) throw gerr("error: pathspec '" + q + "' did not match any file(s) known to git", 1);
    });
  };
  git.revert = function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), f = U.flags(a, { bool: "no-edit n" }), ref = f._[0] || "HEAD";
    var idx = ref === "HEAD" ? cl.commits.length - 1 : -1;
    if (idx < 0) cl.commits.forEach(function (c, i) { if (c.sha.indexOf(ref) === 0 && ref.length >= 7) idx = i; });
    if (idx < 1) throw gerr(idx === 0 ? "error: the first commit of the repository can't be reverted in the sandbox" : "fatal: bad revision '" + ref + "'", 128);
    var ch = changes(sim, cl); if (ch.unstaged.length || ch.staged.length) throw gerr("error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.\nfatal: revert failed", 128);
    var target = cl.commits[idx], parent = cl.commits[idx - 1].files, head = headFiles(cl), snap = Object.assign({}, head), n = 0;
    Object.keys(Object.assign({}, target.files, parent)).forEach(function (p) {
      if (target.files[p] === parent[p]) return;
      if (head[p] !== target.files[p]) throw gerr("error: could not revert " + short(target.sha) + "... " + target.message.split("\n")[0] + "\nhint: later commits changed " + p + " again; the sandbox can't resolve conflicts.", 1);
      if (parent[p] == null) { delete snap[p]; sim.fs.rm(cl.dir + "/" + p); } else { snap[p] = parent[p]; sim.fs.write(cl.dir + "/" + p, parent[p]); }
      n++;
    });
    var msg = "Revert \"" + target.message.split("\n")[0] + "\"\n\nThis reverts commit " + target.sha + ".", c = { sha: S.hex(cl.dir + cl.commits.length + msg + sim.now, 40), message: msg, author: "learner <learner@sandbox.local>", time: sim.now, files: snap };
    cl.commits.push(c);
    io.out("[" + cl.branch + " " + short(c.sha) + "] Revert \"" + target.message.split("\n")[0] + "\"\n " + n + " file" + (n === 1 ? "" : "s") + " changed\n");
  };
  git.reset = function (a, io, sim, sc) {
    var cl = cloneAt(sim, sc), f = U.flags(a, { bool: "hard soft mixed q" }), ref = f._[0] || "HEAD", r = G.remote(sim, cl.url);
    if (!f.hard) { cl.index = {}; return 0; }
    var list = /^origin\//.test(ref) ? (r.branches[ref.slice(7)] || []).slice() : null;
    if (/^HEAD~(\d+)$/.test(ref)) list = cl.commits.slice(0, Math.max(1, cl.commits.length - +RegExp.$1));
    if (!list) list = cl.commits.slice();
    Object.keys(tree(sim, cl)).forEach(function (p) { if (headFiles(cl)[p] != null || cl.index[p] != null) sim.fs.rm(cl.dir + "/" + p); });
    cl.commits = list; cl.index = {};
    var hf = headFiles(cl); Object.keys(hf).forEach(function (p) { sim.fs.write(cl.dir + "/" + p, hf[p]); });
    io.out("HEAD is now at " + short(list[list.length - 1].sha) + " " + list[list.length - 1].message.split("\n")[0] + "\n");
  };
  git.branch = function (a, io, sim, sc) { var cl = cloneAt(sim, sc), r = G.remote(sim, cl.url), names = Object.keys(r.branches); if (names.indexOf(cl.branch) < 0) names.push(cl.branch); if (a.indexOf("--show-current") >= 0) { io.out(cl.branch + "\n"); return; } io.out(names.sort().map(function (b) { return (b === cl.branch ? "* " : "  ") + b; }).join("\n") + "\n"); };
  git.remote = function (a, io, sim, sc) { var cl = cloneAt(sim, sc); io.out(a.indexOf("-v") >= 0 ? "origin\t" + cl.url + " (fetch)\norigin\t" + cl.url + " (push)\n" : "origin\n"); };
  git.show = function (a, io, sim, sc) { var cl = cloneAt(sim, sc), c = cl.commits[cl.commits.length - 1]; io.out("commit " + c.sha + "\nAuthor: " + c.author + "\n\n    " + c.message.split("\n").join("\n    ") + "\n"); };
  git["rev-parse"] = function (a, io, sim, sc) { var cl = cloneAt(sim, sc), c = cl.commits[cl.commits.length - 1]; io.out((a.indexOf("--short") >= 0 ? short(c.sha) : a.indexOf("--abbrev-ref") >= 0 ? cl.branch : c.sha) + "\n"); };
  git.config = function () { return 0; };
  git.init = function () { throw gerr("git init: local-only repositories are not simulated. Clone the course repository instead:\n  git clone " + G.DEFAULT_URL); };
  git.stash = git.merge = git.rebase = git.tag = function (a, io, sim, sc, name) { throw gerr("git " + name + ": not simulated in this sandbox (available: clone, status, add, commit, push, pull, log, diff, restore, revert, reset, branch, checkout)"); };
  S.commands.git = async function (a, io, sim, sc) {
    if (!a.length || a[0] === "--help") { io.out("usage: git <command> [<args>]\n\nSimulated: clone, status, add, commit, push, pull, fetch, log, diff, restore, checkout, revert, reset, branch, remote, show\n"); return 0; }
    if (a[0] === "--version" || a[0] === "version") { io.out("git version 2.51.0\n"); return 0; }
    if (a[0] === "-C" && a.length > 2) { var saved = sc.cwd, dir = U.norm(a[1], sc.cwd); if (!sim.fs.isDir(dir)) throw gerr("fatal: cannot change to '" + a[1] + "': No such file or directory", 128); sc.cwd = dir; try { return await S.commands.git(a.slice(2), io, sim, sc); } finally { sc.cwd = saved; } }
    var fn = git[a[0]];
    if (!fn) throw gerr("git: '" + a[0] + "' is not a git command. See 'git --help'.", 1);
    return fn(a.slice(1), io, sim, sc, a[0]);
  };

  /* ====================== Argo CD ====================== */
  var A = S.argo = {};
  var NS = "argocd", IN_CLUSTER = "https://kubernetes.default.svc", POLL = 30000;
  A.NS = NS; A.POLL = POLL;
  A.bootstrap = function (sim) {
    var K = sim.k8s, img = "quay.io/argoproj/argocd:v3.5.4";
    K.create({ apiVersion: "v1", kind: "Namespace", metadata: { name: NS } });
    function dep(name, image, port) {
      var labels = { "app.kubernetes.io/name": name, "app.kubernetes.io/part-of": "argocd" };
      K.create({ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: name, namespace: NS, labels: labels }, spec: { selector: { matchLabels: { "app.kubernetes.io/name": name } }, template: { metadata: { labels: labels }, spec: { tolerations: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }], nodeSelector: { "node-role.kubernetes.io/control-plane": "" }, containers: [{ name: name, image: image, ports: port ? [{ containerPort: port }] : undefined }] } } } });
      if (port) K.create({ apiVersion: "v1", kind: "Service", metadata: { name: name, namespace: NS, labels: labels }, spec: { selector: { "app.kubernetes.io/name": name }, ports: port === 8080 ? [{ name: "http", port: 80, targetPort: 8080 }, { name: "https", port: 443, targetPort: 8080 }] : [{ port: port, targetPort: port }] } });
    }
    dep("argocd-server", img, 8080); dep("argocd-repo-server", img, 8081); dep("argocd-applicationset-controller", img, 0); dep("argocd-notifications-controller", img, 0);
    dep("argocd-redis", "public.ecr.aws/docker/library/redis:8.2.2-alpine", 6379); dep("argocd-dex-server", "ghcr.io/dexidp/dex:v2.44.0", 5556);
    var cl = { "app.kubernetes.io/name": "argocd-application-controller", "app.kubernetes.io/part-of": "argocd" };
    K.create({ apiVersion: "apps/v1", kind: "StatefulSet", metadata: { name: "argocd-application-controller", namespace: NS, labels: cl }, spec: { serviceName: "argocd-application-controller", selector: { matchLabels: { "app.kubernetes.io/name": "argocd-application-controller" } }, template: { metadata: { labels: cl }, spec: { tolerations: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }], nodeSelector: { "node-role.kubernetes.io/control-plane": "" }, containers: [{ name: "argocd-application-controller", image: img }] } } } });
    K.create({ apiVersion: "argoproj.io/v1alpha1", kind: "AppProject", metadata: { name: "default", namespace: NS }, spec: { sourceRepos: ["*"], destinations: [{ namespace: "*", server: "*" }], clusterResourceWhitelist: [{ group: "*", kind: "*" }] } });
    K.create({ apiVersion: "v1", kind: "Secret", metadata: { name: "argocd-initial-admin-secret", namespace: NS }, stringData: { password: "s4ndb0x-Adm1n-Pw" } });
    sim.argo = { repos: {}, cache: {}, context: "argocd-server.argocd.svc" };
  };
  function up(sim, name) { return sim.k8s.list("Pod", NS).some(function (p) { return (p.metadata.labels || {})["app.kubernetes.io/name"] === name && K8.isReady(p); }); }
  function trackId(app, k, o) { return app.metadata.name + ":" + k.group + "/" + k.kind + ":" + (o.metadata.namespace || "") + "/" + o.metadata.name; }
  var TRACK = "argocd.argoproj.io/tracking-id";

  /* Is every field of `want` present with the same value in `live`? */
  function subset(want, live) {
    if (want === null || want === undefined) return true;
    if (typeof want !== "object") return String(want) === String(live == null ? "" : live) && (live != null || want === "");
    if (Array.isArray(want)) { if (!Array.isArray(live) || live.length !== want.length) return false; return want.every(function (w, i) { var byName = w && typeof w === "object" && w.name != null ? live.filter(function (l) { return l && l.name === w.name; })[0] : live[i]; return subset(w, byName === undefined ? live[i] : byName); }); }
    if (!live || typeof live !== "object") return Object.keys(want).length === 0;
    return Object.keys(want).every(function (k) { return subset(want[k], live[k]); });
  }
  /* Load and render the application's target manifests. Returns { objects, revision, error } */
  A.target = function (sim, app) {
    var K = sim.k8s, src = app.spec.source || (app.spec.sources || [])[0], dest = app.spec.destination || {};
    if (!src) return { error: "InvalidSpecError", message: "application spec is invalid: source is required" };
    var proj = K.get("AppProject", NS, app.spec.project || "default");
    if (!proj) return { error: "InvalidSpecError", message: "application references project " + (app.spec.project || "default") + " which does not exist" };
    if (dest.server && dest.server !== IN_CLUSTER) return { error: "InvalidSpecError", message: "application destination server '" + dest.server + "' and namespace '" + (dest.namespace || "") + "' do not match any of the allowed destinations in project '" + proj.metadata.name + "' (cluster '" + dest.server + "' has not been configured)" };
    if (dest.name && dest.name !== "in-cluster") return { error: "InvalidSpecError", message: "application destination spec for " + app.metadata.name + " is invalid: unable to find destination server: there are no clusters with this name: " + dest.name };
    if (!dest.server && !dest.name) return { error: "InvalidSpecError", message: "Destination server missing from app spec" };
    var okDest = (proj.spec.destinations || []).some(function (d) { return (d.namespace === "*" || d.namespace === dest.namespace) && (d.server === "*" || d.server === IN_CLUSTER || d.name === "in-cluster" || d.name === "*"); });
    if (!okDest) return { error: "InvalidSpecError", message: "application destination server '" + IN_CLUSTER + "' and namespace '" + (dest.namespace || "") + "' do not match any of the allowed destinations in project '" + proj.metadata.name + "'" };
    var okRepo = (proj.spec.sourceRepos || []).some(function (r) { return r === "*" || norm(r) === norm(src.repoURL); });
    if (!okRepo) return { error: "InvalidSpecError", message: "application repo " + src.repoURL + " is not permitted in project '" + proj.metadata.name + "'" };
    var pre = "Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unknown desc = ";
    if (!up(sim, "argocd-repo-server")) return { error: "ComparisonError", message: "Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unavailable desc = connection error: desc = \"transport: Error while dialing: dial tcp 10.96.0.31:8081: connect: connection refused\"" };
    var remote = G.remote(sim, src.repoURL);
    if (!remote) return { error: "ComparisonError", message: pre + "failed to list refs: repository not found: Repository not found." };
    if (remote["private"]) {
      var cr = sim.argo.repos[norm(src.repoURL)];
      if (!cr || cr.username !== remote.creds.username || cr.password !== remote.creds.password) return { error: "ComparisonError", message: pre + "failed to list refs: authentication required: Repository not found." };
    }
    var commit = G.resolve(remote, src.targetRevision);
    if (!commit) return { error: "ComparisonError", message: pre + "unable to resolve '" + src.targetRevision + "' to a commit SHA" };
    var key = app.metadata.uid + "|" + commit.sha + "|" + JSON.stringify(src) + "|" + (dest.namespace || "");
    var cached = sim.argo.cache[app.metadata.uid];
    if (cached && cached.key === key) return cached.value;
    var value = (function () {
      var path = (src.path || "").replace(/^\.?\/+|\/+$/g, ""), prefix = path && path !== "." ? path + "/" : "", files = {};
      if (path === ".") prefix = "";
      Object.keys(commit.files).forEach(function (p) { if (p.indexOf(prefix) === 0) files[p.slice(prefix.length)] = commit.files[p]; });
      if (!Object.keys(files).length) return { error: "ComparisonError", message: pre + (path || ".") + ": app path does not exist", revision: commit.sha };
      var objs = [];
      if (files["kustomization.yaml"] != null) return { error: "ComparisonError", message: pre + "kustomize build is not simulated in this sandbox", revision: commit.sha };
      if (files["Chart.yaml"] != null) {
        var h = src.helm || {}, vals = {};
        try {
          var chart = S.helm.loadChart(files, path);
          (h.valueFiles || []).forEach(function (vf) {
            var rel = vf.replace(/^\.\//, ""), text = files[rel] != null ? files[rel] : commit.files[U.norm(rel, "/" + path).slice(1)];
            if (text == null) { if (h.ignoreMissingValueFiles) return; throw new CmdError("Error: open " + path + "/" + vf + ": no such file or directory"); }
            vals = S.helm.deepMerge(vals, S.YAML.load(text) || {});
          });
          if (h.values) vals = S.helm.deepMerge(vals, S.YAML.load(h.values) || {});
          if (h.valuesObject) vals = S.helm.deepMerge(vals, U.clone(h.valuesObject));
          vals = S.helm.deepMerge(vals, S.helm.parseSet((h.parameters || []).map(function (p) { return p.name + "=" + String(p.value).replace(/,/g, "\\,"); }), false));
          var out = S.helm.render(sim, chart, { name: h.releaseName || app.metadata.name, namespace: dest.namespace || "default", values: vals });
          objs = out.objects.map(function (d) { return d.obj; });
        } catch (e) {
          if (!(e instanceof CmdError) && !(e && e.name === "YAMLException")) throw e;
          return { error: "ComparisonError", message: pre + "Manifest generation error (cached): `helm template . --name-template " + (h.releaseName || app.metadata.name) + " --namespace " + (dest.namespace || "default") + " --include-crds` failed exit status 1: " + (e.message || String(e)), revision: commit.sha };
        }
      } else {
        var recurse = (src.directory || {}).recurse, bad = null;
        Object.keys(files).sort().forEach(function (p) {
          if (bad || !/\.(ya?ml|json)$/.test(p) || (!recurse && p.indexOf("/") >= 0)) return;
          try { S.YAML.loadAll(files[p]).forEach(function (o) { if (o && typeof o === "object") { if (!o.kind || !o.apiVersion) return; objs.push(o); } }); }
          catch (e) { bad = pre + "Manifest generation error (cached): failed to unmarshal \"" + p + "\": error converting YAML to JSON: yaml: line " + ((e.mark ? e.mark.line : 0) + 1) + ": " + (/bad indentation/.test(e.reason || "") ? "did not find expected key" : /implicit key|multiline key|block mapping/.test(e.reason || "") ? "mapping values are not allowed in this context" : "could not find expected ':'"); }
        });
        if (bad) return { error: "ComparisonError", message: bad, revision: commit.sha };
      }
      return { objects: objs, revision: commit.sha };
    })();
    sim.argo.cache[app.metadata.uid] = { key: key, value: value };
    return value;
  };
  function healthOf(K, o) {
    var s = o.status || {};
    if (o.kind === "Deployment") {
      var prog = (s.conditions || []).filter(function (c) { return c.type === "Progressing"; })[0];
      if (o.spec.paused) return { status: "Suspended", message: "Deployment is paused" };
      if (prog && prog.reason === "ProgressDeadlineExceeded") return { status: "Degraded", message: "Deployment \"" + o.metadata.name + "\" exceeded its progress deadline" };
      if ((s.observedGeneration || 0) < o.metadata.generation) return { status: "Progressing", message: "Waiting for rollout to finish: observed deployment generation less than desired generation" };
      if ((s.updatedReplicas || 0) < o.spec.replicas) return { status: "Progressing", message: "Waiting for rollout to finish: " + (s.updatedReplicas || 0) + " out of " + o.spec.replicas + " new replicas have been updated..." };
      if ((s.replicas || 0) > (s.updatedReplicas || 0)) return { status: "Progressing", message: "Waiting for rollout to finish: " + ((s.replicas || 0) - (s.updatedReplicas || 0)) + " old replicas are pending termination..." };
      if ((s.availableReplicas || 0) < (s.updatedReplicas || 0)) return { status: "Progressing", message: "Waiting for rollout to finish: " + (s.availableReplicas || 0) + " of " + (s.updatedReplicas || 0) + " updated replicas are available..." };
      return { status: "Healthy" };
    }
    if (o.kind === "StatefulSet") return (s.readyReplicas || 0) >= o.spec.replicas ? { status: "Healthy", message: "statefulset rolling update complete " + o.spec.replicas + " pods at revision " + (s.currentRevision || "") + "..." } : { status: "Progressing", message: "Waiting for " + (o.spec.replicas - (s.readyReplicas || 0)) + " pods to be ready..." };
    if (o.kind === "DaemonSet") return (s.numberReady || 0) >= (s.desiredNumberScheduled || 0) ? { status: "Healthy" } : { status: "Progressing", message: "Waiting for daemon set rollout to finish" };
    if (o.kind === "Service") return o.spec.type === "LoadBalancer" && !((s.loadBalancer || {}).ingress || []).length ? { status: "Progressing" } : { status: "Healthy" };
    if (o.kind === "Ingress") return ((s.loadBalancer || {}).ingress || []).length ? { status: "Healthy" } : { status: "Progressing" };
    if (o.kind === "PersistentVolumeClaim") return s.phase === "Bound" ? { status: "Healthy" } : { status: "Progressing" };
    if (o.kind === "Job") return s.completionTime ? { status: "Healthy" } : (s.conditions || []).some(function (c) { return c.type === "Failed"; }) ? { status: "Degraded", message: "Job has reached the specified backoff limit" } : { status: "Progressing" };
    if (o.kind === "Pod") { var ps = S.kubectl.podState(K.sim, o).status; return K8.isReady(o) || s.phase === "Succeeded" ? { status: "Healthy" } : /BackOff|Err|Error|Invalid/.test(ps) ? { status: "Degraded", message: ps } : { status: "Progressing" }; }
    if (o.kind === "Application") return { status: ((s.health || {}).status) || "Progressing" };
    return null;
  }
  /* Default a desired object for comparison without allocating new cluster IPs or node ports. */
  A.defaults = function (K, want, live) {
    if (want.kind === "Service" && want.spec) {
      if (!live) { want.spec = Object.assign({ type: "ClusterIP" }, want.spec); return; }
      if (!want.spec.clusterIP) want.spec.clusterIP = live.spec.clusterIP;
      (want.spec.ports || []).forEach(function (p, i) { var lp = (live.spec.ports || [])[i]; if (!p.nodePort && lp && lp.nodePort) p.nodePort = lp.nodePort; });
    }
    K.applyDefaults(want);
  };
  var RANK = { Healthy: 0, Suspended: 1, Progressing: 2, Missing: 3, Degraded: 4, Unknown: 5 };
  /* Compare target and live state; fills app.status.{sync, health, resources, conditions}. */
  A.compare = function (sim, app) {
    var K = sim.k8s, t = A.target(sim, app), st = app.status = app.status || {}, dest = app.spec.destination || {}, src = app.spec.source || (app.spec.sources || [])[0] || {};
    st.reconciledAt = sim.iso(); st.sourceType = "Directory";
    var conds = (st.conditions || []).filter(function (c) { return c.type === "SyncError"; });
    if (t.error) {
      var old = (st.conditions || []).filter(function (c) { return c.type === t.error && c.message === t.message; })[0];
      st.conditions = conds.concat([old || { type: t.error, message: t.message, lastTransitionTime: sim.iso() }]);
      st.sync = { status: "Unknown", comparedTo: { source: src, destination: dest }, revision: t.revision || "" };
      st.health = { status: st.resources && st.resources.length ? (st.health || {}).status || "Healthy" : "Healthy" };
      if (t.error === "InvalidSpecError") { st.health = { status: "Unknown" }; st.resources = []; }
      return t;
    }
    st.conditions = conds;
    var res = [], out = false, worst = "Healthy", seen = {};
    t.objects.forEach(function (obj) {
      var k = K8.BY_KIND[obj.kind], ns = k && k.namespaced ? ((obj.metadata || {}).namespace || dest.namespace || "default") : "";
      if (!k || k.api !== obj.apiVersion) { res.push({ group: String(obj.apiVersion || "").split("/").length > 1 ? obj.apiVersion.split("/")[0] : "", kind: obj.kind, namespace: ns, name: (obj.metadata || {}).name, status: "OutOfSync", health: { status: "Missing" }, version: "v1" }); out = true; return; }
      var live = K.get(k.kind, ns, obj.metadata.name), r = { group: k.group, version: k.api.split("/").pop(), kind: k.kind, namespace: ns, name: obj.metadata.name, status: "Synced" };
      seen[k.kind + "/" + ns + "/" + obj.metadata.name] = 1;
      if (!live) { r.status = "OutOfSync"; r.health = { status: "Missing" }; out = true; }
      else {
        var want = U.clone(obj); want.metadata.namespace = ns || undefined;
        try { A.defaults(K, want, live); } catch (e) { /* invalid manifests are reported by sync */ }
        var same = subset(want.spec, live.spec) && subset(want.data, live.data) && subset(want.rules, live.rules) && subset(want.subjects, live.subjects) && subset((want.metadata || {}).labels, live.metadata.labels) && (want.stringData ? Object.keys(want.stringData).every(function (x) { return live.data && live.data[x] === U.b64e(String(want.stringData[x])); }) : true);
        if (!same) { r.status = "OutOfSync"; out = true; }
        var h = healthOf(K, live); if (h) r.health = h;
      }
      if (r.health && RANK[r.health.status] > RANK[worst]) worst = r.health.status;
      res.push(r);
    });
    // live resources that carry this app's tracking id but are no longer in git
    K.objs.forEach(function (o) {
      var id = (o.metadata.annotations || {})[TRACK]; if (!id || id.split(":")[0] !== app.metadata.name) return;
      var k = K8.BY_KIND[o.kind]; if (!k || seen[k.kind + "/" + (o.metadata.namespace || "") + "/" + o.metadata.name] || (o.metadata.ownerReferences || []).length) return;
      var r = { group: k.group, version: k.api.split("/").pop(), kind: k.kind, namespace: o.metadata.namespace || "", name: o.metadata.name, status: "OutOfSync", requiresPruning: true }, h = healthOf(K, o);
      if (h) r.health = h; res.push(r); out = true;
    });
    st.resources = res;
    st.sync = { status: out ? "OutOfSync" : "Synced", comparedTo: { source: src, destination: dest }, revision: t.revision };
    st.health = { status: worst };
    st.summary = { images: Array.from(new Set(t.objects.reduce(function (l, o) { var tp = (o.spec || {}).template; return l.concat(((tp && tp.spec && tp.spec.containers) || []).map(function (c) { return c.image; })); }, []))) };
    return t;
  };
  /* Run a sync operation. opts: { prune, revision, automated, dryRun } */
  A.sync = function (sim, app, opts) {
    opts = opts || {};
    var K = sim.k8s, t = A.target(sim, app), st = app.status = app.status || {}, dest = app.spec.destination || {}, ns = dest.namespace || "default";
    var op = { operation: { sync: { revision: (t && t.revision) || "", prune: !!opts.prune }, initiatedBy: opts.automated ? { automated: true } : { username: "admin" } }, phase: "Running", startedAt: sim.iso(), _start: sim.now, syncResult: { revision: (t && t.revision) || "", resources: [], source: app.spec.source } };
    st.operationState = op;
    function done(phase, message) { op.phase = phase; op.message = message; op.finishedAt = sim.iso(); op._end = sim.now; st.conditions = (st.conditions || []).filter(function (c) { return c.type !== "SyncError"; }); if (phase === "Failed") st.conditions.push({ type: "SyncError", message: "Failed last sync attempt to " + (op.syncResult.revision || "") + ": " + message, lastTransitionTime: sim.iso() }); return op; }
    if (t.error) return done(t.error === "InvalidSpecError" ? "Error" : "Failed", t.message);
    var syncOpts = ((app.spec.syncPolicy || {}).syncOptions || []);
    if (!K.get("Namespace", null, ns)) {
      if (syncOpts.indexOf("CreateNamespace=true") >= 0) { K.create({ apiVersion: "v1", kind: "Namespace", metadata: { name: ns } }); op.syncResult.resources.push({ group: "", kind: "Namespace", namespace: "", name: ns, status: "Synced", message: "namespace/" + ns + " created", hookPhase: "Running", syncPhase: "PreSync" }); }
      else {
        t.objects.forEach(function (o) { var k = K8.BY_KIND[o.kind]; if (k && k.namespaced && !(o.metadata || {}).namespace) op.syncResult.resources.push({ group: k.group, kind: k.kind, namespace: ns, name: o.metadata.name, status: "SyncFailed", message: "namespaces \"" + ns + "\" not found", syncPhase: "Sync" }); });
        return done("Failed", "one or more objects failed to apply, reason: namespaces \"" + ns + "\" not found");
      }
    }
    var failed = [];
    var ORDER = ["Namespace", "NetworkPolicy", "ResourceQuota", "LimitRange", "ServiceAccount", "Secret", "ConfigMap", "StorageClass", "PersistentVolume", "PersistentVolumeClaim", "ClusterRole", "ClusterRoleBinding", "Role", "RoleBinding", "Service", "DaemonSet", "Pod", "ReplicaSet", "Deployment", "StatefulSet", "Job", "CronJob", "Ingress", "AppProject", "Application"];
    t.objects.slice().sort(function (a, b) { var wa = +(((a.metadata || {}).annotations || {})["argocd.argoproj.io/sync-wave"] || 0), wb = +(((b.metadata || {}).annotations || {})["argocd.argoproj.io/sync-wave"] || 0); return wa - wb || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind); }).forEach(function (obj) {
      var k = K8.BY_KIND[obj.kind], r = { group: k ? k.group : "", kind: obj.kind, namespace: k && k.namespaced ? ((obj.metadata || {}).namespace || ns) : "", name: (obj.metadata || {}).name, syncPhase: "Sync" };
      try {
        if (!k || k.api !== obj.apiVersion) throw new CmdError("The Kubernetes API could not find " + (String(obj.apiVersion).indexOf("/") > 0 ? obj.apiVersion.split("/")[0] : "") + "/" + obj.kind + " for requested resource " + r.namespace + "/" + r.name + ". Make sure the \"" + obj.kind + "\" CRD is installed on the destination cluster.");
        if (opts.dryRun) { r.status = "Synced"; r.message = S.kubectl.ref(k, obj) + " (dry run)"; }
        else {
          var verb = K8.applyObject(K, obj, ns, function (o) { o.metadata.annotations = Object.assign({}, o.metadata.annotations); o.metadata.annotations[TRACK] = trackId(app, k, o); });
          r.status = "Synced"; r.message = S.kubectl.ref(k, obj) + " " + verb; r.hookPhase = "Running";
        }
      } catch (e) {
        if (!(e instanceof CmdError)) throw e;
        r.status = "SyncFailed"; r.message = e.message.replace(/^The (\w+) "/, function (_, kd) { var kk = K8.BY_KIND[kd]; return kd + (kk && kk.group ? "." + kk.group.split(".")[0] : "") + " \""; }); failed.push(r);
      }
      op.syncResult.resources.push(r);
    });
    // prune
    var keep = {}; t.objects.forEach(function (o) { var k = K8.BY_KIND[o.kind]; if (k) keep[k.kind + "/" + (k.namespaced ? ((o.metadata || {}).namespace || ns) : "") + "/" + o.metadata.name] = 1; });
    var extra = []; K.objs.forEach(function (o) { var id = (o.metadata.annotations || {})[TRACK]; if (id && id.split(":")[0] === app.metadata.name && !keep[o.kind + "/" + (o.metadata.namespace || "") + "/" + o.metadata.name] && !(o.metadata.ownerReferences || []).length) extra.push(o); });
    extra.forEach(function (o) {
      var k = K8.BY_KIND[o.kind], r = { group: k.group, kind: k.kind, namespace: o.metadata.namespace || "", name: o.metadata.name, syncPhase: "Sync" };
      if (opts.prune && !opts.dryRun) { K.remove(o); r.status = "Pruned"; r.message = "pruned"; } else { r.status = "PruneSkipped"; r.message = "ignored (requires pruning)"; }
      op.syncResult.resources.push(r);
    });
    if (failed.length) return done("Failed", "one or more objects failed to apply, reason: " + failed[0].message + (failed.length > 1 ? " (and " + (failed.length - 1) + " more)" : ""));
    if (!opts.dryRun) {
      st.history = st.history || [];
      var lastH = st.history[st.history.length - 1];
      if (!(lastH && lastH.revision === t.revision && JSON.stringify(lastH.source) === JSON.stringify(app.spec.source) && opts.automated)) st.history.push({ id: st.history.length ? st.history[st.history.length - 1].id + 1 : 0, revision: t.revision, deployedAt: sim.iso(), _at: sim.now, deployStartedAt: op.startedAt, source: U.clone(app.spec.source), initiatedBy: op.operation.initiatedBy });
      if (st.history.length > 10) st.history.shift();
    }
    return done("Succeeded", "successfully synced (all tasks run)");
  };
  A.tick = function (sim) {
    var K = sim.k8s;
    if (!sim.argo || !K.get("Namespace", null, NS) || !up(sim, "argocd-application-controller")) return;
    K.list("Application", NS).forEach(function (app) {
      if (app.metadata.deletionTimestamp) return;
      var st = app.status = app.status || {}, pol = (app.spec.syncPolicy || {}).automated;
      // poll git only every POLL ms (or when the spec changed / a refresh was requested); live state is compared every tick
      var specKey = JSON.stringify([app.spec.source, app.spec.destination, app.spec.project]);
      if (app._specKey !== specKey || app._refresh || app._polledAt == null || sim.now - app._polledAt >= POLL) { app._specKey = specKey; app._refresh = false; app._polledAt = sim.now; delete sim.argo.cache[app.metadata.uid]; }
      else if (sim.argo.cache[app.metadata.uid]) { /* keep cached target */ }
      var t = A.compare(sim, app);
      if (st.sync.status !== "OutOfSync") app._driftAt = null;
      if (!pol || t.error || st.sync.status !== "OutOfSync") return;
      var onlyPrune = st.resources.filter(function (r) { return r.status === "OutOfSync"; }).every(function (r) { return r.requiresPruning; });
      if (onlyPrune && !pol.prune) return;
      var op = st.operationState, sameRev = op && op.syncResult && op.syncResult.revision === t.revision && app._syncedSpec === specKey;
      if (sameRev && op.phase === "Succeeded" && !pol.selfHeal) return;          // drift without selfHeal stays OutOfSync
      if (sameRev && op.phase !== "Succeeded") { if (sim.now - op._end < 60000 * Math.min(8, Math.pow(2, (app._retries || 1) - 1))) return; }
      if (sameRev && op.phase === "Succeeded") {                                  // drift: selfHeal reacts after 5 seconds
        if (app._driftAt == null) app._driftAt = sim.now;
        if (sim.now - app._driftAt < 5000) return;
      }
      app._driftAt = null;
      app._syncedSpec = specKey;
      var res = A.sync(sim, app, { prune: !!pol.prune, automated: true });
      app._retries = res.phase === "Succeeded" ? 0 : (app._retries || 0) + 1;
      A.compare(sim, app);
    });
  };
  /* kubectl delete application: the resources finalizer cascades to the managed resources */
  A.onDelete = function (K, app) {
    if ((app.metadata.finalizers || []).indexOf("resources-finalizer.argocd.argoproj.io") < 0) return;
    A.cascade(K, app);
  };
  A.cascade = function (K, app) {
    var gone = []; K.objs.forEach(function (o) { var id = (o.metadata.annotations || {})[TRACK]; if (id && id.split(":")[0] === app.metadata.name && !(o.metadata.ownerReferences || []).length) gone.push(o); });
    gone.forEach(function (o) { K.remove(o); });
  };

  /* ---------- argocd CLI ---------- */
  var cmds = {};
  function need(sim) { if (!up(sim, "argocd-server")) throw fatal("rpc error: code = Unavailable desc = connection error: desc = \"transport: Error while dialing: dial tcp " + sim.argo.context + ":443: connect: connection refused\""); }
  function appOf(sim, name) {
    name = String(name || "").replace(/^argocd\//, "");
    var app = sim.k8s.get("Application", NS, name);
    if (!app) throw fatal("rpc error: code = NotFound desc = error getting application: applications.argoproj.io \"" + name + "\" not found");
    return app;
  }
  function tw(rows) { return U.table(rows, 2); }
  function policy(app) { var p = (app.spec.syncPolicy || {}).automated; return p ? "Auto" + (p.prune ? "-Prune" : "") : "Manual"; }
  function ts(sim, t) { return sim.date(t).toISOString().replace("T", " ").replace(/\.\d+Z$/, " +0000 UTC"); }
  function refresh(sim, app) { app._refresh = true; sim.reconcile(); A.compare(sim, app); }
  function resourceRows(app, withTime, sim) {
    var st = app.status || {}, opRes = ((st.operationState || {}).syncResult || {}).resources || [];
    var rows = (st.resources || []).map(function (r) {
      var o = opRes.filter(function (x) { return x.kind === r.kind && x.name === r.name && x.namespace === r.namespace; })[0];
      return [r.group, r.kind, r.namespace, r.name, r.status, (r.health || {}).status || "", "", o ? o.message : (r.health || {}).message || ""];
    });
    opRes.forEach(function (o) { if (o.status === "Pruned" || (o.status === "SyncFailed" && !rows.some(function (r) { return r[1] === o.kind && r[3] === o.name; }))) rows.push([o.group, o.kind, o.namespace, o.name, o.status === "Pruned" ? "Succeeded" : "OutOfSync", o.status === "Pruned" ? "Pruned" : "Missing", "", o.message]); });
    return rows;
  }
  function describe(sim, app, showOp) {
    var st = app.status || {}, src = app.spec.source || (app.spec.sources || [])[0] || {}, dest = app.spec.destination || {}, L = [], w = 20, sync = st.sync || {}, rev = sync.revision ? " (" + sync.revision.slice(0, 7) + ")" : "";
    function kv(k, v) { L.push((k + ":").padEnd(w) + v); }
    kv("Name", NS + "/" + app.metadata.name); kv("Project", app.spec.project || "default"); kv("Server", dest.server || dest.name || ""); kv("Namespace", dest.namespace || "");
    kv("URL", "https://" + sim.argo.context + "/applications/" + app.metadata.name);
    L.push("Source:", ("- Repo:").padEnd(w) + (src.repoURL || ""), ("  Target:").padEnd(w) + (src.targetRevision || ""), ("  Path:").padEnd(w) + (src.path || ""));
    if (src.helm && (src.helm.valueFiles || []).length) L.push(("  Helm Values:").padEnd(w) + src.helm.valueFiles.join(","));
    kv("SyncWindow", "Sync Allowed"); kv("Sync Policy", (app.spec.syncPolicy || {}).automated ? "Automated" + ((app.spec.syncPolicy.automated.prune) ? " (Prune)" : "") : "Manual");
    kv("Sync Status", (sync.status || "Unknown") + (sync.status === "Unknown" ? "" : (sync.status === "Synced" ? " to " : " from ") + (src.targetRevision || "HEAD") + rev));
    kv("Health Status", (st.health || {}).status || "Unknown");
    var op = st.operationState;
    if (op && showOp) {
      L.push("", ("Operation:").padEnd(w) + "Sync", ("Sync Revision:").padEnd(w) + (op.syncResult.revision || ""), ("Phase:").padEnd(w) + op.phase, ("Start:").padEnd(w) + ts(sim, op._start), ("Finished:").padEnd(w) + ts(sim, op._end == null ? op._start : op._end), ("Duration:").padEnd(w) + Math.round(((op._end == null ? sim.now : op._end) - op._start) / 1000) + "s", ("Message:").padEnd(w) + (op.message || ""));
    }
    if ((st.conditions || []).length) { L.push(""); tw([["CONDITION", "MESSAGE", "LAST TRANSITION"]].concat(st.conditions.map(function (c) { return [c.type, c.message, ts(sim, Date.parse(c.lastTransitionTime) - sim.epoch)]; }))).split("\n").forEach(function (l) { L.push(l); }); }
    var rows = resourceRows(app);
    if (rows.length) { L.push(""); tw([["GROUP", "KIND", "NAMESPACE", "NAME", "STATUS", "HEALTH", "HOOK", "MESSAGE"]].concat(rows)).split("\n").forEach(function (l) { L.push(l); }); }
    return L.join("\n") + "\n";
  }
  var APP_FLAGS = { str: "repo path revision dest-server dest-namespace dest-name project sync-policy release-name o output timeout name app-namespace values-literal-file label kustomize-image directory-include config-management-plugin grpc-web-root-path server auth-token",
    bool: "auto-prune self-heal upsert directory-recurse y yes cascade prune dry-run force refresh hard-refresh async health sync operation show-operation show-params insecure plaintext grpc-web replace server-side validate apply-out-of-sync-only local-repo-root suspended degraded",
    multi: "sync-option helm-set helm-set-string values f file resource l selector p parameter", alias: { f: "file", o: "output", y: "yes", l: "selector", p: "parameter" },
    unknown: function (x) { return "FATA[0000] unknown " + (/shorthand/.test(x) ? x.replace("unknown ", "") : "flag: " + x); }, code: 20 };
  function specFrom(f, base) {
    var spec = base ? U.clone(base) : { project: "default", source: {}, destination: {} };
    spec.source = spec.source || {}; spec.destination = spec.destination || {};
    if (f.project) spec.project = f.project;
    if (f.repo) spec.source.repoURL = f.repo; if (f.path) spec.source.path = f.path; if (f.revision) spec.source.targetRevision = f.revision;
    if (f["dest-server"]) { spec.destination.server = f["dest-server"]; delete spec.destination.name; } if (f["dest-name"]) { spec.destination.name = f["dest-name"]; delete spec.destination.server; } if (f["dest-namespace"]) spec.destination.namespace = f["dest-namespace"];
    var sets = (f["helm-set"] || []).concat(f["helm-set-string"] || [], f.parameter || []);
    if (sets.length || f.values || f["release-name"]) {
      spec.source.helm = spec.source.helm || {};
      if (f.values) spec.source.helm.valueFiles = f.values.slice();
      if (f["release-name"]) spec.source.helm.releaseName = f["release-name"];
      sets.forEach(function (kv) { var i = kv.indexOf("="); if (i < 1) throw fatal("Expected helm parameter of the form: param=value. Received: " + kv); spec.source.helm.parameters = (spec.source.helm.parameters || []).filter(function (p) { return p.name !== kv.slice(0, i); }).concat([{ name: kv.slice(0, i), value: kv.slice(i + 1) }]); });
    }
    if (f["directory-recurse"]) spec.source.directory = { recurse: true };
    if (f["sync-policy"]) {
      var sp = f["sync-policy"];
      if (["automated", "auto", "automatic"].indexOf(sp) >= 0) { spec.syncPolicy = spec.syncPolicy || {}; spec.syncPolicy.automated = spec.syncPolicy.automated || {}; }
      else if (sp === "none" || sp === "manual") { if (spec.syncPolicy) delete spec.syncPolicy.automated; }
      else throw fatal("Invalid sync-policy: " + sp);
    }
    if (f["auto-prune"] !== undefined) { if (!(spec.syncPolicy || {}).automated) throw fatal("Cannot set --auto-prune: application not configured with automatic sync"); if (f["auto-prune"]) spec.syncPolicy.automated.prune = true; else delete spec.syncPolicy.automated.prune; }
    if (f["self-heal"] !== undefined) { if (!(spec.syncPolicy || {}).automated) throw fatal("Cannot set --self-heal: application not configured with automatic sync"); if (f["self-heal"]) spec.syncPolicy.automated.selfHeal = true; else delete spec.syncPolicy.automated.selfHeal; }
    if (f["sync-option"]) { spec.syncPolicy = spec.syncPolicy || {}; f["sync-option"].forEach(function (o) { var key = o.replace(/^!/, "").split("=")[0]; spec.syncPolicy.syncOptions = (spec.syncPolicy.syncOptions || []).filter(function (x) { return x.split("=")[0] !== key; }); if (o[0] !== "!") spec.syncPolicy.syncOptions.push(o); }); }
    if (spec.source.repoURL && !spec.source.targetRevision) spec.source.targetRevision = "HEAD";
    return spec;
  }
  var app = {};
  app.create = function (a, io, sim, sc) {
    var f = U.flags(a, APP_FLAGS), K = sim.k8s, name, spec;
    if (f.file) {
      var docs = S.kubectl.readManifests(sim, f.file, sc, io);
      docs.forEach(function (d) {
        if (d.obj.kind !== "Application") throw fatal("unable to load application from " + d.file + ": not an Application");
        var o = U.clone(d.obj); o.metadata.namespace = NS;
        if (K.get("Application", NS, o.metadata.name)) { if (!f.upsert) throw fatal("rpc error: code = InvalidArgument desc = existing application spec is different; use upsert flag to force update"); var live = K.get("Application", NS, o.metadata.name); live.spec = o.spec; K.put(live); io.out("application '" + o.metadata.name + "' updated\n"); return; }
        K.create(o); io.out("application '" + o.metadata.name + "' created\n");
      });
      sim.reconcile(); return 0;
    }
    name = f._[0] || f.name;
    if (!name) throw fatal("application name is required (argocd app create APPNAME --repo URL --path PATH --dest-server SERVER --dest-namespace NS)");
    spec = specFrom(f, null);
    if (!spec.source.repoURL) throw fatal("rpc error: code = InvalidArgument desc = application spec for " + name + " is invalid: InvalidSpecError: spec.source.repoURL and either spec.source.path, spec.source.chart, or spec.source.ref are required");
    if (!spec.source.path) throw fatal("rpc error: code = InvalidArgument desc = application spec for " + name + " is invalid: InvalidSpecError: spec.source.repoURL and either spec.source.path, spec.source.chart, or spec.source.ref are required");
    if (!spec.destination.server && !spec.destination.name) throw fatal("rpc error: code = InvalidArgument desc = application spec for " + name + " is invalid: InvalidSpecError: Destination server missing from app spec");
    var existing = K.get("Application", NS, name);
    if (existing && !f.upsert) throw fatal("rpc error: code = InvalidArgument desc = existing application spec is different; use upsert flag to force update");
    var probe = { metadata: { name: name, uid: "probe-" + name }, spec: spec }, t = A.target(sim, probe);
    delete sim.argo.cache[probe.metadata.uid];
    if (t.error) throw fatal("rpc error: code = InvalidArgument desc = application spec for " + name + " is invalid: InvalidSpecError: " + (t.error === "InvalidSpecError" ? t.message : "Unable to generate manifests in " + spec.source.path + ": " + t.message.replace(/^Failed to load target state: failed to generate manifest for source 1 of 1: /, "")));
    if (existing) { existing.spec = spec; K.put(existing); io.out("application '" + name + "' updated\n"); }
    else { K.create({ apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: { name: name, namespace: NS }, spec: spec }); io.out("application '" + name + "' created\n"); }
    sim.reconcile();
  };
  app.list = function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), apps = sim.k8s.list("Application", NS).sort(function (x, y) { return x.metadata.name < y.metadata.name ? -1 : 1; });
    if (f.project) apps = apps.filter(function (x) { return (x.spec.project || "default") === f.project; });
    if (f.output === "name") { io.out(apps.map(function (x) { return NS + "/" + x.metadata.name; }).join("\n") + (apps.length ? "\n" : "")); return; }
    io.out(tw([["NAME", "CLUSTER", "NAMESPACE", "PROJECT", "STATUS", "HEALTH", "SYNCPOLICY", "CONDITIONS", "REPO", "PATH", "TARGET"]].concat(apps.map(function (x) {
      var st = x.status || {}, src = x.spec.source || {}, d = x.spec.destination || {};
      return [NS + "/" + x.metadata.name, d.server || d.name || "", d.namespace || "", x.spec.project || "default", (st.sync || {}).status || "Unknown", (st.health || {}).status || "Unknown", policy(x), (st.conditions || []).map(function (c) { return c.type; }).filter(function (c, i, l) { return l.indexOf(c) === i; }).join(",") || "<none>", src.repoURL || "", src.path || "", src.targetRevision || ""];
    }))) + "\n");
  };
  app.get = function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]);
    if (f.refresh || f["hard-refresh"]) refresh(sim, x); else A.compare(sim, x);
    if (f.output === "yaml") { io.out(S.yamlDump(S.kubectl.clean(x), true)); return; }
    if (f.output === "json") { io.out(JSON.stringify(S.kubectl.clean(x), null, 2) + "\n"); return; }
    if (f.output === "tree") { io.out(tw([["KIND/NAME", "STATUS", "HEALTH", "MESSAGE"]].concat(((x.status || {}).resources || []).map(function (r) { return [r.kind + "/" + r.name, r.status, (r.health || {}).status || "", (r.health || {}).message || ""]; }))) + "\n"); return; }
    io.out(describe(sim, x, true));
  };
  function printTimeline(sim, x, io) {
    var rows = resourceRows(x).map(function (r) { return [sim.date().toISOString().replace(/\.\d+Z$/, "+00:00")].concat(r); });
    if (rows.length) io.out(tw([["TIMESTAMP", "GROUP", "KIND", "NAMESPACE", "NAME", "STATUS", "HEALTH", "HOOK", "MESSAGE"]].concat(rows)) + "\n\n");
  }
  app.sync = async function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), code = 0;
    if (!f._.length) throw fatal("application name is required (argocd app sync APPNAME)");
    for (var i = 0; i < f._.length; i++) {
      var x = appOf(sim, f._[i]);
      if (f.revision && (x.spec.syncPolicy || {}).automated) throw fatal("rpc error: code = FailedPrecondition desc = Cannot sync to " + f.revision + ": auto-sync currently set to " + (x.spec.source.targetRevision || "HEAD"));
      refresh(sim, x);
      var saved = null;
      if (f.revision) { saved = x.spec.source.targetRevision; x.spec.source.targetRevision = f.revision; delete sim.argo.cache[x.metadata.uid]; }
      await sim.wait(1000);
      var op = A.sync(sim, x, { prune: f.prune, dryRun: f["dry-run"] });
      if (saved !== null) { x._pinned = f.revision; x.spec.source.targetRevision = saved; delete sim.argo.cache[x.metadata.uid]; }
      x._syncedSpec = JSON.stringify([x.spec.source, x.spec.destination, x.spec.project]);
      sim.reconcile(); A.compare(sim, x);
      printTimeline(sim, x, io);
      io.out(describe(sim, x, true));
      if (op.phase !== "Succeeded") { io.err("FATA[0001] Operation has completed with phase: " + op.phase + "\n"); code = 20; }
    }
    return code;
  };
  function normalDiff(a, b) {   // classic `diff` output: "<" is the live object, ">" the desired one
    var d = S.kubectl.lineDiff(a, b), out = [], i = 0, la = 0, lb = 0;
    while (i < d.length) {
      if (d[i][0] === " ") { la++; lb++; i++; continue; }
      var del = [], add = [], sa = la + 1, sb = lb + 1;
      while (i < d.length && d[i][0] !== " ") { if (d[i][0] === "-") { del.push(d[i].slice(1)); la++; } else { add.push(d[i].slice(1)); lb++; } i++; }
      var ra = del.length > 1 ? sa + "," + la : String(del.length ? sa : sa - 1), rb = add.length > 1 ? sb + "," + lb : String(add.length ? sb : sb - 1);
      out.push(ra + (del.length && add.length ? "c" : del.length ? "d" : "a") + rb);
      del.forEach(function (l) { out.push("< " + l); }); if (del.length && add.length) out.push("---"); add.forEach(function (l) { out.push("> " + l); });
    }
    return out;
  }
  app.diff = function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]), K = sim.k8s, any = false;
    refresh(sim, x);
    var t = A.target(sim, x);
    if (t.error) throw fatal("rpc error: code = Unknown desc = " + t.message.replace(/^Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unknown desc = /, ""));
    var ns = (x.spec.destination || {}).namespace || "default";
    t.objects.forEach(function (obj) {
      var k = K8.BY_KIND[obj.kind]; if (!k) return;
      var ons = k.namespaced ? ((obj.metadata || {}).namespace || ns) : "", live = K.get(k.kind, ons, obj.metadata.name), want = U.clone(obj);
      want.metadata.namespace = ons || undefined;
      var pick = function (o, ref) { var c = S.kubectl.clean(o), r = { apiVersion: c.apiVersion, kind: c.kind, metadata: { name: c.metadata.name } }; if (ons) r.metadata.namespace = ons; if (c.metadata.labels) r.metadata.labels = c.metadata.labels; ["spec", "data", "rules", "subjects"].forEach(function (key) { if (c[key] !== undefined) r[key] = c[key]; }); return r; };
      var liveText = "", wantObj;
      try { A.defaults(K, want, live); } catch (e) { /* shown as-is */ }
      wantObj = pick(want);
      if (live) {
        var lv = pick(live); if (!wantObj.metadata.labels) delete lv.metadata.labels;
        // only compare what git specifies: copy live-only fields into the desired side so they don't show as differences
        (function fill(w, l) { if (!w || !l || typeof w !== "object" || typeof l !== "object" || Array.isArray(w) !== Array.isArray(l)) return; if (Array.isArray(w)) { w.forEach(function (it, i) { fill(it, l[i]); }); return; } Object.keys(l).forEach(function (key) { if (w[key] === undefined) w[key] = U.clone(l[key]); else fill(w[key], l[key]); }); })(wantObj, lv);
        liveText = S.yamlDump(lv, true).replace(/\n$/, "");
      }
      var wantText = S.yamlDump(wantObj, true).replace(/\n$/, "");
      if (liveText === wantText) return;
      any = true;
      io.out("\n===== " + (k.group || "") + "/" + k.kind + " " + ons + "/" + obj.metadata.name + " ======\n" + normalDiff(liveText ? liveText.split("\n") : [], wantText.split("\n")).join("\n") + "\n");
    });
    ((x.status || {}).resources || []).forEach(function (r) { if (!r.requiresPruning) return; var o = K.get(r.kind, r.namespace, r.name); if (!o) return; any = true; var c = S.kubectl.clean(o), txt = S.yamlDump({ apiVersion: c.apiVersion, kind: c.kind, metadata: { name: c.metadata.name, namespace: c.metadata.namespace }, spec: c.spec }, true).replace(/\n$/, "").split("\n"); io.out("\n===== " + r.group + "/" + r.kind + " " + r.namespace + "/" + r.name + " ======\n" + normalDiff(txt, []).join("\n") + "\n"); });
    return any ? 1 : 0;
  };
  app.history = function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]), h = (x.status || {}).history || [];
    io.out(tw([["ID", "DATE", "REVISION"]].concat(h.map(function (e) { return [e.id, ts(sim, e._at), (e.source.targetRevision || "HEAD") + " (" + e.revision.slice(0, 7) + ")"]; }))) + "\n");
  };
  app.rollback = async function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]), h = (x.status || {}).history || [];
    if ((x.spec.syncPolicy || {}).automated) throw fatal("rpc error: code = FailedPrecondition desc = rollback cannot be initiated when auto-sync is enabled");
    var target = f._[1] != null ? h.filter(function (e) { return e.id === +f._[1]; })[0] : h[h.length - 2];
    if (!target) throw fatal(f._[1] != null ? "Application '" + x.metadata.name + "' does not have deployment id '" + f._[1] + "' in history" : "Application '" + x.metadata.name + "' should have at least two successful deployments");
    var saved = x.spec.source.targetRevision; x.spec.source.targetRevision = target.revision; delete sim.argo.cache[x.metadata.uid];
    await sim.wait(1000);
    var op = A.sync(sim, x, { prune: f.prune });
    x.spec.source.targetRevision = saved; delete sim.argo.cache[x.metadata.uid];
    sim.reconcile(); A.compare(sim, x);
    printTimeline(sim, x, io); io.out(describe(sim, x, true));
    if (op.phase !== "Succeeded") { io.err("FATA[0001] Operation has completed with phase: " + op.phase + "\n"); return 20; }
  };
  app.set = function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]);
    x.spec = specFrom(f, x.spec); sim.k8s.put(x); delete sim.argo.cache[x.metadata.uid]; sim.reconcile();
  };
  app.unset = function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]), h = (x.spec.source || {}).helm;
    if (h) { (f.parameter || []).forEach(function (n) { h.parameters = (h.parameters || []).filter(function (p) { return p.name !== n; }); }); (f.values || []).forEach(function (v) { h.valueFiles = (h.valueFiles || []).filter(function (y) { return y !== v; }); }); }
    sim.k8s.put(x); delete sim.argo.cache[x.metadata.uid]; sim.reconcile();
  };
  app["delete"] = function (a, io, sim) {
    var f = U.flags(a.map(function (x) { return x === "--cascade=false" ? "--no-cascade-flag" : x; }), Object.assign({}, APP_FLAGS, { bool: APP_FLAGS.bool + " no-cascade-flag" })), K = sim.k8s;
    f._.forEach(function (n) {
      var x = appOf(sim, n);
      if (!f.yes) io.out("Are you sure you want to delete '" + x.metadata.name + "' and all its resources? [y/n] y\n");
      if (!f["no-cascade-flag"]) A.cascade(K, x);
      x.metadata.finalizers = []; K.remove(x);
      io.out("application '" + x.metadata.name + "' deleted\n");
    });
  };
  app.wait = async function (a, io, sim) {
    var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]), left = f.timeout ? +f.timeout : (sim.realtime ? 600 : 120), both = !f.health && !f.sync && !f.operation;
    for (;;) {
      sim.reconcile();
      var st = x.status || {}, ok = (!(f.health || both) || (st.health || {}).status === "Healthy") && (!(f.sync || both) || (st.sync || {}).status === "Synced");
      if (ok) { io.out(describe(sim, x, true)); return 0; }
      if (left-- <= 0) { io.out(describe(sim, x, true)); throw fatal("timed out (" + (f.timeout || 600) + "s) waiting for app \"" + x.metadata.name + "\" match desired state"); }
      await sim.wait(1000);
    }
  };
  app.manifests = function (a, io, sim) { var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]), t = A.target(sim, x); if (t.error) throw fatal(t.message); io.out(t.objects.map(function (o) { return "---\n" + S.yamlDump(o); }).join("")); };
  app.resources = function (a, io, sim) { var f = U.flags(a, APP_FLAGS), x = appOf(sim, f._[0]); io.out(tw([["GROUP", "KIND", "NAMESPACE", "NAME", "ORPHANED"]].concat(((x.status || {}).resources || []).map(function (r) { return [r.group, r.kind, r.namespace, r.name, "No"]; }))) + "\n"); };
  app["terminate-op"] = function (a, io, sim) { var x = appOf(sim, a[0]); io.out("Application '" + x.metadata.name + "' operation terminating\n"); };
  cmds.app = function (a, io, sim, sc) { need(sim); var sub = app[a[0]]; if (!sub) throw fatal("unknown command \"" + (a[0] || "") + "\" for \"argocd app\" (simulated: create, list, get, sync, diff, history, rollback, set, unset, delete, wait, manifests, resources)"); return sub(a.slice(1), io, sim, sc); };
  cmds.repo = function (a, io, sim) {
    need(sim);
    var f = U.flags(a.slice(1), { str: "username password name type project ssh-private-key-path o output", bool: "insecure-skip-server-verification upsert enable-lfs", unknown: APP_FLAGS.unknown });
    if (a[0] === "add") {
      if (!f._[0]) throw fatal("repo add requires a repository URL");
      var r = G.remote(sim, f._[0]);
      if (!r) throw fatal("rpc error: code = Unknown desc = error testing repository connectivity: Get \"" + f._[0] + "/info/refs?service=git-upload-pack\": dial tcp: lookup " + norm(f._[0]).replace(/^\w+:\/\//, "").split("/")[0] + ": no such host");
      if (r["private"] && (f.username !== r.creds.username || f.password !== r.creds.password)) throw fatal("rpc error: code = Unknown desc = error testing repository connectivity: authentication required: Repository not found.");
      sim.argo.repos[norm(f._[0])] = { url: f._[0], username: f.username || "", password: f.password || "" };
      Object.keys(sim.argo.cache).forEach(function (k) { delete sim.argo.cache[k]; });
      sim.k8s.list("Application", NS).forEach(function (x) { x._refresh = true; });
      io.out("Repository '" + f._[0] + "' added\n");
    } else if (a[0] === "list" || a[0] === "ls") {
      var rows = Object.keys(sim.argo.repos).map(function (k) { var x = sim.argo.repos[k]; return ["git", "", x.url, "false", "false", "false", x.username ? "true" : "false", "Successful", "", ""]; });
      io.out(tw([["TYPE", "NAME", "REPO", "INSECURE", "OCI", "LFS", "CREDS", "STATUS", "MESSAGE", "PROJECT"]].concat(rows)) + "\n");
    } else if (a[0] === "rm" || a[0] === "remove") { if (!sim.argo.repos[norm(f._[0])]) throw fatal("rpc error: code = NotFound desc = repo '" + f._[0] + "' not found"); delete sim.argo.repos[norm(f._[0])]; io.out("Repository '" + f._[0] + "' removed\n"); }
    else throw fatal("unknown command \"" + (a[0] || "") + "\" for \"argocd repo\" (simulated: add, list, rm)");
  };
  cmds.proj = function (a, io, sim) {
    need(sim);
    var K = sim.k8s, f = U.flags(a.slice(1), { str: "description o output", multi: "d dest s src", alias: { d: "dest", s: "src" }, unknown: APP_FLAGS.unknown }), sub = a[0];
    function proj(n) { var p = K.get("AppProject", NS, n); if (!p) throw fatal("rpc error: code = NotFound desc = appprojects.argoproj.io \"" + n + "\" not found"); return p; }
    function dests(l) { return (l || []).map(function (d) { var p = d.split(","); return { server: p[0], namespace: p[1] || "*" }; }); }
    if (sub === "list" || sub === "ls") io.out(tw([["NAME", "DESCRIPTION", "DESTINATIONS", "SOURCES", "CLUSTER-RESOURCE-WHITELIST", "NAMESPACE-RESOURCE-BLACKLIST", "SIGNATURE-KEYS", "ORPHANED-RESOURCES", "DESTINATION-SERVICE-ACCOUNTS"]].concat(K.list("AppProject", NS).map(function (p) { var d = p.spec.destinations || [], s = p.spec.sourceRepos || []; return [p.metadata.name, p.spec.description || "", d.length === 1 ? d[0].server + "," + d[0].namespace : d.length ? d.length + " destinations" : "<none>", s.length === 1 ? s[0] : s.length ? s.length + " repos" : "<none>", (p.spec.clusterResourceWhitelist || []).length ? "*/*" : "<none>", "<none>", "<none>", "disabled", "<none>"]; }))) + "\n");
    else if (sub === "create") { if (!f._[0]) throw fatal("project name is required"); if (K.get("AppProject", NS, f._[0])) throw fatal("rpc error: code = AlreadyExists desc = existing project spec is different, use upsert flag to force update"); K.create({ apiVersion: "argoproj.io/v1alpha1", kind: "AppProject", metadata: { name: f._[0], namespace: NS }, spec: { description: f.description || "", sourceRepos: f.src || [], destinations: dests(f.dest) } }); }
    else if (sub === "get") { var p = proj(f._[0]), L = ["Name:                        " + p.metadata.name, "Description:                 " + (p.spec.description || ""), "Destinations:                " + ((p.spec.destinations || []).map(function (d) { return d.server + "," + d.namespace; }).join("\n                             ") || "<none>"), "Repositories:                " + ((p.spec.sourceRepos || []).join("\n                             ") || "<none>"), "Allowed Cluster Resources:   " + ((p.spec.clusterResourceWhitelist || []).length ? "*/*" : "<none>"), "Denied Namespaced Resources: <none>", "Orphaned Resources:          disabled"]; io.out(L.join("\n") + "\n"); }
    else if (sub === "add-destination") { var p2 = proj(f._[0]); p2.spec.destinations = (p2.spec.destinations || []).concat([{ server: f._[1], namespace: f._[2] }]); }
    else if (sub === "remove-destination") { var p3 = proj(f._[0]); p3.spec.destinations = (p3.spec.destinations || []).filter(function (d) { return !(d.server === f._[1] && d.namespace === f._[2]); }); }
    else if (sub === "add-source") { var p4 = proj(f._[0]); p4.spec.sourceRepos = (p4.spec.sourceRepos || []).concat([f._[1]]); }
    else if (sub === "remove-source") { var p5 = proj(f._[0]); p5.spec.sourceRepos = (p5.spec.sourceRepos || []).filter(function (r) { return r !== f._[1]; }); }
    else if (sub === "delete") { var p6 = proj(f._[0]); if (K.list("Application", NS).some(function (x) { return (x.spec.project || "default") === p6.metadata.name; })) throw fatal("rpc error: code = InvalidArgument desc = project is referenced by " + K.list("Application", NS).filter(function (x) { return (x.spec.project || "default") === p6.metadata.name; }).length + " applications"); K.remove(p6); }
    else throw fatal("unknown command \"" + (sub || "") + "\" for \"argocd proj\" (simulated: list, get, create, delete, add-destination, remove-destination, add-source, remove-source)");
    if (/^(add|remove)-/.test(sub)) { Object.keys(sim.argo.cache).forEach(function (k) { delete sim.argo.cache[k]; }); sim.reconcile(); }
  };
  cmds.cluster = function (a, io, sim) { need(sim); if (a[0] !== "list") throw fatal("only `argocd cluster list` is simulated; the sandbox has one cluster (in-cluster)"); io.out(tw([["SERVER", "NAME", "VERSION", "STATUS", "MESSAGE", "PROJECT"], [IN_CLUSTER, "in-cluster", "1.37", "Successful", "", ""]]) + "\n"); };
  cmds.login = function (a, io, sim) {
    var f = U.flags(a, { str: "username password name sso-port grpc-web-root-path", bool: "insecure plaintext grpc-web sso core skip-test-tls", unknown: APP_FLAGS.unknown });
    if (!f._[0] && !f.core) throw fatal("Usage: argocd login SERVER [flags]");
    need(sim);
    var secret = sim.k8s.get("Secret", NS, "argocd-initial-admin-secret"), pw = secret ? U.b64d(secret.data.password) : "s4ndb0x-Adm1n-Pw";
    if (!f.username || !f.password) throw fatal("(sandbox) pass the credentials as flags: argocd login " + (f._[0] || "argocd-server.argocd.svc") + " --username admin --password $(argocd admin initial-password -n argocd | head -1) --insecure");
    if (f.username !== "admin" || f.password !== pw) throw fatal("rpc error: code = Unauthenticated desc = Invalid username or password");
    sim.argo.context = f._[0];
    io.out("'admin:login' logged in successfully\nContext '" + f._[0] + "' updated\n");
  };
  cmds.logout = function (a, io, sim) { io.out("Logged out from '" + (a[0] || sim.argo.context) + "'\n"); };
  cmds.admin = function (a, io, sim) {
    if (a[0] !== "initial-password") throw fatal("only `argocd admin initial-password` is simulated");
    var secret = sim.k8s.get("Secret", NS, "argocd-initial-admin-secret");
    if (!secret) throw fatal("secrets \"argocd-initial-admin-secret\" not found");
    io.out(U.b64d(secret.data.password) + "\n\n This password must be only used for first time login. We strongly recommend you update the password using `argocd account update-password`.\n");
  };
  cmds.account = function (a, io) { if (a[0] === "get-user-info") io.out("Logged In: true\nUsername: admin\nIssuer: argocd\nGroups: \n"); else throw fatal("only `argocd account get-user-info` is simulated"); };
  cmds.context = function (a, io, sim) { io.out(tw([["CURRENT", "NAME", "SERVER"], ["*", sim.argo.context, sim.argo.context]]) + "\n"); };
  cmds.version = function (a, io, sim) {
    io.out("argocd: v3.5.4+0a1b2c3\n  BuildDate: 2026-10-06T20:11:42Z\n  GitTreeState: clean\n  GoVersion: go1.25.1\n  Platform: linux/amd64\n");
    if (a.indexOf("--client") < 0) { need(sim); io.out("argocd-server: v3.5.4+0a1b2c3\n"); }
  };
  var USAGE = "argocd controls a Argo CD server\n\nUsage:\n  argocd [command]\n\nSimulated commands:\n  app         Manage applications (create, list, get, sync, diff, history, rollback, set, delete, wait)\n  repo        Manage repository connection parameters (add, list, rm)\n  proj        Manage projects\n  cluster     Manage cluster credentials (list)\n  login       Log in to Argo CD\n  admin       initial-password\n  version     Print version information\n\nThe sandbox is already logged in to the Argo CD server that runs in the 'argocd' namespace.\nThe course git repository: " + G.DEFAULT_URL + "\n";
  S.commands.argocd = async function (a, io, sim, sc) {
    if (!a.length || a[0] === "--help" || a[0] === "-h" || a[0] === "help") { io.out(USAGE); return 0; }
    if (!sim.k8s.get("Namespace", null, NS)) throw fatal("Argo CD is not installed in this cluster (namespace \"argocd\" not found)");
    var fn = cmds[a[0]];
    if (!fn) throw fatal("unknown command \"" + a[0] + "\" for \"argocd\"");
    return fn(a.slice(1), io, sim, sc);
  };
})(typeof window !== "undefined" ? window : globalThis);
