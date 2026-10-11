# infra-sim

A self-paced, **scenario-based** course on **Docker, Kubernetes, Helm and Argo CD**, from beginner to expert, with a **simulator that runs in the browser** and a built-in AI tutor. Every lesson puts you in a terminal with a situation to build or, more often, something broken to diagnose and fix.

- **Live site:** https://johanccs.github.io/infra-recover/
- **Locally:** open `index.html` in a browser. You don't need a server, Docker or a cluster.

The sandbox models **Docker Engine 29**, **Docker Compose v5**, **Kubernetes 1.37**, **Helm 4** and **Argo CD 3**. Content was last reviewed in **October 2026**.

## Course goal

The goal is to become the person who can **fix it**: to explain how containers, Kubernetes, Helm and Argo CD work, read the evidence a broken system gives you (statuses, events, logs, exit codes), find the cause with a repeatable method, and apply the right fix in the right place.

Every lesson opens with a **🎯 Goal of this lesson** section explaining what you'll achieve and why it matters, is built around one or more **scenarios** in the sandbox, and closes with **🔑 Key takeaways** and a quiz.

## Curriculum

| Level | Lessons |
|---|---|
| **1 · Docker foundations** | 1 Containers and images · 2 Logs, exec, inspect · 3 Ports, environment variables, restart policies · 4 Building images · 5 Volumes |
| **2 · Docker networking & Compose** | 6 Container networking and DNS · 7 Docker Compose · 8 Troubleshooting Docker: a method |
| **3 · Kubernetes foundations** | 9 How Kubernetes works · 10 Pods, Deployments, self-healing · 11 Services and DNS · 12 ConfigMaps and Secrets · 13 Rollouts and rollbacks · 14 Probes, requests and limits |
| **4 · Kubernetes troubleshooting** | 15 The debugging loop · 16 Pending pods · 17 Broken networking: Services, Ingress, policies · 18 Storage and stateful apps · 19 Namespaces, RBAC, quotas |
| **5 · Helm** | 20 Charts, releases, values · 21 Writing and debugging charts · 22 Upgrades, rollbacks, broken releases |
| **6 · Argo CD & GitOps** | 23 Your first Application · 24 Sync policies, drift, rolling back with git · 25 Troubleshooting Argo CD, and the capstone |

## Scenarios

There are **51 scenarios**: 22 guided hands-on ones and **29 fix-it scenarios** in which something is already broken. They cover every tool and run from easy to expert:

| Tool | Examples of fix-it scenarios |
|---|---|
| Docker | A database that exits at once · a published port that resets · a port conflict · a Dockerfile that fails to build and then crashes · data lost on redeploy · `ENOTFOUND db` · a Compose stack with three typos · exit code 137 · a host with four simultaneous faults |
| Kubernetes | A manifest the API server rejects · Service without endpoints · `CreateContainerConfigError` · a stuck rollout · `OOMKilled` · Running but 0/1 Ready · ImagePull, CrashLoop and RunContainer errors · Pending pods · wrong `targetPort` · Ingress 404 and 503 · a NetworkPolicy timeout · an unbound PVC · `Forbidden` · a quota that blocks pods |
| Helm | A chart that won't render (template error, then YAML error) · a release stuck in `pending-upgrade` |
| Argo CD | Drift · a bad commit under self-heal · `ComparisonError` · a three-application launch-day incident |

