# Advanced Git & IT Playgrounds

> **Links checked 9 October 2026:** every link opens. O'Reilly, Udemy and LeetCode block automated checks, so those three were not confirmed. The notes under each table say which descriptions came from a search and which were written from memory.

## Courses

| # | Resource | Type | Cost | Covers | Time | Link |
|---|----------|------|------|--------|------|------|
| 1 | Git Katas (Eficode) | Hands-on exercises in local repos | Free | revert, reset, cherry-pick, interactive rebase, reverted merges, squashing, bisect | ~1 week, 1–2 hrs/day | [github.com/eficode-academy/git-katas](https://github.com/eficode-academy/git-katas) |
| 2 | Learn Git Branching | Visual browser game | Free | cherry-pick, interactive rebase, reset vs revert, rewriting history that's already pushed | 2–3 hrs | [learngitbranching.js.org](https://learngitbranching.js.org/) |
| 3 | Frontend Masters: Git In-Depth | Video course | Paid | merge strategies, rebase, cherry-pick, bisect, recovering lost work | ~6 hrs | [frontendmasters.com/courses/git-in-depth](https://frontendmasters.com/courses/git-in-depth/) |
| 4 | Udemy: GIT Advanced commands | Video course | Paid (cheaper alternative to #3) | cherry-pick, rebase, revert, stash, squash, reset | — | [udemy.com/course/git-advanced-commands](https://www.udemy.com/course/git-advanced-commands/) |
| 5 | Pro Git (book), ch. 2.4 & 7 | Book | Free | the standard reference: rewriting history, reset in depth, advanced merging | — | [git-scm.com/book](https://git-scm.com/book/en/v2) |
| 6 | Atlassian Git Tutorials: Undoing changes | Articles | Free | reset vs revert vs checkout, explained clearly | 1–2 hrs | [atlassian.com/git/tutorials/undoing-changes](https://www.atlassian.com/git/tutorials/undoing-changes) |
| 7 | Oh My Git! | Game | Free | visual repo internals, then a real terminal | 2–4 hrs | [ohmygit.org](https://ohmygit.org/) |
| 8 | Oh Shit, Git!?! | Cheat sheet | Free | quick fixes for common messes (a reference, not a course) | — | [ohshitgit.com](https://ohshitgit.com/) |
| 9 | Pluralsight: How Git Works / Mastering Git (Paolo Perrotta) | Video course | Paid (check employer licence) | Git internals, so revert and reset make sense instead of being memorised | — | [pluralsight.com](https://www.pluralsight.com/) |
| 10 | LinkedIn Learning: Git Intermediate Techniques (Kevin Skoglund) | Video course | Paid (check employer licence) | rebase, cherry-pick, reset, reflog, bisect | — | [linkedin.com/learning](https://www.linkedin.com/learning/) |

> Rows 5–10 were added from memory, not from a search. Their links open, but check titles and prices before you buy.

## Katas for undoing a change that's already merged to main

| Kata | Skill | Key command | Link |
|------|-------|-------------|------|
| `basic-revert` | Safely undo one commit on a shared branch | `git revert <sha>` | [basic-revert](https://github.com/eficode-academy/git-katas/tree/master/basic-revert) |
| `reverted-merge` | Undo an entire merged PR, and what goes wrong when you merge that branch again | `git revert -m 1 <merge-sha>` | [reverted-merge](https://github.com/eficode-academy/git-katas/tree/master/reverted-merge) |
| `reset` | `--soft` vs `--mixed` vs `--hard` (only on history you haven't pushed) | `git reset --soft/--mixed/--hard <sha>` | [reset](https://github.com/eficode-academy/git-katas/tree/master/reset) |
| `basic-cherry-pick` | Copy specific commits to another branch | `git cherry-pick <sha>` | [basic-cherry-pick](https://github.com/eficode-academy/git-katas/tree/master/basic-cherry-pick) |
| `advanced-rebase-interactive` | Reorder, edit, squash or drop commits | `git rebase -i <base>` | [advanced-rebase-interactive](https://github.com/eficode-academy/git-katas/tree/master/advanced-rebase-interactive) |
| `bad-commit` | Find the commit that broke something | `git bisect` | [bad-commit](https://github.com/eficode-academy/git-katas/tree/master/bad-commit) |
| (any) | Get back commits after a bad `reset --hard` | `git reflog` | [git-reflog docs](https://git-scm.com/docs/git-reflog) |

## Visual git playgrounds

| Tool | Type | Cost | Notes | Link |
|------|------|------|-------|------|
| Visualizing Git (Git School) | Browser sandbox | Free | Commit graph redraws live as you type. Supports reset, revert, cherry-pick, rebase, reflog | [github.com/git-school/visualizing-git](https://github.com/git-school/visualizing-git) |
| Explain Git with D3 | Browser sandbox | Free | The project Visualizing Git grew out of. Guided examples per command | [onlywei.github.io/explain-git-with-d3](https://onlywei.github.io/explain-git-with-d3/) |
| A Grip On Git | Visual tutorial | Free | Scrolls like a story rather than a sandbox | [agripongit.vincenttunru.com](https://agripongit.vincenttunru.com/) |
| Git Simulator (naveedeme) | Browser sandbox | Free | Guided scenarios for merge conflicts, rebase, cherry-pick, bisect. Works offline | [naveedeme.github.io/git-simulator](https://naveedeme.github.io/git-simulator/) |
| Git Learner Playground | Browser sandbox | Free | Terminal plus file explorer, branch graph and git-flow view | [gitlearner.com/playground](https://gitlearner.com/playground) |
| FWDtools Git Playground | Browser lessons | Free | 43 lessons: commits, merge conflicts, rebase, stash | [fwdtools.com/git-playground](https://fwdtools.com/git-playground/) |
| GitMastery | Game | Free | Game-style challenges with set learning paths | [gitmastery.me](https://gitmastery.me/) |
| WebUtility Git Simulator | Browser sandbox | Free | Simple sandbox for free practice | [webutility.io/git-simulator-online](https://webutility.io/git-simulator-online) |
| gat Graph | Graph viewer | Free | Interactive viewer for repository graphs | [graph.gat.sh](https://graph.gat.sh/) |
| git-sim | CLI on your own repos | Free | Put `git-sim` in front of a git command to see before/after images without changing anything. `pip install git-sim` (Python 3.10+) | [initialcommit.com/tools/git-sim](https://www.initialcommit.com/tools/git-sim) |
| Git Graph / GitLens | VS Code extensions | Free | Live commit graph inside VS Code | VS Code Marketplace |
| GitKraken | Desktop git client | Free for public repos | Strong visual commit graph | [gitkraken.com](https://www.gitkraken.com/) |

> The browser playgrounds are newer or smaller projects and haven't been tried. Git Graph, GitLens and GitKraken were added from memory, not from a search.

## CI/CD and GitOps playgrounds

| Tool | What you get | Cost | Link |
|------|--------------|------|------|
| Killercoda | Real Kubernetes (K3s) in the browser. Argo CD/GitOps scenarios (watch reconcile), Argo Workflows, Jenkins. No login | Free | [killercoda.com](https://killercoda.com/) |
| GitHub Skills | Guided GitHub Actions courses in your own repo, with a visual graph of each pipeline run | Free | [skills.github.com](https://skills.github.com/) |
| GitLab pipeline editor | "Visualize" tab draws `.gitlab-ci.yml` stages and jobs as you edit | Free tier | [gitlab.com](https://gitlab.com/) |
| `act` | Runs GitHub Actions workflows locally in Docker | Free | [github.com/nektos/act](https://github.com/nektos/act) |
| Jenkins in Docker + Blue Ocean | Local Jenkins; Blue Ocean shows pipeline stages visually | Free | [jenkins.io](https://www.jenkins.io/) |

## Kubernetes, containers and cloud playgrounds

| Tool | What you get | Cost | Link |
|------|--------------|------|------|
| KodeKloud | Labs and a browser playground for Kubernetes, AWS, Terraform | Some free labs, mostly paid | [kodekloud.com/studio](https://kodekloud.com/studio/) |
| Play with Docker / Play with Kubernetes | Throwaway Docker/K8s environments in the browser for 4 hours | Free | [labs.play-with-docker.com](https://labs.play-with-docker.com/) |
| AWS Cloud Quest | Role-playing game that teaches AWS with real consoles | Free tier | [aws.amazon.com/training/digital/aws-cloud-quest](https://aws.amazon.com/training/digital/aws-cloud-quest/) |
| Rover | Turns a `terraform plan` into an interactive diagram | Free | [github.com/im2nguyen/rover](https://github.com/im2nguyen/rover) |

## Other IT playgrounds

| Area | Tool | Link |
|------|------|------|
| Linux | OverTheWire Bandit (game played over SSH) | [overthewire.org/wargames/bandit](https://overthewire.org/wargames/bandit/) |
| Regex | regex101 (explains each part of a pattern live) | [regex101.com](https://regex101.com/) |
| SQL | SQLBolt (interactive lessons) | [sqlbolt.com](https://sqlbolt.com/) |
| Networking | Cisco Packet Tracer (simulates a whole network) | [netacad.com](https://www.netacad.com/) |

> In the last three sections, only Killercoda and KodeKloud came from a search. Everything else was added from memory; the links open.

## More DevOps, Kubernetes and Linux platforms

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| iximiuz Labs | Hands-on labs and playgrounds for Linux, containers, Kubernetes and networking. Fresh VMs and clusters in seconds; many challenges include diagrams | Free tier, plus a paid plan | [labs.iximiuz.com/playgrounds](https://labs.iximiuz.com/playgrounds) |
| K8sVisual | Visual simulations of Kubernetes concepts (Pods, Deployments, Services) | Free | [k8svisual.com](https://k8svisual.com/) |
| DevOps Daily games | Browser games and simulators, incl. a Kubernetes networking simulator (pod-to-pod traffic, Services) | Free | [devops-daily.com/games](https://devops-daily.com/games) |
| Instruqt | 250+ interactive scenarios on Linux, containers, Kubernetes, networking | Free and paid | [instruqt.com](https://instruqt.com/) |
| SadServers | Fix broken Linux servers in a timed challenge; LeetCode for troubleshooting | Free tier | [sadservers.com](https://sadservers.com/) |
| explainshell | Paste a shell command and it labels what each part does | Free | [explainshell.com](https://explainshell.com/) |
| Mess with DNS | A real subdomain to experiment on; shows DNS queries as they arrive | Free | [messwithdns.net](https://messwithdns.net/) |

## Algorithms, SQL and web

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| VisuAlgo | Step-by-step animations of sorting, graphs, trees, hashing | Free | [visualgo.net](https://visualgo.net/) |
| SQL Murder Mystery | Solve a crime by writing SQL queries | Free | [mystery.knightlab.com](https://mystery.knightlab.com/) |
| CodinGame | Algorithm puzzles shown as games | Free | [codingame.com](https://www.codingame.com/) |
| Flexbox Froggy / Grid Garden | Games that teach CSS layout | Free | [codepip.com/games](https://codepip.com/games/flexbox-froggy/) |
| Vim Adventures | A game that teaches Vim keys | Free tier | [vim-adventures.com](https://vim-adventures.com/) |

> From a search: iximiuz, K8sVisual, DevOps Daily, Instruqt, Mess with DNS, Flexbox Froggy, CodinGame. The rest were added from memory; all links open.

## Distributed systems and system design

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| Semicolony simulators | 35+ visualizers: TCP handshake, congestion control, HTTP/2, B-tree, LSM-tree, Bloom filter, consistent hashing, Raft | Free | [semicolony.dev/simulators](https://semicolony.dev/simulators) |
| Raft (official site) | A Raft cluster running in your browser; crash nodes and watch leader election (the algorithm behind etcd, which Kubernetes uses) | Free | [raft.github.io](https://raft.github.io/) |
| Raft visualizer | Crash nodes, partition the network, watch elections and log repair | Free | [github.com/Raminshiraz/raft-visualizer](https://github.com/Raminshiraz/raft-visualizer) |
| The Secret Lives of Data | Step-by-step animated walkthrough of Raft | Free | [thesecretlivesofdata.com/raft](http://thesecretlivesofdata.com/raft/) |
| System Design Simulator | Requests flow through queues and caches, replicas fail over; swap components to see trade-offs | Free | [systemdesignsimulator.org](https://systemdesignsimulator.org/) |
| System Design Lab | Simulations for high-level and low-level design, design patterns, chaos engineering | Free | [systemdesignlab.netlify.app](https://systemdesignlab.netlify.app/) |

## Cloud and infrastructure as code

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| AWS Skill Builder games | Game-based AWS learning (Cloud Quest, Jam, security games) | Free and subscription | [skillbuilder.aws](https://skillbuilder.aws/) |
| Terraform Academy | 500+ browser Terraform labs, player-vs-player battles, cert prep | Free tier | [terraformacademy.app](https://www.terraformacademy.app/) |
| Certland Terraform lab | Real browser terminal, auto-graded | Free | [certland.net/labs/terraform-hands-on](https://certland.net/labs/terraform-hands-on/) |
| terraform-labs | Open-source offline game: quests, timed simulations, quizzes | Free | [github.com/eknatha/terraform-labs](https://github.com/eknatha/terraform-labs) |

## Hacking and security

| Tool | What it is | Cost | Level | Link |
|------|------------|------|-------|------|
| TryHackMe | Guided paths: networking, Linux, web, cryptography, blue/red team. Browser-based attack machine | Free tier, paid plan | Beginner | [tryhackme.com](https://tryhackme.com/) |
| Hack The Box | Linux/Windows/Active Directory machines; Pro Labs simulate whole company networks | Free tier, paid plan | Intermediate | [hackthebox.com](https://www.hackthebox.com/) |
| PortSwigger Web Security Academy | Web hacking labs (SQL injection, XSS, access control, etc.) from the makers of Burp Suite | Free | Beginner–advanced | [portswigger.net/web-security](https://portswigger.net/web-security) |
| picoCTF | Capture-the-flag puzzles from Carnegie Mellon | Free | Beginner | [picoctf.org](https://picoctf.org/) |
| OWASP Juice Shop | Deliberately vulnerable web shop to hack locally | Free | Beginner–advanced | [owasp.org/www-project-juice-shop](https://owasp.org/www-project-juice-shop/) |
| VulnHub | Downloadable vulnerable VMs | Free | All | [vulnhub.com](https://www.vulnhub.com/) |
| HackerDNA | Browser labs with an AI coach, no VPN | Free tier | Beginner | [hackerdna.com](https://hackerdna.com/) |
| Cybr hands-on labs | Cloud security, DevSecOps and AppSec labs on AWS, Azure, Terraform, Kubernetes | Free and paid | Intermediate | [cybr.com/hands-on-labs](https://cybr.com/hands-on-labs/) |
| flAWS / flAWS2 | Find AWS misconfigurations (S3, IAM, metadata) level by level | Free | Intermediate | [flaws.cloud](http://flaws.cloud/) |
| CloudGoat (Rhino Security) | Deploy deliberately vulnerable AWS scenarios into your own account | Free (you pay AWS costs) | Intermediate | [github.com/RhinoSecurityLabs/cloudgoat](https://github.com/RhinoSecurityLabs/cloudgoat) |
| Kubernetes Goat | Deliberately vulnerable Kubernetes cluster to attack | Free | Intermediate | [madhuakula.com/kubernetes-goat](https://madhuakula.com/kubernetes-goat/) |
| Awesome-CloudSec-Labs | Curated list of free cloud security labs and CTFs | Free | All | [github.com/iknowjason/Awesome-CloudSec-Labs](https://github.com/iknowjason/Awesome-CloudSec-Labs) |

> From a search: everything in the last three sections except The Secret Lives of Data, flAWS (named in a query but not in results), CloudGoat (same), Kubernetes Goat and the AWS Skill Builder URL, which were added from memory. Only practise hacking on these platforms or systems you own; never on work systems without written authorisation.

## Programming concepts (see code run)

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| Python Tutor | Step through code and see variables, objects, pointers and stack frames drawn live. Python, JavaScript, Java, C, C++ | Free | [pythontutor.com](https://pythontutor.com/) |
| Code Visualizer | Event loop, call stack, heap and memory layout for JavaScript, Python, C++, Java | Free | [codevisualizer.app](https://www.codevisualizer.app/) |
| Loupe | Visualizes the JavaScript event loop (async, callbacks, promises) | Free | [latentflip.com/loupe](http://latentflip.com/loupe/) |
| AST Explorer | See how a parser turns code into a syntax tree; what compilers and codemods work on | Free | [astexplorer.net](https://astexplorer.net/) |
| Compiler Explorer | Type C/C++/Rust/Go/C# and see the assembly the compiler produces | Free | [godbolt.org](https://godbolt.org/) |

## How computers work

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| Nand2Tetris (web IDE) | Build a computer from logic gates up to an OS and a game, all in the browser | Free | [nand2tetris.github.io/web-ide](https://nand2tetris.github.io/web-ide/about/) |
| Bartosz Ciechanowski | Interactive articles (e.g. how GPS, cameras and mechanical watches work) | Free | [ciechanow.ski](https://ciechanow.ski/) |
| Explorable Explanations | Hub of interactive simulations explaining concepts | Free | [explorabl.es](https://explorabl.es/) |
| Nicky Case | Interactive explainers, e.g. game theory of trust | Free | [ncase.me](https://ncase.me/) |

## Everyday DevOps helpers

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| crontab.guru | Translates a cron expression into plain English as you type | Free | [crontab.guru](https://crontab.guru/) |
| jqplay | Try `jq` filters on JSON live | Free | [jqplay.org](https://jqplay.org/) |
| RegexOne | Interactive regex lessons (pairs with regex101) | Free | [regexone.com](https://regexone.com/) |

> From a search: Python Tutor, Code Visualizer, Loupe, AST Explorer, Nand2Tetris, Explorable Explanations, Nicky Case. The rest were added from memory; all links open.

## .NET / C#

| Tool | What it is | Cost | Link |
|------|------------|------|------|
| SharpLab | Shows what the C# compiler really produces: lowered C#, IL, JIT assembly. Great for understanding async/await, `using`, LINQ, records | Free | [sharplab.io](https://sharplab.io/) |
| LINQPad | Scratchpad for C#/LINQ/EF Core; `.Dump()` draws any object as a table; shows the SQL EF generates | Free tier, paid editions | [linqpad.net](https://www.linqpad.net/) |
| .NET Fiddle | Run C# snippets in the browser and share them | Free | [dotnetfiddle.net](https://dotnetfiddle.net/) |
| Microsoft Learn (C#, ASP.NET Core) | Official modules with in-browser code editor and free sandboxes | Free | [learn.microsoft.com/training/dotnet](https://learn.microsoft.com/en-us/training/dotnet/) |
| Exercism C# track | 150+ exercises with free human mentors reviewing your code | Free | [exercism.org/tracks/csharp](https://exercism.org/tracks/csharp) |
| Dometrain (Nick Chapsas) | Advanced .NET courses: testing, performance, clean architecture, EF Core | Paid | [dometrain.com](https://dometrain.com/) |
| Visual Studio debugger tools | Parallel Stacks/Tasks windows visualize threads and async; Diagnostic Tools show memory and CPU | Included in VS | [learn.microsoft.com/visualstudio/debugger](https://learn.microsoft.com/en-us/visualstudio/debugger/) |
| BenchmarkDotNet | Measure which code is faster, with memory allocations | Free | [benchmarkdotnet.org](https://benchmarkdotnet.org/) |
| OWASP WebGoat.NET / Juice Shop | Deliberately vulnerable apps for learning secure coding | Free | [owasp.org](https://owasp.org/) |

> Polyglot Notebooks (.NET Interactive) were deprecated in March/April 2026, so they're left out. Only SharpLab came from a search; the rest were added from memory; all links open.

## SQL: interactive playgrounds (beginner to expert)

Rows marked † were added from memory; the rest came from a search. All links open.

### 1. Visual (see what the query does)

| Platform | Level | Notes | Cost | Link |
|----------|-------|-------|------|------|
| BuddySQL | Beginner | Animates how SELECT, WHERE, JOIN, GROUP BY transform rows | Free | [buddysql.seancoughlin.me](https://buddysql.seancoughlin.me/) |
| SQL Joins Visualizer | Beginner–intermediate | Venn diagrams of each join type | Free | [sqlism.com](https://sqlism.com/tools/sql-joins-visualizer) |
| explain.dalibo.com † | Advanced | Draws a PostgreSQL query plan as a diagram | Free | [explain.dalibo.com](https://explain.dalibo.com/) |

### 2. Games and stories

| Platform | Level | Notes | Cost | Link |
|----------|-------|-------|------|------|
| SQL Island † (URL) | Beginner | Escape an island using SQL (the site's certificate chain is incomplete, so some browsers warn) | Free | [sql-island.informatik.uni-kl.de](https://sql-island.informatik.uni-kl.de/) |
| SQL Murder Mystery | Beginner–intermediate | Solve a crime with JOINs | Free | [mystery.knightlab.com](https://mystery.knightlab.com/) |
| SQLNoir | Intermediate | Detective cases | Free | [sqlnoir.com](https://www.sqlnoir.com/) |
| SQL Quest | Beginner–intermediate | Practice with a game feel | Free tier | [sqlquest.app](https://sqlquest.app/) |

### 3. Lessons with a built-in editor

| Platform | Level | Notes | Cost | Link |
|----------|-------|-------|------|------|
| SQLBolt | Beginner | Short lessons | Free | [sqlbolt.com](https://sqlbolt.com/) |
| SQLZoo | Beginner–intermediate | Tutorials and quizzes | Free | [sqlzoo.net](https://sqlzoo.net/) |
| Select Star SQL † | Beginner–intermediate | Interactive book on real data | Free | [selectstarsql.com](https://selectstarsql.com/) |
| Mode SQL Tutorial † | Beginner–advanced | Analytics examples | Free | [mode.com/sql-tutorial](https://mode.com/sql-tutorial/) |
| Khan Academy: Intro to SQL † | Beginner | Video plus editor | Free | [khanacademy.org](https://www.khanacademy.org/computing/computer-programming/sql) |
| W3Schools SQL † | Beginner | "Try it" editor for every keyword | Free | [w3schools.com/sql](https://www.w3schools.com/sql/) |

### 4. Practice problems (interview-style)

| Platform | Level | Notes | Cost | Link |
|----------|-------|-------|------|------|
| PostgreSQL Exercises | Intermediate | Joins, CTEs, window functions, recursion | Free | [pgexercises.com](https://pgexercises.com/) |
| HackerRank SQL | Beginner–advanced | Badges | Free | [hackerrank.com/domains/sql](https://www.hackerrank.com/domains/sql) |
| LeetCode SQL | Intermediate–advanced | Filter by company | Free tier | [leetcode.com](https://leetcode.com/problemset/database/) |
| StrataScratch | Intermediate–advanced | Real tech-company interview questions | Free tier | [stratascratch.com](https://www.stratascratch.com/) |
| DataLemur | Intermediate–advanced | Data analyst / data science interview questions | Free tier | [datalemur.com](https://datalemur.com/) |

### 5. Blank sandboxes (run anything, share a link)

| Platform | Engines | Link |
|----------|---------|------|
| db<>fiddle (best for .NET work) | 14 engines incl. SQL Server 2017–2025, PostgreSQL, MySQL, Oracle, SQLite | [dbfiddle.uk](https://dbfiddle.uk/) |
| SQL Fiddle | SQL Server, Oracle, PostgreSQL, MySQL, SQLite | [sqlfiddle.com](https://sqlfiddle.com/sql-server/online-compiler) |
| DB Fiddle | MySQL, PostgreSQL, SQLite | [db-fiddle.com](https://www.db-fiddle.com/) |
| RunSQL | Visual schema builder, data import | [runsql.com](https://runsql.com/) |
| SQL Playground | MySQL, PostgreSQL | [sqlplayground.app](https://sqlplayground.app/) |

### 6. Advanced and expert (real SQL Server data)

| Platform | Notes | Link |
|----------|-------|------|
| Use The Index, Luke † | How indexes work and why queries are slow | [use-the-index-luke.com](https://use-the-index-luke.com/) |
| SSMS execution plans | "Include Actual Execution Plan" shows how SQL Server ran a query | Built into SQL Server Management Studio |
| SQL Server Developer Edition in Docker † | Free full SQL Server on your laptop | [Microsoft docs](https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-docker) |
| Stack Overflow database (Brent Ozar) † | Real database of tens of GB; practise tuning, locking and deadlocks | [brentozar.com](https://www.brentozar.com/archive/2015/10/how-to-download-the-stack-overflow-database-via-bittorrent/) |

Transactions, isolation levels, locking, deadlocks and query tuning on real data: no playground covers this. Learn it from your own database plus the two free Redgate books below.

### Books (free from Redgate, saved in this Documents folder)

| Book | Covers | File | Link |
|------|--------|------|------|
| *SQL Server Execution Plans*, 3rd ed. (Grant Fritchey, 2018, latest edition) | Query tuning: capturing, reading and acting on execution plans | `SQL Server Execution Plans 3rd Ed - Grant Fritchey.pdf` | [red-gate.com](https://www.red-gate.com/simple-talk/featured/sql-server-execution-plans-third-edition-by-grant-fritchey/) |
| *SQL Server Concurrency: Locking, Blocking and Row Versioning* (Kalen Delaney, 2012, no newer edition found) | Transactions, isolation levels, locks, blocking, deadlocks, snapshot isolation | `SQL Server Concurrency - Kalen Delaney.pdf` | [red-gate.com](https://www.red-gate.com/products/redgate-monitor/resources/understanding-sql-server-concurrency/) |
| *SQL Server 2025 Query Performance Tuning*, 7th ed. (Grant Fritchey, Apress, Feb 2026) | Newer, broader paid follow-up: execution plans plus SQL Server 2025 features | Not downloaded (paid) | [amazon.com](https://www.amazon.com/Server-2025-Query-Performance-Tuning/dp/B0FHJT2736) |

**Suggested path:** SQLBolt → Joins Visualizer → SQL Murder Mystery → PostgreSQL Exercises → Use The Index, Luke → execution plans on your work database (or the Stack Overflow DB) → the two books.
