# Tests

Five scripts. Run them from the `tutorials` folder (in Ubuntu). They never touch the real OpenAI API.

| Script | What it proves | Needs |
|--------|----------------|-------|
| `node tests/pages.test.js` | `server.js` and every page work (including the SQLite backup of notes, bookmarks, place and ticks, tested against a temporary database): security checks, step numbering, progress, copy buttons, layout at 3 widths, dark mode, and the right-click Ask box (streaming, Markdown, error messages) against a fake OpenAI | `playwright-core` and a Chromium it can launch |
| `node tests/content.test.js` | The files the tutorials tell you to create work as written: Helm chart lints and renders, manifests are valid Kubernetes, the CI workflow lints and its `sed` edits the chart, Dockerfiles lint, every bash block parses, and the .NET API builds with no warnings and answers every request the tutorial makes | Optional tools, each skipped if missing: `helm`, `kubeconform`, `actionlint`, `hadolint`, `dotnet`. Set `TOOLS_DIR` if they are not on `PATH` |
| `node tests/monitoring.test.js` | Part 2 (Eyes on the Cluster) works as written: the API builds with its OpenTelemetry packages and serves `/metrics`, the fault switches fail, slow and crash the app as described, the chart and the Prometheus, Loki and Alloy values render with their pinned chart versions, every PromQL query parses, and the alert rules fire (or stay quiet) on synthetic data | .NET SDK, `helm`, `kubeconform`, `promtool`, `alloy`, internet (each is skipped if missing) |
| `node tests/platform.test.js` | Part 3 (Platform as Code) works as written: the Argo CD Applications and AppProject are valid and consistent with each other and with parts 1 and 2, `infra/bootstrap.sh` runs its steps in order (against stand-in tools), and the pull request check renders the pinned charts, fails on the loud mistakes and passes the quiet one, exactly as the drills say | `helm`, `kubeconform`, `actionlint`, `yq`, internet (each is skipped if missing) |
| `node tests/links.js` | Every link in `docs/` still opens | `curl`, internet |

The API test needs a PostgreSQL to talk to: set `TUTORIAL_PG` to a connection string such as `Host=localhost;Port=5432;Database=todo;Username=todo;Password=dev` (for example the container from step 2 of the tutorial). Without it the database-down checks still run and the rest is skipped.

`node tests/content.test.js --angular` also runs `npx @angular/cli@22 new` and `ng build` with the tutorial's UI files (a few minutes, needs Node 22.22.3+ or 24).

`node tools/sync-menu.js` rewrites the Tutorials menu in every page from `tools/pages.json`. Add a new tutorial to that file, run the script, and add its details to `PAGES` in `pages.test.js`.

`tests/extract.js` is the helper that copies each code block's file out of a tutorial page: `node tests/extract.js docs/code-to-cluster-tutorial.html out-dir`.

Not covered, because they need Docker and a cluster: `docker build`, `kind`, a live Argo CD sync, a real GitHub Actions run. The steps for those were checked against the official docs instead.