Each scenario has tasks that are **checked automatically** as you type, **hints** per task, a **diagnosis question**, the full **solution**, and an explanation of **why the fix works**. All of them are also available on one page, the [scenario library](https://johanccs.github.io/infra-recover/sandbox.html), together with an empty free-play sandbox.

## The simulator

The sandbox is a simulation written in plain JavaScript (`assets/js/sim/`). No container, cluster or server is involved: commands change a model that lives in the page, and reloading resets it. It is built to make the behaviour that matters for learning and troubleshooting realistic.

| Tool | Modelled | Not modelled |
|---|---|---|
| Shell | Files, pipes, redirects, `&&`, `$(…)`, heredocs, `grep`, `sed -i`, simple `awk`, `curl`, an editor dialog for `nano`/`vi` | A real Linux system, installing software, interactive programs |
| Docker 29 | Registries and pulls, container lifecycle, logs, exec, inspect (with Go templates), ports, env, restart policies, memory limits and OOM kills, volumes and bind mounts, networks and DNS, BuildKit-style builds with layer cache and multi-stage, Compose | Running your own code (a few practice apps behave realistically), CPU limits, Swarm |
| Kubernetes 1.37 | 3 nodes; scheduler (requests, selectors, taints, cordon); kubelet (image pulls, crash loops with back-off, probes, OOM); Deployments and rolling updates, StatefulSets, DaemonSets, Jobs, CronJobs; Services, endpoints and DNS; Ingress (Traefik); NetworkPolicy (ingress); ConfigMaps and Secrets; PVC/PV/StorageClass; RBAC with impersonation; quotas; strict manifest validation with the API server's error messages | Custom resources other than Argo CD's, autoscaling, egress policies, node failures, admission webhooks |
| Helm 4 | Repositories, Go templates with the common Sprig functions, values handling, releases and history, upgrade, rollback, `--wait`, `--rollback-on-failure`, lint, template | Subcharts, hooks, OCI registries, packaging |
| Argo CD 3 | Applications from directories and Helm charts, projects, sync status and health, manual and automated sync, prune, self-heal, diff, history, rollback; a small git (clone, status, diff, commit, push, revert) | The web UI, ApplicationSets, sync hooks, Kustomize, several clusters |

Simulated time runs at normal speed while you read and fast-forwards while a command waits (`sleep 30` returns in a few seconds). Output formats follow the versions named above and can differ slightly from your own installation.

The practice images (`shop/web`, `shop/api`), the chart repository `https://charts.shop.example` and the git repository `https://git.shop.example/shop/gitops.git` exist only inside the sandbox.

## Other features

- **Full-text search** across all lessons (press <kbd>/</kbd>).
- **Progress tracking** for lessons and solved scenarios, stored in your browser.
- **Light and dark themes** that follow your OS setting.
- Works on **phones**, and **prints** cleanly.
- **Accessible**: WCAG 2.1 AA checked automatically in both themes, including a running terminal. Keyboard navigable, with a skip link and screen-reader labels.
- **✨ AI tutor**: select text, right-click, and ask (see below).

## ✨ AI tutor (OpenAI)

Select any text on a page, including terminal output, and **right-click it**, or click the floating **✨ Ask AI** button, to open a question form. You can also use **✨ Ask AI** in the top bar to ask about the current lesson. Shift + right-click still opens the browser's normal menu.

**Setup:** click **⚙** in the AI window, paste your OpenAI API key, then click **Test connection**. Use **Load my models** to pick from the models your key can access.

What the assistant does for accuracy:

- Uses the OpenAI **Responses API** with a tutor prompt focused on Docker, Kubernetes, Helm and Argo CD. It's told that the sandbox is a simulation and which versions it models, never to invent commands, flags or error messages, to flag course text that looks wrong or outdated, and to say when it's unsure.
- Sends the **lesson context** with each question: the lesson title and goal, the section heading, the selected passage and its surrounding paragraph.
- Sends your **recent sandbox terminal output**, so "explain my last error" and "give me a hint" work without copying anything.
- Optionally **verifies answers with web search** and lists the **sources** it cited. This is on by default.
- Has a configurable **reasoning effort**, and falls back gracefully when a model doesn't support an option.

**Security notes:**

- The key is stored **only in your browser** (localStorage, or sessionStorage if "remember" is off) and is sent only to the configured API base URL. It is never written to this repository. Don't commit keys.
- Anyone using the same browser profile can read the key. Create a dedicated key with a **spending limit**.
- If the site is public, **don't distribute a key**. Each visitor uses their own, or you point **Advanced → API base URL** at your own backend proxy that holds the key server-side.
- Requests are sent with `store: false`. Answers are rendered through DOMPurify, and every page ships a Content-Security-Policy.

## Publishing with GitHub Pages

The site is served straight from the **`main` branch**: changes are pushed directly to `main`, and every push publishes automatically. There are no GitHub Actions workflows. The generated files (`lessons/`, `assets/js/infra-sim.js`, `assets/js/search-index.js`) are committed alongside their sources, so before you push, run the [quality checks](#quality-checks) and commit what `python3 build.py` regenerates.

Pages setting: **Settings → Pages → Source: Deploy from a branch → `main` / (root)**.

### Versioning

The version appears in the top bar of every page. On each release, bump `VERSION` in `assets/js/course.js` and `version` in `package.json` together (the tests check they match): patch for fixes, minor for new lessons, scenarios or simulator features, major for a course restructure.

## Development

```
index.html                 course home page
sandbox.html               scenario library and free-play sandbox
404.html                   not-found page (GitHub Pages)
lessons/*.html             generated lesson pages (don't edit by hand)
src/lessons/*.html         lesson sources
assets/css/course.css      styles and design tokens (light/dark, WCAG AA contrast)
assets/js/course.js        navigation, search, progress, quizzes, copy buttons
assets/js/terminal.js      browser terminal, editor dialog, scenario panel
assets/js/sandbox.js       scenario library page
assets/js/ai-assistant.js  right-click AI tutor (OpenAI Responses API)
assets/js/sim/             the simulator (no DOM access; also runs under Node)
  core.js                  clock, virtual file system, shell, networking
  images.js                image catalogue and the simulated applications
  tmpl.js                  Go template subset (Helm, docker --format)
  docker.js, docker-build.js   Docker engine, CLI, build, Compose
  k8s.js                   API store, validation, controllers, scheduler, kubelet, networking
  kubectl.js, kubectl2.js  the kubectl CLI
  helm.js                  Helm client and the course chart repository
  argocd.js                git and Argo CD
  labkit.js                helpers for scenarios
assets/js/labs-*.js        the scenarios (setup, tasks, checks, hints, solution, explanation)
assets/js/infra-sim.js     generated bundle of the simulator and scenarios
assets/js/search-index.js  generated full-text search index
build.py                   builds src/lessons → lessons, the bundle and the search index
tests/lab-tests.mjs        plays every scenario's documented solution headlessly
tests/lesson-commands.mjs  runs every command shown in the lessons through the simulator
tests/run-tests.mjs        end-to-end, accessibility, sandbox and AI tutor tests
```

### Editing a lesson

Edit the file in `src/lessons/`, then run `python3 build.py`. Sources are plain HTML with four shortcuts: fenced code blocks (`` ```bash ``), inline `` `code` ``, `:::quiz` blocks, and `:::lab scenario-id` to embed a scenario (see the docstring in `build.py`). To add a lesson, create a new source file and add an entry to the `LESSONS` array in `assets/js/course.js`.

### Adding a scenario

Add a `lab("id", { … })` entry to one of the `assets/js/labs-*.js` files:

- `setup(sim, h)` prepares the starting state (for fix-it scenarios: the broken state).
- `tasks` each have a `text`, an optional `hint`, and a `check(sim, h)` function that inspects the simulator's state.
- `diagnose` is an optional multiple-choice question about the root cause.
- `solution` is the list of commands (and file contents) that solves it, and `explain` says why the fix works.

`node tests/lab-tests.mjs your-id -v` sets the scenario up, verifies that it does not start solved, plays the solution and verifies that every task is then satisfied. A scenario whose documented solution does not work fails the test suite, so the solutions shown to learners are always ones that have been executed.

### Quality checks

```bash
python3 build.py                     # regenerate lessons, the simulator bundle and the search index
npm ci && npx playwright install chromium
npm run validate                     # HTML validation (html-validate)
npm test                             # all 51 scenarios and every lesson command in the simulator, then in a real
                                     # browser: pages, links, axe WCAG 2.1 AA (light and dark), search, progress,
                                     # the sandbox, AI tutor (mocked), 404
```

There's no CI, so run these before every push. After `python3 build.py`, `git status` should show no changes under `lessons/`, `assets/js/infra-sim.js` or `assets/js/search-index.js` that you haven't committed.

### Content review process

Each review checks lessons against the current release notes and documentation of the four tools, runs every command shown in a lesson through the simulator, verifies all external links and their anchors, and re-runs the automated checks. Version-specific behaviour is verified against upstream sources (for example, Docker 29's `docker image ls` layout, kubectl's `deleted from … namespace` output since 1.34, Helm 4's `--rollback-on-failure`, and the retirement of ingress-nginx in March 2026). The last review was October 2026.

## Sources

The course content is based on the official documentation below and on established community practice. Each lesson's **Further reading** section links to the pages relevant to it.

- [Docker documentation](https://docs.docker.com/), in particular the [CLI reference](https://docs.docker.com/reference/cli/docker/), the [Dockerfile reference](https://docs.docker.com/reference/dockerfile/), [Compose file reference](https://docs.docker.com/reference/compose-file/) and the [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- [Kubernetes documentation](https://kubernetes.io/docs/home/), in particular [Concepts](https://kubernetes.io/docs/concepts/), [Debugging](https://kubernetes.io/docs/tasks/debug/) and the [kubectl reference](https://kubernetes.io/docs/reference/kubectl/)
- [Kubernetes release notes](https://kubernetes.io/releases/) and changelogs
- [Helm documentation](https://helm.sh/docs/), in particular the [chart template guide](https://helm.sh/docs/chart_template_guide/getting_started/)
- [Argo CD documentation](https://argo-cd.readthedocs.io/en/stable/)
- [OpenGitOps principles](https://opengitops.dev/)
