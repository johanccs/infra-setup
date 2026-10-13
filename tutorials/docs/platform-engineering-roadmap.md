# Platform Engineering Roadmap (.NET developer → platform engineer)

**Platform engineering** = building the "paved road" other developers deploy on: templates, pipelines, clusters, self-service tools and guardrails. Your customers are developers like you are today — that's your advantage.

**Time:** roughly 9–12 months alongside a full-time job.

> Links checked 9 October 2026: every link opens (O'Reilly blocks automated checks). Descriptions were written from memory unless noted. Tools marked ★ are also in `playground.md`.

---

## Phase 1 — Linux and containers (1–2 months)

**Learn:** shell, processes, file permissions, networking basics (DNS, ports, TLS), Dockerfiles, image layers, multi-stage builds.

| Resource | Type | Link |
|----------|------|------|
| iximiuz Labs ★ | Hands-on Linux/container labs | [labs.iximiuz.com](https://labs.iximiuz.com/) |
| SadServers ★ | Fix broken Linux servers | [sadservers.com](https://sadservers.com/) |
| OverTheWire Bandit ★ | Linux game over SSH | [overthewire.org/wargames/bandit](https://overthewire.org/wargames/bandit/) |
| Docker docs: Get started | Official tutorial | [docs.docker.com/get-started](https://docs.docker.com/get-started/) |
| .NET container images (incl. chiseled) | Microsoft docs | [learn.microsoft.com/dotnet/core/docker/introduction](https://learn.microsoft.com/en-us/dotnet/core/docker/introduction) |

**.NET project:** containerize a .NET API with a multi-stage Dockerfile and a chiseled (minimal) base image. Compare image sizes.

---

## Phase 2 — Kubernetes (2–3 months)

**Learn:** Pods, Deployments, Services, Ingress, ConfigMaps/Secrets, liveness/readiness probes, resource requests/limits, RBAC, namespaces.

| Resource | Type | Link |
|----------|------|------|
| Killercoda ★ | Free browser K8s scenarios | [killercoda.com](https://killercoda.com/) |
| kind | Kubernetes in Docker on your laptop | [kind.sigs.k8s.io](https://kind.sigs.k8s.io/) |
| k3d | Lightweight local K8s (k3s in Docker) | [k3d.io](https://k3d.io/) |
| Kubernetes docs: Tutorials | Official | [kubernetes.io/docs/tutorials](https://kubernetes.io/docs/tutorials/) |
| KodeKloud ★ | Labs + CKAD course | [kodekloud.com](https://kodekloud.com/) |
| CKAD certification | Exam (hands-on, in terminal) | [training.linuxfoundation.org (CKAD)](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/) |
| *Kubernetes: Up and Running* (O'Reilly) | Book | [oreilly.com](https://www.oreilly.com/library/view/kubernetes-up-and/9781098110192/) |

**.NET project:** deploy your API to kind with health-check endpoints (`MapHealthChecks`), probes, graceful shutdown, and config from ConfigMaps/Secrets.

---

## Phase 3 — Infrastructure as code (1–2 months)

**Learn:** Terraform state, modules, `plan`/`apply`, variables and outputs, remote state, drift.

| Resource | Type | Link |
|----------|------|------|
| HashiCorp Terraform tutorials | Official, free | [developer.hashicorp.com/terraform/tutorials](https://developer.hashicorp.com/terraform/tutorials) |
| Terraform Academy ★ (from search) | Browser labs | [terraformacademy.app](https://www.terraformacademy.app/) |
| Rover ★ | Visualize a `terraform plan` | [github.com/im2nguyen/rover](https://github.com/im2nguyen/rover) |
| AWS Free Tier | Your own sandbox account | [aws.amazon.com/free](https://aws.amazon.com/free/) |

**.NET project:** provision the API's database and a small cluster from Terraform. Destroy and recreate it to prove it's reproducible. (Use a personal account and set a billing alert.)

---

## Phase 4 — CI/CD and GitOps (1–2 months)

**Learn:** pipelines as code, build → test → scan → publish → deploy, Helm and Kustomize, Argo CD (cluster pulls its desired state from Git), promoting between environments (dev → cert → prod).

| Resource | Type | Link |
|----------|------|------|
| Killercoda Argo CD scenarios ★ (from search) | Browser GitOps labs | [killercoda.com](https://killercoda.com/) |
| Argo CD docs: Getting started | Official | [argo-cd.readthedocs.io](https://argo-cd.readthedocs.io/en/stable/getting_started/) |
| Helm docs | Official | [helm.sh/docs](https://helm.sh/docs/) |
| Kustomize | Official | [kustomize.io](https://kustomize.io/) |
| GitHub Skills (Actions) ★ | Guided courses | [skills.github.com](https://skills.github.com/) |
| `act` ★ | Run GitHub Actions locally | [github.com/nektos/act](https://github.com/nektos/act) |

**.NET project:** one pipeline that builds, runs tests, scans the image (e.g. Trivy), pushes to a registry, and lets Argo CD deploy to a dev namespace, then promotes to a cert namespace.

---

## Phase 5 — Observability (1 month)

**Learn:** metrics, logs, traces; Prometheus, Grafana, OpenTelemetry; SLOs and alerting.

| Resource | Type | Link |
|----------|------|------|
| OpenTelemetry for .NET | Official docs | [opentelemetry.io/docs/languages/dotnet](https://opentelemetry.io/docs/languages/dotnet/) |
| kube-prometheus-stack | Helm chart: Prometheus + Grafana | [github.com/prometheus-community/helm-charts](https://github.com/prometheus-community/helm-charts) |
| .NET Aspire dashboard | Local OTel dashboard for .NET | [learn.microsoft.com/dotnet/aspire](https://learn.microsoft.com/en-us/dotnet/aspire/) |

**.NET project:** instrument your API with OpenTelemetry (traces + metrics), view them in Grafana, and add one alert.

---

## Phase 6 — Platform thinking (ongoing)

**Learn:** golden paths, internal developer portals, service templates, platform-as-a-product, developer experience, DORA metrics.

| Resource | Type | Link |
|----------|------|------|
| *Team Topologies* (Skelton & Pais) | Book — why platform teams exist | [teamtopologies.com](https://teamtopologies.com/) |
| *Platform Engineering* (Fournier & Nottingham, O'Reilly 2024) | Book | [oreilly.com](https://www.oreilly.com/library/view/platform-engineering/9781098153632/) |
| CNCF Platforms white paper | Free paper | [tag-app-delivery.cncf.io/whitepapers/platforms](https://tag-app-delivery.cncf.io/whitepapers/platforms/) |
| platformengineering.org | Community, talks, blog | [platformengineering.org](https://platformengineering.org/) |
| Backstage | Open-source developer portal | [backstage.io](https://backstage.io/) |
| DORA | Delivery performance metrics | [dora.dev](https://dora.dev/) |

**.NET project:** a `dotnet new` template plus a reusable pipeline so a team can go from "new service" to "running in dev" in a day.

---

## Hands-on project: Code to Cluster tutorial (start here, free)

`code-to-cluster-tutorial.html` (in this folder; double-click `Open Tutorial.cmd` in the project folder to serve it at http://localhost:8788) is the easiest end-to-end walk through phases 1, 2 and 4, all on your own PC at no cost: .NET 10 API + Angular 22 UI + PostgreSQL → Docker → Helm chart on a local `kind` cluster → GitHub Actions builds images into Docker Hub and commits the new tag → Argo CD deploys it, then a rollback with `git revert`. Do this one before the EKS tutorial below.

---

## Hands-on project: Todo on EKS tutorial

`todo-on-eks-tutorial.html` (in this folder) walks phases 1–4 end to end with one small app: .NET 10 API + Angular 22 UI → Docker → ECR → EKS (Helm) → Argo CD, then a release and a `git revert` rollback. Every step explains *why* it exists, includes line-by-line breakdowns of each file, and has a "What you just learned" box. Both tutorials let you right-click any text to ask a question when they are served by `server.js` with `OPENAI_API_KEY` set.

**Cost on real AWS:** about $0.30/hour while the cluster exists (approximate). Do the AWS steps in one sitting and always run the clean-up step.

**Planned improvements:** "break it" exercises (bad image tag, failing probe, deleted pod), a `kubectl` debugging cheat sheet, and a two-question self-check per step. (The free local track and the GitHub Actions CI step now live in the Code to Cluster tutorial.)

---

## Practising without AWS (free)

Everything except the image registry and the cluster already runs on your PC. Swap those two for local equivalents.

### Option A: `kind` (recommended first)

`kind` = real Kubernetes running inside Docker containers. Free, starts in about a minute, easy to reset.

| Tutorial step | With AWS | Without AWS (kind) |
|---------------|----------|--------------------|
| Tools | AWS CLI, eksctl | Not needed; install [kind](https://kind.sigs.k8s.io/) |
| Image registry | Push to ECR | Skip; `kind load docker-image` copies images into the cluster |
| Cluster | `eksctl create cluster` (~20 min, paid) | `kind create cluster` (~1 min, free) |
| Helm values | `registry:` = ECR address | `registry: local`, `ui.serviceType: ClusterIP` |
| Reaching the site | AWS load balancer URL | `kubectl port-forward svc/todo-ui 8080:80` → http://localhost:8080 |
| Argo CD, release, rollback | Same | Same (Argo CD still reads your GitHub repo) |
| Clean up | Careful ordering to avoid bills | `kind delete cluster` |

```bash
kind create cluster --name todo
docker build -t local/todo-api:1.0.0 ./api
docker build -t local/todo-ui:1.0.0 ./ui
kind load docker-image local/todo-api:1.0.0 local/todo-ui:1.0.0 --name todo
helm upgrade --install todo charts/todo -n todo --create-namespace \
  --set registry=local --set ui.serviceType=ClusterIP
kubectl -n todo port-forward svc/todo-ui 8080:80
```

Docker Desktop's built-in Kubernetes (Settings → Kubernetes → Enable) also works, but kind is more predictable and easier to reset.

**What you won't learn locally:** ECR permissions, VPCs and subnets, real load balancers, how nodes get permission to pull images. Everything about Kubernetes, Helm, Argo CD and GitOps is identical.

### Option B: AWS emulators (to practise the AWS commands)

| Emulator | Cost | ECR / EKS | Notes |
|----------|------|-----------|-------|
| **Floci** | Free, open source (MIT), no account, works offline | ECR = a real image registry (`docker push`/`pull` work); EKS = runs k3s (real lightweight Kubernetes) | Promising. Unconfirmed: whether `eksctl` works (probably not fully, so use `aws eks create-cluster`), whether load balancers are emulated, maturity (2026 project). Point the CLI at it with `aws --endpoint-url http://localhost:4566 …` |
| LocalStack | Free Hobby plan (non-commercial use only); Starter $39/month | **Paid-only** since Feb 2026 | The Community Docker image ended March 2026; the single image now needs an account and auth token |
| LocalEmu | Free | Claims ECR and EKS | Small, newer project; unverified |

Emulators teach the AWS CLI commands, and are useful later for fast, free Terraform or AWS SDK tests. They **don't** faithfully reproduce IAM permissions, networking or AWS error behaviour.

### Recommended order

1. **Learn Kubernetes, Helm and Argo CD on kind.** Free, real Kubernetes, and the part that takes longest.
2. *(Optional)* Practise the ECR/EKS commands against **Floci**.
3. **Do one planned session on real AWS** (~1 hour of cluster time, roughly $0.30–0.50, budget alert on). Real AWS teaches the real permission errors and networking that emulators smooth over.

Sources: [kind](https://kind.sigs.k8s.io/) · [Floci (author's blog)](https://hectorvent.dev/posts/introducing-floci/) · [Floci vs LocalStack review](https://wavect.io/blog/floci-vs-localstack-aws-emulator/) · [LocalStack pricing](https://www.localstack.cloud/pricing) · [LocalStack 2026 pricing changes](https://blog.localstack.cloud/2026-upcoming-pricing-changes/) · [LocalEmu](https://localemu.cloud/docs/story/)

---

## Security (thread through every phase)

| Resource | Type | Link |
|----------|------|------|
| Kubernetes Goat ★ | Vulnerable cluster to attack | [madhuakula.com/kubernetes-goat](https://madhuakula.com/kubernetes-goat/) |
| flAWS / flAWS2 ★ | AWS misconfiguration challenges | [flaws.cloud](http://flaws.cloud/) |
| Trivy | Image and IaC scanning | [trivy.dev](https://trivy.dev/) |

---

## What to add next: platform engineering, enterprise development and enterprise systems

Written 13 October 2026. The tutorials so far cover CI/CD, fix and setup, Git, monitoring, security, scaling, Terraform and (planned) auth. The three biggest gaps are **self-service (portal and templates), messaging, and data**. This comes from comparing what exists with CNCF's list of platform capabilities, its platform engineer exam, DORA's capabilities and Microsoft's cloud design patterns.

| Area | Module | What you would learn | Why it belongs |
|---|---|---|---|
| Platform engineering | **Golden paths and self-service** | A `dotnet new` service template, a developer portal (Backstage), platform APIs with custom resources | A quarter of the CNCF platform engineer exam, and Phase 6 of the existing learning roadmap has no tutorial yet |
| | **Progressive delivery** | Canary and blue-green releases, feature flags, automatic rollback on metrics | Part of the exam's largest domain; builds on the Argo CD work |
| | **Reliability (SRE)** | SLOs and error budgets, incident response, postmortems, chaos drills, backup and restore | The exam's operations domain; the monitoring part stops at alerts |
| | **Environments, tenancy and cost** | Dev to UAT to prod, a preview environment per pull request, quotas, cost per team | In the exam's architecture domain; one 2026 survey links preview environments and cost control to better delivery |
| Enterprise systems | **Messaging and events** | Queues and topics, outbox, idempotent consumers, sagas, dead-letter queues | A CNCF platform capability, and many of Microsoft's 44 cloud patterns are messaging patterns |
| | **Data in production** | Schema changes without downtime, restore drills, replication, caching | A CNCF capability; "database change management" is a core DORA capability |
| | **Resilience between services** | Timeouts, retry, circuit breaker, rate limiting, tracing a request across services | Microsoft's reliability patterns; needs a second service, which messaging adds |
| Enterprise development | **Architecture and API design** | Modular monolith versus microservices, API versioning and contracts, replacing a legacy system step by step | The design decisions the patterns above depend on |
| | **Testing strategy** | Integration tests against real dependencies, contract tests, test data | "Test automation" and "test data management" are core DORA capabilities |

One optional extra is running AI workloads on the platform. The 2026 industry surveys are dominated by it, but they are vendor-sponsored.

### Suggested order

After the Identity and Access Lab:

1. **Golden paths and self-service**, because it is what turns the earlier parts into a platform other developers can use.
2. **Messaging and events**, because it adds a second service, which resilience, tracing and sagas all need.
3. **Data in production**.

The other six can follow in any order.

Sources, read on 13 October 2026:

Read on 13 October 2026.

- [CNCF Platforms white paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/): its 13 platform capabilities.
- [CNCF Certified Cloud Native Platform Engineer (CNPE)](https://www.cncf.io/training/certification/cnpe/) and the [Linux Foundation CNPE page](https://training.linuxfoundation.org/certification/certified-cloud-native-platform-engineer-cnpe/): the five exam domains and their weights.
- [DORA capabilities](https://dora.dev/capabilities/): the 34 capabilities, including the core ones named above.
- [Microsoft cloud design patterns](https://learn.microsoft.com/en-us/azure/architecture/patterns/): the 44-pattern catalog.
- [Puppet State of DevOps: Platform Engineering Edition 2026](https://www.puppet.com/resources/2026-state-of-platform-engineering), [Perforce 2026 platform engineering report](https://www.perforce.com/press-releases/state-of-platform-engineering-2026) and [State of Platform Engineering Vol. 4](https://platformengineering.org/blog/announcing-the-state-of-platform-engineering-vol-4): the 2026 surveys. Vendor-sponsored or small samples.

---

## Habits that matter more than courses

1. **Volunteer for platform work at your job.** Ask for shared pipeline templates and cluster work.
2. **Build one end-to-end project in public.** .NET API + Terraform + Kubernetes + Argo CD + Helm + OpenTelemetry. Worth more than any certificate.
3. **Get one certificate for structure.** CKAD first; later CKA or AWS Solutions Architect Associate.
4. **Write it down.** A short doc after each phase locks it in and shows your manager what you can do.

## Progress checklist

- [ ] Phase 1: .NET API containerized with a chiseled image
- [ ] Phase 2: API running on kind with probes and config; CKAD booked
- [ ] Phase 3: infrastructure created and destroyed from Terraform
- [ ] Phase 4: pipeline + Argo CD deploying dev → cert
- [ ] Phase 5: traces and metrics in Grafana, one alert
- [ ] Phase 6: service template + reusable pipeline used by someone else
- [ ] CKAD passed
