/* infra-sim — Docker and Docker Compose scenarios (lessons 1–8). */
(function (g) {
  "use strict";
  var S = g.InfraSim, lab = S.lab;
  var SERVER_JS = "const express = require('express');\n\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.get('/', (req, res) => {\n  res.send('Hello from my first image\\n');\n});\n\napp.listen(port, () => console.log(`listening on ${port}`));\n";
  var PKG = "{\n  \"name\": \"shop-hello\",\n  \"version\": \"1.0.0\",\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\"\n  },\n  \"dependencies\": {\n    \"express\": \"^5.1.0\"\n  }\n}\n";
  var LOCK = "{\n  \"name\": \"shop-hello\",\n  \"version\": \"1.0.0\",\n  \"lockfileVersion\": 3,\n  \"packages\": {}\n}\n";
  var GOOD_DOCKERFILE = "FROM node:24-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nEXPOSE 3000\nCMD [\"node\", \"server.js\"]\n";

  lab("d-first", {
    lesson: 1, tech: "docker", level: 1, title: "Your first containers",
    story: "<p>You have a fresh machine with Docker installed and nothing running. Prove that Docker works, then run a real web server and reach it from the host.</p>",
    tasks: [
      { text: "Run Docker's test image: <code>docker run hello-world</code>, and read what it prints.", check: function (sim, h) { return !!h.image("hello-world"); }, sticky: true },
      { text: "Start nginx in the background, named <code>web</code>, with host port 8080 mapped to container port 80.", hint: "<code>docker run -d --name web -p 8080:80 nginx:1.29</code>", check: function (sim, h) { if (h.running("web") && h.ok("http://localhost:8080", "nginx")) h.flags.web = 1; return !!h.flags.web; } },
      { text: "Request the page from the host with <code>curl localhost:8080</code>, then look at <code>docker ps</code>.", check: function (sim, h) { return h.flags.web && h.ran(/^curl .*8080/) && h.ran(/docker (ps|container ls)/); }, sticky: true },
      { text: "Clean up: stop the container and remove it.", hint: "<code>docker stop web</code> then <code>docker rm web</code> (or <code>docker rm -f web</code>).", check: function (sim, h) { return !!h.flags.web && !h.container("web"); } }
    ],
    solution: ["docker run hello-world", "docker run -d --name web -p 8080:80 nginx:1.29", "docker ps", "curl localhost:8080", "docker stop web", "docker rm web"],
    explain: "<p><code>docker run</code> does three things: it pulls the image if it is not on the machine yet, creates a container from it, and starts the container's main process. <code>-d</code> detaches it so the shell stays free, and <code>-p 8080:80</code> publishes container port 80 on host port 8080. Without <code>-p</code>, nginx would be running but unreachable from the host. A stopped container still exists (see <code>docker ps -a</code>) until you <code>docker rm</code> it.</p>"
  });

  lab("d-lifecycle", {
    lesson: 2, tech: "docker", level: 1, title: "Look inside a running container",
    story: "<p>A container named <code>web</code> is already running the shop's front end. You didn't start it, and there is no documentation. Find out what it is doing.</p>",
    setup: async function (sim, h) { await h.sh("docker run -d --name web -p 8080:8080 -e BANNER='Autumn sale: 20% off' shop/web:1.0"); sim.advance(90000); h.http("http://localhost:8080/"); h.flags.started = h.container("web").proc.startedAt; },
    tasks: [
      { text: "Read the container's logs. Which port does the app listen on, and what happened to the last request?", hint: "<code>docker logs web</code>", check: function (sim, h) { return h.ran(/docker (container )?logs/); }, sticky: true },
      { text: "Run a command inside the container to print its environment, and find the <code>BANNER</code> variable.", hint: "<code>docker exec web env</code>", check: function (sim, h) { return h.ran(/docker (container )?exec .*(env|printenv|sh)/); }, sticky: true },
      { text: "Open an interactive shell in the container and create the file <code>/tmp/hello.txt</code>. Type <code>exit</code> to leave.", hint: "<code>docker exec -it web sh</code>, then <code>echo hi &gt; /tmp/hello.txt</code>", check: function (sim, h) { var c = h.container("web"); return !!c && !!c.proc && c.proc.fs.isFile("/tmp/hello.txt") && sim.scopes.length === 1; } },
      { text: "Use <code>docker inspect</code> to find the container's IP address.", hint: "<code>docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' web</code>", check: function (sim, h) { return h.ran(/docker (container )?inspect/); }, sticky: true },
      { text: "Stop the container, confirm it is listed by <code>docker ps -a</code> as exited, then start it again.", hint: "<code>docker stop web</code>, <code>docker ps -a</code>, <code>docker start web</code>", check: function (sim, h) { var c = h.container("web"); return !!c && c.state === "running" && c.proc.startedAt > h.flags.started && h.ran(/docker ps .*-a|docker ps -a/); } }
    ],
    solution: ["docker logs web", "docker exec web env", "docker exec web sh -c 'echo hi > /tmp/hello.txt'", "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' web", "docker stop web", "docker ps -a", "docker start web"],
    explain: "<p><code>logs</code>, <code>exec</code> and <code>inspect</code> are the three commands you will use most when something is wrong. Logs show what the main process wrote to stdout and stderr. <code>exec</code> starts an <em>extra</em> process inside the same container, so you see exactly what the app sees. <code>inspect</code> shows how the container was configured. The file you created survives stop and start because both act on the same container; it would be gone if you removed the container and ran a new one.</p>"
  });

  lab("d-fix-exited", {
    lesson: 2, tech: "docker", level: 2, fix: true, title: "The database that won't stay up",
    story: "<p>A teammate ran <code>docker run -d --name db postgres:17</code>. Docker printed a container ID, so they assumed it worked. But the application can't connect, and <code>docker ps</code> shows nothing.</p>",
    setup: async function (sim, h) { await h.sh("docker run -d --name db postgres:17"); sim.advance(120000); },
    tasks: [
      { text: "Find the container and its exit code.", hint: "<code>docker ps</code> only lists running containers. Add <code>-a</code>.", check: function (sim, h) { return h.ran(/docker (ps|container ls).* -a|docker ps -a/); }, sticky: true },
      { text: "Find out <em>why</em> it exited.", hint: "The reason is in the container's own output: <code>docker logs db</code>.", check: function (sim, h) { return h.ran(/docker (container )?logs/); }, sticky: true },
      { text: "Get a container named <code>db</code> running and accepting connections.", hint: "You can't change the environment of an existing container. Remove it and run a new one with <code>-e POSTGRES_PASSWORD=...</code>.", check: function (sim, h) { var c = h.container("db"); return !!c && c.state === "running" && c.proc.listen.indexOf(5432) >= 0; } }
    ],
    diagnose: { q: "Why did the container exit?", options: ["The image could not be pulled", "PostgreSQL refuses to initialise without a superuser password", "Port 5432 was already in use", "The container ran out of memory"], answer: 1, why: "The log says: <i>Database is uninitialized and superuser password is not specified</i>. The image's entrypoint exits with code 1 unless <code>POSTGRES_PASSWORD</code> is set." },
    solution: ["docker ps -a", "docker logs db", "docker rm db", "docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:17", "docker ps"],
    explain: "<p><code>docker run -d</code> printing an ID only means the container was <em>created and started</em>. It says nothing about whether the process inside survived. A container lives exactly as long as its main process, so when the entrypoint exited with code 1 the container stopped. The method is always the same: <code>docker ps -a</code> to see the state and exit code, then <code>docker logs</code> to read the reason. Environment variables are fixed when a container is created, which is why the fix is a new container, not a restart.</p>"
  });

  lab("d-ports", {
    lesson: 3, tech: "docker", level: 1, title: "Publish ports and pass configuration",
    story: "<p>The shop's front end image <code>shop/web:1.0</code> listens on port <b>8080</b> inside the container and reads its settings from environment variables. Run two differently configured copies side by side.</p>",
    tasks: [
      { text: "Run <code>shop/web:1.0</code> as <code>web</code>, reachable on host port 8080.", hint: "<code>docker run -d --name web -p 8080:8080 shop/web:1.0</code>", check: function (sim, h) { return h.has("http://localhost:8080", "Shop web v1.0"); } },
      { text: "Run a second copy named <code>web-sale</code> on host port 8081 with the environment variable <code>BANNER</code> set to any text. Check that the text appears in <code>curl localhost:8081</code>.", hint: "<code>docker run -d --name web-sale -p 8081:8080 -e BANNER=\"Sale today\" shop/web:1.0</code>", check: function (sim, h) { var c = h.container("web-sale"); return !!c && !!c.env.BANNER && h.has("http://localhost:8081", c.env.BANNER); } },
      { text: "Run a container named <code>flaky</code> that always fails, with a restart policy that retries 3 times: image <code>alpine</code>, command <code>sh -c \"echo starting; exit 1\"</code>. Wait a few seconds and check how often it ran.", hint: "<code>docker run -d --name flaky --restart on-failure:3 alpine sh -c \"echo starting; exit 1\"</code>, then <code>sleep 20</code> and <code>docker logs flaky</code> or <code>docker inspect -f '{{.RestartCount}}' flaky</code>.", check: function (sim, h) { var c = h.container("flaky"); return !!c && c.restart.name === "on-failure" && c.restartCount >= 1; } }
    ],
    solution: ["docker run -d --name web -p 8080:8080 shop/web:1.0", "docker run -d --name web-sale -p 8081:8080 -e BANNER=\"Sale today\" shop/web:1.0", "curl localhost:8080", "curl localhost:8081", "docker run -d --name flaky --restart on-failure:3 alpine sh -c \"echo starting; exit 1\"", "sleep 20", "docker inspect -f '{{.RestartCount}}' flaky", "docker logs flaky"],
    explain: "<p>Both containers listen on 8080 <em>inside</em>; that is fine because each container has its own network namespace. Only the host side of <code>-p HOST:CONTAINER</code> must be unique. Configuration goes in through <code>-e</code>, so one image serves every environment. A restart policy tells the Docker daemon what to do when the main process exits: <code>on-failure:3</code> retries a non-zero exit three times, with a growing delay, and then gives up.</p>"
  });

  lab("d-fix-port", {
    lesson: 3, tech: "docker", level: 2, fix: true, title: "\"It's running, but the page won't load\"",
    story: "<p>The front end was started with <code>docker run -d --name web -p 8080:80 shop/web:1.0</code>. <code>docker ps</code> says it is <b>Up</b>, but <code>curl localhost:8080</code> fails.</p>",
    setup: async function (sim, h) { await h.sh("docker run -d --name web -p 8080:80 shop/web:1.0"); sim.advance(60000); },
    tasks: [
      { text: "Reproduce the failure with <code>curl localhost:8080</code> and note the exact error.", check: function (sim, h) { return h.ran(/^curl/); }, sticky: true },
      { text: "Compare the PORTS column of <code>docker ps</code> with the port the app says it listens on in <code>docker logs web</code>.", check: function (sim, h) { return h.ran(/docker (container )?logs/) && h.ran(/docker (ps|container ls)/); }, sticky: true },
      { text: "Make <code>curl localhost:8080</code> return the shop page from a container named <code>web</code>.", hint: "Port mappings can't be changed on an existing container: <code>docker rm -f web</code> and run it again with <code>-p 8080:8080</code>.", check: function (sim, h) { return h.running("web") && h.has("http://localhost:8080", "Shop web"); } }
    ],
    diagnose: { q: "What is wrong?", options: ["The container crashed", "Host port 8080 is used by another program", "The mapping sends traffic to container port 80, but the app listens on 8080", "The image is the wrong version"], answer: 2, why: "<code>0.0.0.0:8080-&gt;80/tcp</code> means host 8080 → container 80. The log line says the app listens on 8080, so nothing answers on 80 and the connection is reset." },
    solution: ["curl localhost:8080", "docker ps", "docker logs web", "docker rm -f web", "docker run -d --name web -p 8080:8080 shop/web:1.0", "curl localhost:8080"],
    explain: "<p>\"Connection reset by peer\" on a published port almost always means <em>the mapping points at a port nobody listens on</em>. Docker accepted the connection on the host side (so it is not \"connection refused\"), forwarded it into the container, and found no listener. The right-hand number of <code>-p</code> must be the port the process actually binds, which you learn from the image's documentation, its <code>EXPOSE</code> line, or the startup log.</p>"
  });

  lab("d-fix-port-conflict", {
    lesson: 3, tech: "docker", level: 2, fix: true, title: "Port is already allocated",
    story: "<p>You tried to start the front end and Docker answered: <i>Bind for 0.0.0.0:8080 failed: port is already allocated</i>. The container <code>web</code> now exists but is not running.</p>",
    setup: async function (sim, h) { await h.sh("docker run -d --name legacy-site -p 8080:80 nginx:1.29"); sim.advance(3600000); await h.sh("docker run -d --name web -p 8080:8080 shop/web:1.0"); sim.advance(30000); },
    tasks: [
      { text: "Find out which container holds host port 8080.", hint: "<code>docker ps</code> shows the PORTS of every running container. <code>docker ps -a</code> also shows <code>web</code> in the <b>Created</b> state.", check: function (sim, h) { return h.ran(/docker (ps|container ls)/); }, sticky: true },
      { text: "Free the port (the old site is no longer needed) and get <code>web</code> serving on <code>localhost:8080</code>.", hint: "<code>docker rm -f legacy-site</code>, then <code>docker start web</code>. The container was created with the right settings; it only failed to start.", check: function (sim, h) { return h.running("web") && h.has("http://localhost:8080", "Shop web"); } }
    ],
    solution: ["docker ps -a", "docker rm -f legacy-site", "docker start web", "curl localhost:8080"],
    explain: "<p>A host port can be bound by only one process. When <code>docker run</code> fails at this point the container has already been <em>created</em>, which is why a second <code>docker run --name web</code> would complain that the name is in use. You don't need to recreate it: remove whatever holds the port (or pick another host port) and <code>docker start web</code>.</p>"
  });

  lab("d-build", {
    lesson: 4, tech: "docker", level: 2, title: "Build your own image", cwd: "/home/learner/hello",
    story: "<p>The directory <code>~/hello</code> contains a tiny Node.js web app (<code>server.js</code>, <code>package.json</code>, <code>package-lock.json</code>) but no Dockerfile. Package it as an image and run it.</p>",
    setup: function (sim, h) { h.write("hello/server.js", SERVER_JS); h.write("hello/package.json", PKG); h.write("hello/package-lock.json", LOCK); },
    tasks: [
      { text: "Create <code>Dockerfile</code> (<code>nano Dockerfile</code>) based on <code>node:24-alpine</code>: set the working directory to <code>/app</code>, copy the two package files, run <code>npm ci --omit=dev</code>, copy the rest, and start <code>node server.js</code>. Build it as <code>hello:1.0</code>.", hint: "The lesson's \"A good Dockerfile\" section has exactly this file. Build with <code>docker build -t hello:1.0 .</code>", check: function (sim, h) { return !!h.image("hello:1.0"); } },
      { text: "Run it as <code>hello</code> on host port 3000 and curl it.", hint: "<code>docker run -d --name hello -p 3000:3000 hello:1.0</code>", check: function (sim, h) { return h.running("hello") && h.ok("http://localhost:3000", ""); } },
      { text: "Change the greeting in <code>server.js</code>, build <code>hello:1.1</code> and watch which steps say <b>CACHED</b>.", hint: "<code>sed -i 's/my first image/version 1.1/' server.js</code> then <code>docker build -t hello:1.1 .</code>", check: function (sim, h) { var a = h.image("hello:1.0"), b = h.image("hello:1.1"); return !!a && !!b && a.id !== b.id; } }
    ],
    solution: [{ file: "Dockerfile", content: GOOD_DOCKERFILE }, "docker build -t hello:1.0 .", "docker run -d --name hello -p 3000:3000 hello:1.0", "curl localhost:3000", "sed -i 's/my first image/version 1.1/' server.js", "docker build -t hello:1.1 .", "docker images"],
    explain: "<p>Each instruction produces a layer, and Docker re-uses a layer when the instruction and its inputs have not changed. Because the package files are copied <em>before</em> the source code, editing <code>server.js</code> only invalidates the last <code>COPY</code>: the slow <code>npm ci</code> layer is served from cache. Put the things that change least at the top of a Dockerfile and the things that change most at the bottom.</p>"
  });

  lab("d-fix-build", {
    lesson: 4, tech: "docker", level: 3, fix: true, title: "The build that fails, then the image that crashes", cwd: "/home/learner/orders",
    story: "<p>A colleague wrote the Dockerfile in <code>~/orders</code> on a Friday afternoon. <code>docker build -t orders:1.0 .</code> fails. There are <b>two</b> separate mistakes in the file: one breaks the build, the other only shows up when the container starts.</p>",
    setup: function (sim, h) {
      h.write("orders/server.js", SERVER_JS.replace("Hello from my first image", "orders service ready")); h.write("orders/package.json", PKG.replace("shop-hello", "orders")); h.write("orders/package-lock.json", LOCK.replace("shop-hello", "orders"));
      h.write("orders/Dockerfile", "FROM node:24-alpine\nWORKDIR /app\nCOPY server.js .\nRUN npm ci --omit=dev\nEXPOSE 3000\nCMD [\"node\", \"app.js\"]\n");
    },
    tasks: [
      { text: "Run the build and read the error: which step fails, and what is missing?", check: function (sim, h) { return h.ran(/docker (buildx )?build/); }, sticky: true },
      { text: "Fix the Dockerfile so that <code>docker build -t orders:1.0 .</code> succeeds.", hint: "<code>npm ci</code> needs <code>package.json</code> and <code>package-lock.json</code> in the image. Copy them before the <code>RUN</code> line: <code>COPY package*.json ./</code>", check: function (sim, h) { return !!h.image("orders:1.0"); } },
      { text: "Run the image as <code>orders</code> with <code>-p 3000:3000</code>. Make <code>curl localhost:3000</code> answer.", hint: "If the container exits at once, <code>docker logs orders</code> names the file Node can't find. Compare it with what <code>CMD</code> starts, fix, rebuild, and recreate the container.", check: function (sim, h) { return h.running("orders") && h.ok("http://localhost:3000", "orders service ready"); } }
    ],
    diagnose: { q: "Why does the container exit even after the build succeeds?", options: ["Port 3000 is not published", "CMD starts app.js, but the file in the image is server.js", "npm ci installed the wrong packages", "EXPOSE is missing"], answer: 1, why: "<code>docker logs orders</code> shows <i>Cannot find module '/app/app.js'</i>. A build succeeding only proves each instruction ran; nothing checks that <code>CMD</code> points at a file that exists." },
    solution: ["docker build -t orders:1.0 .", { file: "Dockerfile", content: GOOD_DOCKERFILE }, "docker build -t orders:1.0 .", "docker run -d --name orders -p 3000:3000 orders:1.0", "docker logs orders", "curl localhost:3000"],
    explain: "<p>Build errors and runtime errors are found in different places. A failing <code>RUN</code> step prints its output in the build log, right above the Dockerfile excerpt with <code>&gt;&gt;&gt;</code> marking the line. A wrong <code>CMD</code> is only discovered when a container starts, and then the evidence is in <code>docker logs</code>. Remember that an image is immutable: after editing the Dockerfile you must rebuild <em>and</em> create a new container from the new image.</p>"
  });

  lab("d-volumes", {
    lesson: 5, tech: "docker", level: 2, title: "Data that survives the container",
    story: "<p>Containers are disposable, but a database's files must not be. Run PostgreSQL with a named volume and prove that the data outlives the container.</p>",
    tasks: [
      { text: "Run <code>postgres:17</code> as <code>db</code> with <code>POSTGRES_PASSWORD=secret</code> and the named volume <code>dbdata</code> mounted at <code>/var/lib/postgresql/data</code>.", hint: "<code>docker run -d --name db -e POSTGRES_PASSWORD=secret -v dbdata:/var/lib/postgresql/data postgres:17</code>", check: function (sim, h) { var c = h.container("db"); if (c && c.state === "running" && c.mounts.some(function (m) { return m.source === "dbdata" && m.target === "/var/lib/postgresql/data"; })) { if (!h.flags.first) h.flags.first = c.id; return true; } return false; } },
      { text: "Insert a row: <code>docker exec db psql -U postgres -c \"INSERT INTO orders VALUES ('keyboard')\"</code>", check: function (sim, h) { var v = sim.docker.volumes.dbdata; return !!v && h.orders(v.store) >= 1; } },
      { text: "Remove the container completely, then start a <b>new</b> <code>db</code> container with the same volume and query the table: the row is still there.", hint: "<code>docker rm -f db</code>, repeat the <code>docker run</code> from task 1, then <code>docker exec db psql -U postgres -c \"SELECT * FROM orders\"</code>", check: function (sim, h) { var c = h.container("db"), v = sim.docker.volumes.dbdata; return !!c && !!h.flags.first && c.id !== h.flags.first && c.state === "running" && !!v && h.orders(v.store) >= 1 && c.mounts.some(function (m) { return m.source === "dbdata"; }); } }
    ],
    solution: ["docker run -d --name db -e POSTGRES_PASSWORD=secret -v dbdata:/var/lib/postgresql/data postgres:17", "docker exec db psql -U postgres -c \"INSERT INTO orders VALUES ('keyboard')\"", "docker rm -f db", "docker run -d --name db -e POSTGRES_PASSWORD=secret -v dbdata:/var/lib/postgresql/data postgres:17", "docker exec db psql -U postgres -c \"SELECT * FROM orders\"", "docker volume ls"],
    explain: "<p>A container's own file system is a thin writable layer that is deleted with the container. A volume is a separate object with its own lifetime: <code>docker rm</code> leaves it alone, and any later container can mount it again. Notice the log of the second container: <i>Database directory appears to contain a database; Skipping initialization</i>. PostgreSQL found the existing files and did not re-create anything.</p>"
  });

  lab("d-fix-volume", {
    lesson: 5, tech: "docker", level: 3, fix: true, title: "The orders vanish after every deploy",
    story: "<p>The team recreates the <code>db</code> container on every deploy, and each time all orders are gone. \"But we <i>do</i> use a volume!\" they say. The container was started with:</p><pre><code>docker run -d --name db -e POSTGRES_PASSWORD=secret -v dbdata:/data postgres:17</code></pre>",
    setup: async function (sim, h) { await h.sh("docker run -d --name db -e POSTGRES_PASSWORD=secret -v dbdata:/data postgres:17"); sim.advance(60000); await h.sh("docker exec db psql -U postgres -c \"INSERT INTO orders VALUES ('monitor')\""); sim.advance(600000); },
    tasks: [
      { text: "Inspect the container's mounts. Where does PostgreSQL actually write, and what is mounted there?", hint: "<code>docker inspect -f '{{json .Mounts}}' db</code> lists two mounts. Compare their <code>Destination</code> with the image's data directory, <code>/var/lib/postgresql/data</code>.", check: function (sim, h) { return h.ran(/docker (container )?inspect|docker volume/); }, sticky: true },
      { text: "Recreate <code>db</code> so that its data directory is on the named volume <code>dbdata</code>.", hint: "<code>docker rm -f db</code>, then run it with <code>-v dbdata:/var/lib/postgresql/data</code>.", check: function (sim, h) { var c = h.container("db"); return !!c && c.state === "running" && c.mounts.some(function (m) { return m.source === "dbdata" && m.target === "/var/lib/postgresql/data"; }); } },
      { text: "Prove it: insert an order, recreate the container once more, and select it back.", hint: "<code>docker exec db psql -U postgres -c \"INSERT INTO orders VALUES ('mouse')\"</code>", check: function (sim, h) { var c = h.container("db"), v = sim.docker.volumes.dbdata; if (!c || !v) return false; var ok = c.state === "running" && c.mounts.some(function (m) { return m.source === "dbdata" && m.target === "/var/lib/postgresql/data"; }) && h.orders(v.store) >= 1; if (ok && !h.flags.id) h.flags.id = c.id; return ok && c.id !== h.flags.id; } }
    ],
    diagnose: { q: "Why was the data lost even though a volume was used?", options: ["Named volumes are deleted with the container", "The volume was mounted at /data, but PostgreSQL stores its files in /var/lib/postgresql/data", "The volume was read-only", "PostgreSQL needs a bind mount, not a volume"], answer: 1, why: "The named volume sat empty at <code>/data</code>. The real data went to an <em>anonymous</em> volume that the image declares for its data directory, and a new container gets a new anonymous volume." },
    solution: ["docker inspect -f '{{json .Mounts}}' db", "docker rm -f db", "docker run -d --name db -e POSTGRES_PASSWORD=secret -v dbdata:/var/lib/postgresql/data postgres:17", "docker exec db psql -U postgres -c \"INSERT INTO orders VALUES ('mouse')\"", "docker rm -f db", "docker run -d --name db -e POSTGRES_PASSWORD=secret -v dbdata:/var/lib/postgresql/data postgres:17", "docker exec db psql -U postgres -c \"SELECT * FROM orders\""],
    explain: "<p>A volume only protects the path it is mounted on. The mount target has to be the directory the application really writes to, which for the official PostgreSQL 17 image is <code>/var/lib/postgresql/data</code>. The image declares that path as a <code>VOLUME</code>, so Docker quietly created an anonymous volume for it (the long hexadecimal name in <code>docker volume ls</code>); that hid the mistake until the container was replaced. The order inserted before your fix lives in that old anonymous volume and is not copied over.</p>"
  });

  lab("d-network", {
    lesson: 6, tech: "docker", level: 2, title: "Connect containers by name",
    story: "<p>The shop API needs a database. Put both on a network of their own so the API can reach the database by name, and publish only the API to the host.</p>",
    tasks: [
      { text: "Create a network called <code>shopnet</code>.", hint: "<code>docker network create shopnet</code>", check: function (sim) { return !!sim.docker.networks.shopnet; } },
      { text: "Run <code>postgres:17</code> as <code>db</code> on that network with <code>POSTGRES_USER=shop</code> and <code>POSTGRES_PASSWORD=secret</code>. Do not publish a port.", hint: "<code>docker run -d --name db --network shopnet -e POSTGRES_USER=shop -e POSTGRES_PASSWORD=secret postgres:17</code>", check: function (sim, h) { var c = h.container("db"); return !!c && c.state === "running" && !!c.networks.shopnet; } },
      { text: "Run <code>shop/api:1.0</code> as <code>api</code> on the same network, published on host port 3000, with <code>DATABASE_URL=postgres://shop:secret@db:5432/shop</code>. <code>curl localhost:3000/products</code> must return the product list.", hint: "<code>docker run -d --name api --network shopnet -p 3000:3000 -e DATABASE_URL=postgres://shop:secret@db:5432/shop shop/api:1.0</code>", check: function (sim, h) { return h.ok("http://localhost:3000/products", "Keyboard"); } },
      { text: "Check name resolution from a throw-away container: on <code>shopnet</code> the name <code>db</code> resolves, on the default network it does not.", hint: "<code>docker run --rm --network shopnet alpine nslookup db</code> and then the same without <code>--network shopnet</code>.", check: function (sim, h) { return h.ran(/docker run .*(nslookup|ping|wget|nc)/); }, sticky: true }
    ],
    solution: ["docker network create shopnet", "docker run -d --name db --network shopnet -e POSTGRES_USER=shop -e POSTGRES_PASSWORD=secret postgres:17", "docker run -d --name api --network shopnet -p 3000:3000 -e DATABASE_URL=postgres://shop:secret@db:5432/shop shop/api:1.0", "curl localhost:3000/products", "docker run --rm --network shopnet alpine nslookup db", "docker run --rm alpine nslookup db"],
    explain: "<p>On a <em>user-defined</em> network Docker runs an embedded DNS server, so every container can be reached by its name. The default <code>bridge</code> network has no such DNS: containers there can only talk by IP address. The database needs no <code>-p</code> at all, because publishing is only for traffic that comes from <em>outside</em> Docker; containers on the same network reach each other's ports directly.</p>"
  });

  lab("d-fix-network", {
    lesson: 6, tech: "docker", level: 3, fix: true, title: "getaddrinfo ENOTFOUND db",
    story: "<p>The API and the database are both running, yet <code>curl localhost:3000/products</code> returns HTTP 500. Both containers were started with plain <code>docker run</code> and no <code>--network</code> option.</p>",
    setup: async function (sim, h) { await h.sh("docker run -d --name db -e POSTGRES_USER=shop -e POSTGRES_PASSWORD=secret postgres:17\ndocker run -d --name api -p 3000:3000 -e DATABASE_URL=postgres://shop:secret@db:5432/shop shop/api:1.0"); sim.advance(60000); h.http("http://localhost:3000/products"); sim.advance(5000); },
    tasks: [
      { text: "Call the API and read the error it returns, then read its logs.", hint: "<code>curl localhost:3000/products</code> and <code>docker logs api</code>", check: function (sim, h) { return h.ran(/^curl/) && h.ran(/docker (container )?logs/); }, sticky: true },
      { text: "Find out which network the two containers are attached to.", hint: "<code>docker network ls</code>, then <code>docker network inspect bridge</code> or <code>docker inspect -f '{{json .NetworkSettings.Networks}}' api</code>", check: function (sim, h) { return h.ran(/docker (network|inspect)/); }, sticky: true },
      { text: "Make <code>curl localhost:3000/products</code> return the products.", hint: "Create a network and attach both running containers to it: <code>docker network create shopnet</code>, <code>docker network connect shopnet db</code>, <code>docker network connect shopnet api</code>.", check: function (sim, h) { return h.ok("http://localhost:3000/products", "Keyboard"); } }
    ],
    diagnose: { q: "The database is healthy. Why can't the API reach it?", options: ["The database password is wrong", "Port 5432 is not published with -p", "Both are on the default bridge network, which has no DNS, so the name \"db\" doesn't resolve", "The API image is broken"], answer: 2, why: "<i>ENOTFOUND</i> is a DNS failure: the lookup of <code>db</code> returned nothing. Name resolution between containers only exists on user-defined networks." },
    solution: ["curl localhost:3000/products", "docker logs api", "docker network inspect bridge", "docker network create shopnet", "docker network connect shopnet db", "docker network connect shopnet api", "curl localhost:3000/products"],
    explain: "<p>Read the error class before guessing. <i>ENOTFOUND</i> means the <em>name</em> could not be resolved; <i>ECONNREFUSED</i> would mean the name resolved but nothing listens on that port; an authentication error would mean the connection worked. Here it is a naming problem, and the cause is the default bridge network. <code>docker network connect</code> attaches a running container to an additional network, so no restart was needed. Publishing 5432 with <code>-p</code> would not have helped: that exposes the port on the <em>host</em>, not under the name <code>db</code>.</p>"
  });

  var COMPOSE_OK = "services:\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_USER: shop\n      POSTGRES_PASSWORD: secret\n    volumes:\n      - dbdata:/var/lib/postgresql/data\n\n  api:\n    image: shop/api:1.0\n    environment:\n      DATABASE_URL: postgres://shop:secret@db:5432/shop\n    ports:\n      - \"3000:3000\"\n    depends_on:\n      - db\n";
  var COMPOSE_WEB = "\n  web:\n    image: shop/web:1.0\n    environment:\n      API_URL: http://api:3000\n    ports:\n      - \"8080:8080\"\n    depends_on:\n      - api\n";
  var COMPOSE_TAIL = "\nvolumes:\n  dbdata:\n";
  lab("d-compose", {
    lesson: 7, tech: "compose", level: 2, title: "The whole shop in one file", cwd: "/home/learner/shop",
    story: "<p><code>~/shop/compose.yaml</code> describes the database and the API. Start it, then add the web front end as a third service.</p>",
    setup: function (sim, h) { h.write("shop/compose.yaml", COMPOSE_OK + COMPOSE_TAIL); },
    tasks: [
      { text: "Read the file (<code>cat compose.yaml</code>) and start the stack in the background. <code>curl localhost:3000/products</code> should work.", hint: "<code>docker compose up -d</code>", check: function (sim, h) { return h.ok("http://localhost:3000/products", "Keyboard"); }, sticky: true },
      { text: "List the project's containers and read the API's logs through Compose.", hint: "<code>docker compose ps</code> and <code>docker compose logs api</code>", check: function (sim, h) { return h.ran(/docker[ -]compose .*ps/) && h.ran(/docker[ -]compose .*logs/); }, sticky: true },
      { text: "Add a service <code>web</code> to <code>compose.yaml</code>: image <code>shop/web:1.0</code>, environment <code>API_URL: http://api:3000</code>, ports <code>\"8080:8080\"</code>, depending on <code>api</code>. Apply the change; <code>curl localhost:8080</code> must list the products.", hint: "Edit with <code>nano compose.yaml</code> (services are indented two spaces, and <code>volumes:</code> at the bottom stays at column 0). Then run <code>docker compose up -d</code> again: Compose only creates what is new.", check: function (sim, h) { return h.ok("http://localhost:8080", "Keyboard"); }, sticky: true },
      { text: "Tear the stack down. The named volume must survive.", hint: "<code>docker compose down</code> (without <code>-v</code>).", check: function (sim, h) { return !sim.docker.containers.some(function (c) { return c.labels["com.docker.compose.project"] === "shop"; }) && !!sim.docker.volumes.shop_dbdata && h.ran(/docker[ -]compose .*down/); } }
    ],
    solution: ["docker compose up -d", "curl localhost:3000/products", "docker compose ps", "docker compose logs api", { file: "compose.yaml", content: COMPOSE_OK + COMPOSE_WEB + COMPOSE_TAIL }, "docker compose up -d", "curl localhost:8080", "docker compose down", "docker volume ls"],
    explain: "<p>Compose turns the long <code>docker run</code> commands of the previous lessons into a file you can review and commit. For each project it creates a private network (<code>shop_default</code>) on which every service is reachable under its <em>service name</em>, which is why <code>db</code> and <code>api</code> work as host names. <code>up -d</code> is idempotent: it compares the file with what is running and changes only the difference. <code>down</code> removes containers and the network but keeps named volumes unless you add <code>-v</code>.</p>"
  });

  lab("d-fix-compose", {
    lesson: 7, tech: "compose", level: 4, fix: true, title: "Three typos, one broken stack", cwd: "/home/learner/shop",
    story: "<p>Someone edited <code>~/shop/compose.yaml</code> in a hurry and ran <code>docker compose up -d</code>. Compose reported every container as <b>Started</b>, but <code>curl localhost:8080</code> does not show the shop. There are <b>three</b> independent mistakes in the file. Work from the outside in: browser → web → api → db.</p>",
    setup: async function (sim, h) {
      h.write("shop/compose.yaml", "services:\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_USER: shop\n      POSTGRES_PASSWRD: secret\n    volumes:\n      - dbdata:/var/lib/postgresql/data\n\n  api:\n    image: shop/api:1.0\n    environment:\n      DATABASE_URL: postgres://shop:secret@database:5432/shop\n    ports:\n      - \"3000:3000\"\n    depends_on:\n      - db\n\n  web:\n    image: shop/web:1.0\n    environment:\n      API_URL: http://api:3000\n    ports:\n      - \"8080:80\"\n    depends_on:\n      - api\n" + COMPOSE_TAIL);
      sim.host.cwd = "/home/learner/shop"; await h.sh("docker compose up -d"); sim.advance(120000); sim.host.cwd = "/home/learner";
    },
    tasks: [
      { text: "See which services are really running: <code>docker compose ps -a</code>.", check: function (sim, h) { return h.ran(/docker[ -]compose .*ps/); }, sticky: true },
      { text: "Fix the <b>web</b> service so that <code>curl localhost:8080</code> gets an answer from the app (even if it says the products are unavailable).", hint: "The front end listens on 8080 inside the container. Look at the right-hand side of its <code>ports</code> entry.", check: function (sim, h) { var r = h.http("http://localhost:8080"); return r.status === 200 || r.status === 502; } },
      { text: "Fix the <b>db</b> service so that it stays up.", hint: "<code>docker compose logs db</code> tells you which variable PostgreSQL is missing. Compare its spelling with the file.", check: function (sim, h) { return sim.docker.containers.some(function (c) { return c.labels["com.docker.compose.service"] === "db" && c.state === "running" && c.proc.listen.indexOf(5432) >= 0; }); } },
      { text: "Fix the <b>api</b> service so that <code>curl localhost:8080</code> lists the products.", hint: "<code>curl localhost:3000/products</code> shows the API's own error. Which host name is it trying to resolve, and what is the database service called?", check: function (sim, h) { return h.ok("http://localhost:8080", "Keyboard"); } }
    ],
    solution: ["docker compose ps -a", "docker compose logs db", "curl localhost:3000/products", "sed -i 's/POSTGRES_PASSWRD/POSTGRES_PASSWORD/; s/@database:/@db:/; s/\"8080:80\"/\"8080:8080\"/' compose.yaml", "docker compose up -d", "docker compose ps", "curl localhost:8080"],
    explain: "<p>Compose's \"Started\" only means the container process was launched. Each mistake had its own signature: the <b>db</b> container was <i>Exited (1)</i> with a log asking for <code>POSTGRES_PASSWORD</code> (a misspelt variable is just an unknown variable); the <b>web</b> port mapping pointed at container port 80 where nothing listens (connection reset); and the <b>api</b> answered <i>ENOTFOUND database</i> because the service is named <code>db</code>, and the service name <em>is</em> the DNS name. After editing, a single <code>docker compose up -d</code> recreated exactly the three containers whose configuration changed.</p>"
  });

  lab("d-fix-oom", {
    lesson: 8, tech: "docker", level: 3, fix: true, title: "Exit code 137",
    story: "<p>To protect the host, someone added a memory limit to the API container. Since then it restarts every few seconds and <code>curl localhost:3000/healthz</code> mostly fails. It was started with:</p><pre><code>docker run -d --name api --restart always -m 64m -p 3000:3000 \\\n  -e DATABASE_URL=postgres://shop:secret@db:5432/shop shop/api:1.0</code></pre>",
    setup: async function (sim, h) { await h.sh("docker run -d --name api --restart always -m 64m -p 3000:3000 -e DATABASE_URL=postgres://shop:secret@db:5432/shop shop/api:1.0"); sim.advance(180000); },
    tasks: [
      { text: "Look at the container's status and restart count.", hint: "<code>docker ps -a</code> and <code>docker inspect -f '{{.RestartCount}} {{.State.ExitCode}} {{.State.OOMKilled}}' api</code>", check: function (sim, h) { return h.ran(/docker (ps|container ls|inspect)/); }, sticky: true },
      { text: "Check the logs. Is there an application error?", hint: "<code>docker logs --tail 5 api</code>: the app starts normally every time and then simply stops. Being killed from outside leaves no error message.", check: function (sim, h) { return h.ran(/docker (container )?logs/); }, sticky: true },
      { text: "Recreate <code>api</code> with a memory limit that fits the app (it needs about 120 MB; give it 256 MB) so that it stays up.", hint: "<code>docker rm -f api</code> and run it again with <code>-m 256m</code>. Check with <code>docker stats --no-stream</code>.", check: function (sim, h) { var c = h.container("api"); return !!c && c.state === "running" && c.memory >= 128 * 1048576 && sim.now - c.proc.startedAt >= 3000 && h.ok("http://localhost:3000/healthz", "ok"); } }
    ],
    diagnose: { q: "What does exit code 137 with <code>OOMKilled: true</code> mean?", options: ["The application threw an exception", "The kernel killed the process (SIGKILL, 128 + 9) because it exceeded the container's memory limit", "Docker could not pull the image", "The restart policy stopped it"], answer: 1, why: "137 = 128 + signal 9. Together with <code>OOMKilled</code> it means the kernel's out-of-memory killer ended the process when it grew past the 64 MB limit." },
    solution: ["docker ps -a", "docker inspect -f '{{.RestartCount}} {{.State.ExitCode}} {{.State.OOMKilled}}' api", "docker logs --tail 5 api", "docker rm -f api", "docker run -d --name api --restart always -m 256m -p 3000:3000 -e DATABASE_URL=postgres://shop:secret@db:5432/shop shop/api:1.0", "sleep 5", "docker stats --no-stream"],
    explain: "<p>Exit codes above 128 mean \"killed by signal (code − 128)\". 137 is SIGKILL, and Docker records whether the kernel's OOM killer sent it. The logs look healthy because the process never got a chance to report anything. A memory limit is a hard ceiling, not a suggestion: set it above the application's real peak usage (measure with <code>docker stats</code>). The same failure appears in Kubernetes as <code>OOMKilled</code>, and you will meet it again in Lesson 14.</p>"
  });

  lab("d-capstone", {
    lesson: 8, tech: "docker", level: 4, fix: true, title: "Monday morning: the shop is down",
    story: "<p>The shop's Docker host was \"tidied up\" over the weekend. This morning <code>curl localhost:8080</code> does not show the shop. Four containers exist: <code>web</code>, <code>api</code>, <code>db</code> and something called <code>debug</code>. Use the method from this lesson: <b>state → logs → configuration → connectivity</b>, one container at a time.</p><p>Target: <code>curl localhost:8080</code> lists the products.</p>",
    setup: async function (sim, h) {
      await h.sh("docker network create shopnet\ndocker run -d --name db --network shopnet -e POSTGRES_USER=shop -e POSTGRES_PASSWORD=secret -v dbdata:/var/lib/postgresql/data postgres:17\ndocker run -d --name debug -p 8080:80 nginx:1.29\ndocker run -d --name api -p 3000:3000 -e DATABASE_URL=postgres://shop:hunter2@db:5432/shop shop/api:1.0\ndocker run -d --name web --network shopnet --restart always -p 8080:8080 -e API_URL=http://api:3000 shop/web:1.2");
      sim.advance(240000);
    },
    tasks: [
      { text: "Take stock: which containers are running, exited, restarting or only created?", hint: "<code>docker ps -a</code>", check: function (sim, h) { return h.ran(/docker (ps|container ls)/); }, sticky: true },
      { text: "Something else answers on port 8080. Remove it.", hint: "<code>curl -s localhost:8080 | head -5</code> shows an nginx welcome page from the <code>debug</code> container.", check: function (sim, h) { var c = h.container("debug"); return !c || c.state !== "running"; } },
      { text: "<code>web</code> is only <b>Created</b>: it never started because the port was taken. Start it, look again a few seconds later, and get a <em>working</em> version of it running on <code>shopnet</code>, published on 8080.", hint: "<code>docker start web</code> now succeeds, but <code>docker ps -a</code> shows it <i>Restarting</i>, and <code>docker logs web</code> shows a crash at startup: version 1.2 is broken. Recreate the container from <code>shop/web:1.1</code>.", check: function (sim, h) { var c = h.container("web"); return !!c && c.state === "running" && c.image.version !== "1.2" && !!c.networks.shopnet && [200, 502].indexOf(h.http("http://localhost:8080").status) >= 0; } },
      { text: "<code>web</code> answers but cannot reach <code>api</code>. Fix the connectivity.", hint: "<code>curl localhost:8080</code> says <i>ENOTFOUND api</i>. On which network is <code>api</code>? <code>docker network connect shopnet api</code>", check: function (sim, h) { var c = h.container("api"); return !!c && c.state === "running" && !!c.networks.shopnet; } },
      { text: "The API now reaches the database but is rejected. Fix it so that <code>curl localhost:8080</code> lists the products.", hint: "<code>curl localhost:3000/products</code> says <i>password authentication failed</i>. The password in <code>DATABASE_URL</code> must match the one the database was created with (<code>docker inspect</code> shows both containers' environment). Recreate <code>api</code> with the right URL, on <code>shopnet</code>.", check: function (sim, h) { return h.ok("http://localhost:8080", "Keyboard"); } }
    ],
    solution: ["docker ps -a", "docker rm -f debug", "docker start web", "sleep 5", "docker ps -a", "docker logs --tail 12 web", "docker rm -f web", "docker run -d --name web --network shopnet --restart always -p 8080:8080 -e API_URL=http://api:3000 shop/web:1.1", "curl localhost:8080", "docker network connect shopnet api", "curl localhost:3000/products", "docker inspect -f '{{json .Config.Env}}' db", "docker rm -f api", "docker run -d --name api --network shopnet -p 3000:3000 -e DATABASE_URL=postgres://shop:secret@db:5432/shop shop/api:1.0", "curl localhost:8080"],
    explain: "<p>Four faults, four different kinds of evidence. A <b>wrong container on the port</b> shows in the PORTS column. A container that is only <b>Created</b> never started, so it has no logs; once it could start, the <b>crash at startup</b> showed as <i>Restarting</i> and was explained by <code>docker logs</code>. A <b>network split</b> shows as a DNS error (<i>ENOTFOUND</i>) and is confirmed by <code>docker network inspect</code>. A <b>wrong credential</b> shows as an authentication error from the database, and only after the network works. Each fix revealed the next problem, which is normal: fix what the current error message says, re-test, and read the next message instead of changing several things at once.</p>"
  });
})(typeof window !== "undefined" ? window : globalThis);
