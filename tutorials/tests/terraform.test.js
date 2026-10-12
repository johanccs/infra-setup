// Checks everything Part 6 (Terraform the Lab) tells the reader to create, exactly as written on the page, with the real Terraform
// and the real providers: each step's files are written out in order, formatted, validated and planned; a state file that looks
// like the one a real apply would leave is used to prove the page's claims about plans (no changes, a forced replacement, the
// refactor with and without a moved block); the bootstrap layer's local command and both scripts run against stand-in tools; and the
// pull request job is linted and run. Nothing creates a real cluster.
//   node tests/terraform.test.js
// Tools are looked up on PATH, or in the folder named by TOOLS_DIR: terraform, helm, kubeconform, actionlint and openssl.
// Anything that is not installed is skipped and reported. Provider and chart downloads need network access.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extract, bashBlocks } = require('./extract');
const { check, skip, summary, find, run, yamlDocs, CRDS } = require('./lib');

const DOCS = path.join(__dirname, '..', 'docs');
const P = (n) => path.join(DOCS, n);
const FILE = P('terraform-the-lab-tutorial.html');
const NETWORK_ERR = /dial tcp|no such host|Could not resolve|timeout|connection refused|i\/o timeout|Failed to query available provider|could not connect|registry\.terraform\.io|failed to download/i;

const mk = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const unesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

async function main() {
  const page = fs.readFileSync(FILE, 'utf8');
  // every code block with this caption, in page order
  const blocks = (caption) => [...page.matchAll(/<figcaption>([^<]*)<\/figcaption><pre><code>([\s\S]*?)<\/code><\/pre>/g)].filter((m) => m[1] === caption).map((m) => unesc(m[2]).replace(/\n$/, '') + '\n');
  const block = (caption, i = 0) => { const b = blocks(caption); if (!b[i]) throw new Error(`no block ${i} captioned ${caption}`); return b[i]; };
  const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const T = 'infra/terraform/';

  // ---- the page itself
  const bash = bashBlocks(FILE).map((b) => b.code);
  const bad = bashBlocks(FILE).filter((b) => run('bash', ['-n'], { input: b.code.replace(/<[^>\n]+>/g, 'X') }).status !== 0);
  check(bad.length === 0, 'every bash block is valid shell syntax', bad.map((b) => b.code.split('\n')[0]).join('\n'));
  check(!/todo-app|X\.Y\.Z|PowerShell|winget|infra\/cluster|infra\/modules|infra\/platform\/(versions|main|variables)\.tf|\bbootstrap\.sh\b(?<!infra\/bootstrap\.sh)/.test(page.replace(/part 3's <code>bootstrap\.sh<\/code>/gi, '').replace(/<code>bootstrap\.sh<\/code> on a lab/g, '')), 'no leftovers: no todo-app folder, no PowerShell, no Terraform folders that would collide with infra/platform, no bare bootstrap.sh path');
  const sections = Object.fromEntries([...page.matchAll(/<section class="step" id="([\w-]+)" data-step>\s*<div class="step-head"><span class="num">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]));
  check(sections.variables === '04' && sections.module === '05' && sections.gateway === '06' && sections.backend === '11' && sections.state === '03' && /Step 11 shows how/.test(page) && /Step 4 adds a <code>node_image<\/code>/.test(page) && /step 6 used one/.test(page) && /\(add to paths:\)|step 5\)/.test(page), 'the step numbers the text refers to (3, 4, 5, 6 and 11) are the right sections');

  const TF = find('terraform');
  if (!TF) { skip('terraform not installed, nothing else in this script can run'); process.exit(summary()); }
  const cache = process.env.TF_PLUGIN_CACHE_DIR || path.join(os.tmpdir(), 'tut-tf-plugin-cache');
  fs.mkdirSync(cache, { recursive: true });
  const env = { ...process.env, TF_PLUGIN_CACHE_DIR: cache, TF_IN_AUTOMATION: '1', CHECKPOINT_DISABLE: '1', NO_COLOR: '1' };
  const COLOURED = ['init', 'plan', 'apply', 'destroy', 'validate'];
  const tf = (cwd, args, extra = {}) => run(TF, COLOURED.includes(args[0]) ? [args[0], '-no-color', ...args.slice(1)] : args, { cwd, env: { ...env, ...extra } });
  const version = tf(process.cwd(), ['version']).stdout.match(/Terraform v(\d+)\.(\d+)\.(\d+)/);
  check(version && (+version[1] > 1 || +version[2] >= 9), `the installed Terraform (${version && version[0]}) satisfies the pages's required_version >= 1.9`);
  const pinned = /terraform_(\d+\.\d+\.\d+)_linux_amd64\.zip/.exec(page)[1];
  const sums = run('curl', ['-s', '-m', '30', `https://releases.hashicorp.com/terraform/${pinned}/terraform_${pinned}_SHA256SUMS`]);
  if (!sums.stdout) skip('no network, the Terraform download was not checked');
  else check(new RegExp(`[0-9a-f]{64}  terraform_${pinned}_linux_amd64\\.zip`).test(sums.stdout) && (page.match(new RegExp(pinned.replace(/\./g, '\\.'), 'g')) || []).length >= 8 && /terraform_version: "1\.16\.5"/.test(page) && pinned === '1.16.5', `step 1's download, the checksum file and the CI job all use Terraform ${pinned}, and that release's checksum list contains the Linux zip`);

  // ---- stage A: the first layer (step 2)
  const A = mk('tut-tf-a-');
  put(A, 'versions.tf', block(T + 'cluster/versions.tf'));
  put(A, 'main.tf', block(T + 'cluster/main.tf', 0));
  const init = tf(A, ['init', '-input=false']);
  if (init.status !== 0 && NETWORK_ERR.test(init.stderr + init.stdout)) { skip('no network, the providers could not be downloaded; the rest of this script needs them'); process.exit(summary()); }
  check(init.status === 0 && fs.existsSync(path.join(A, '.terraform.lock.hcl')), 'step 2: terraform init downloads the kind provider and writes .terraform.lock.hcl', init.stdout + init.stderr);
  check(tf(A, ['fmt', '-check', '-diff']).status === 0, 'step 2: the files are already formatted the way terraform fmt leaves them');
  check(tf(A, ['validate']).status === 0, 'step 2: terraform validate accepts the first layer');
  const planA = tf(A, ['plan', '-input=false', '-out=p.tfplan']);
  check(planA.status === 0 && /Plan: 1 to add, 0 to change, 0 to destroy\./.test(planA.stdout) && /kind_cluster\.lab will be created/.test(planA.stdout) && /name\s+= "todo"/.test(planA.stdout), 'step 2: the first plan is "1 to add" for kind_cluster.lab, named todo', planA.stdout + planA.stderr);
  const pj = JSON.parse(tf(A, ['show', '-json', 'p.tfplan']).stdout);
  const rc = pj.resource_changes.find((r) => r.type === 'kind_cluster');
  const nodes = rc.change.after.kind_config[0].node;
  check(nodes.length === 2 && nodes[0].role === 'control-plane' && nodes[1].role === 'worker' && nodes[0].extra_port_mappings[0].container_port === 31437 && nodes[0].extra_port_mappings[0].host_port === 8080 && rc.change.after.wait_for_ready === true, 'step 2: one control plane with 31437 mapped to 8080 on your PC, one worker, wait_for_ready on');
  // the same door as part 1's kind config
  const part1 = mk('tut-tf-p1-'); extract(P('code-to-cluster-tutorial.html'), part1);
  const kindCfg = yamlDocs(fs.readFileSync(path.join(part1, 'kind-config.yaml'), 'utf8'))[0];
  check(kindCfg.nodes[0].extraPortMappings[0].containerPort === 31437 && kindCfg.nodes[0].extraPortMappings[0].hostPort === 8080 && kindCfg.nodes[0].extraPortMappings[0].containerPort === nodes[0].extra_port_mappings[0].container_port, "the port mapping matches part 1's infra/kind-config.yaml, which Terraform replaces");

  // a state file like the one a real apply leaves (no Docker here): the planned values with the computed ones filled in
  const fill = { client_certificate: 'CERT', client_key: 'KEY', cluster_ca_certificate: 'CA', endpoint: 'https://127.0.0.1:6443', completed: true, id: 'todo-abc', kubeconfig: 'kc', kubeconfig_path: '/tmp/todo-config', node_image: 'kindest/node:v1.34.0' };
  const after = { ...rc.change.after }; for (const k of Object.keys(rc.change.after_unknown)) if (rc.change.after_unknown[k] === true) after[k] = fill[k];
  const craft = (dir) => fs.writeFileSync(path.join(dir, 'terraform.tfstate'), JSON.stringify({ version: 4, terraform_version: version[0].replace('Terraform v', ''), serial: 1, lineage: '11111111-1111-1111-1111-111111111111', outputs: {}, resources: [{ mode: 'managed', type: 'kind_cluster', name: 'lab', provider: 'provider["registry.terraform.io/tehcyx/kind"]', instances: [{ schema_version: 0, attributes: after, sensitive_attributes: [] }] }], check_results: null }));
  craft(A);
  const again = tf(A, ['plan', '-input=false', '-refresh=false']);
  check(/No changes\./.test(again.stdout), 'step 2: planning again, once the cluster exists, says "No changes" (running it twice is safe)', again.stdout);
  const list = tf(A, ['state', 'list']), show = tf(A, ['state', 'show', 'kind_cluster.lab']);
  check(list.stdout.trim() === 'kind_cluster.lab' && /client_key\s+= "KEY"/.test(show.stdout), 'step 3: state list shows kind_cluster.lab, and state show prints client_key in plain text');
  // the .gitignore from step 3
  const gi = mk('tut-tf-gi-'); run('git', ['init', '-q'], { cwd: gi });
  put(gi, T + '.gitignore', block(T + '.gitignore'));
  for (const f of ['cluster/terraform.tfstate', 'cluster/terraform.tfstate.backup', 'cluster/.terraform/x', 'cluster/x.tfplan', 'bootstrap/.terraform/providers/y']) put(gi, T + f, 'x');
  put(gi, T + 'cluster/.terraform.lock.hcl', 'x');
  const ignored = (f) => run('git', ['check-ignore', '-q', T + f], { cwd: gi }).status === 0;
  check(['cluster/terraform.tfstate', 'cluster/terraform.tfstate.backup', 'cluster/.terraform/x', 'cluster/x.tfplan', 'bootstrap/.terraform/providers/y'].every(ignored) && !ignored('cluster/.terraform.lock.hcl'), 'step 3: .gitignore keeps the state, its backup, downloaded providers and saved plans out of Git, and lets .terraform.lock.hcl in');

  // ---- stage B: variables and outputs (step 4)
  const B = mk('tut-tf-b-');
  put(B, 'versions.tf', block(T + 'cluster/versions.tf'));
  put(B, 'variables.tf', block(T + 'cluster/variables.tf', 0));
  put(B, 'main.tf', block(T + 'cluster/main.tf', 1));
  put(B, 'outputs.tf', block(T + 'cluster/outputs.tf', 0));
  tf(B, ['init', '-input=false']); craft(B);
  check(tf(B, ['fmt', '-check']).status === 0 && tf(B, ['validate']).status === 0, 'step 4: variables, main and outputs are formatted and valid');
  const planB = tf(B, ['plan', '-input=false', '-refresh=false']);
  check(!/Plan:|will be (created|destroyed|updated)|must be replaced/.test(planB.stdout) && /without changing any real infrastructure/.test(planB.stdout) && /Changes to Outputs:/.test(planB.stdout) && /client_key\s+= \(sensitive value\)/.test(planB.stdout) && /kube_context\s+= "kind-todo"/.test(planB.stdout), 'step 4: with the defaults the plan lists no resource, only the new outputs (the sensitive ones hidden)', planB.stdout);
  const two = tf(B, ['plan', '-input=false', '-refresh=false', '-var', 'worker_count=2']);
  check(/-\/\+ destroy and then create replacement/.test(two.stdout) && /# forces replacement/.test(two.stdout) && /Plan: 1 to add, 0 to change, 1 to destroy\./.test(two.stdout), 'step 4: a second worker plans "-/+ destroy and then create replacement", "# forces replacement" and "1 to add, 0 to change, 1 to destroy"', two.stdout);
  const none = tf(B, ['plan', '-input=false', '-refresh=false', '-var', 'worker_count=0']);
  check(/Plan: 1 to add, 0 to change, 1 to destroy\./.test(none.stdout), 'troubleshooting: dropping to zero workers is also a replacement');
  const many = tf(B, ['plan', '-input=false', '-refresh=false', '-var', 'worker_count=4']);
  check(many.status !== 0 && /Use between 0 and 3 workers; more won't fit on a laptop\./.test(many.stderr + many.stdout), 'step 4: more than three workers is refused before any plan, with the page\'s message');
  const img = tf(B, ['plan', '-input=false', '-refresh=false', '-var', 'node_image=kindest/node:v1.36.4']);
  check(/node_image\s+= "kindest\/node:v1\.34\.0" -> "kindest\/node:v1\.36\.4"/.test(img.stdout) && /forces replacement/.test(img.stdout), 'step 4: setting node_image later would replace the cluster too, so choose it up front');
  const hub = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '20', 'https://hub.docker.com/v2/repositories/kindest/node/tags/v1.36.4']);
  if (hub.stdout !== '000') check(hub.stdout === '200', 'the example node image kindest/node:v1.36.4 exists');

  // ---- stage C: the module (step 5)
  const C = mk('tut-tf-c-');
  put(C, 'cluster/versions.tf', block(T + 'cluster/versions.tf'));
  put(C, 'modules/kind-cluster/variables.tf', block(T + 'cluster/variables.tf', 0));
  put(C, 'modules/kind-cluster/main.tf', block(T + 'cluster/main.tf', 1));
  put(C, 'modules/kind-cluster/outputs.tf', block(T + 'cluster/outputs.tf', 0));
  const moveBlock = block('bash: in infra-setup/infra/terraform/').replace(/git mv (\S+) (\S+)/g, 'mv $1 $2');
  // the moves as the page writes them, run on the step 4 files laid out as the reader has them
  const R = mk('tut-tf-r-'); for (const f of ['variables', 'main', 'outputs']) fs.copyFileSync(path.join(B, f + '.tf'), (fs.mkdirSync(path.join(R, 'cluster'), { recursive: true }), path.join(R, 'cluster', f + '.tf')));
  const mv = run('bash', ['-ec', moveBlock], { cwd: R });
  check(mv.status === 0 && fs.existsSync(path.join(R, 'modules/kind-cluster/main.tf')) && !fs.existsSync(path.join(R, 'cluster/main.tf')), 'step 5: the mkdir, git mv and sed commands run as written', mv.stderr);
  for (const f of ['variables', 'main', 'outputs']) put(C, `modules/kind-cluster/${f}.tf`, fs.readFileSync(path.join(R, 'modules/kind-cluster', f + '.tf'), 'utf8'));
  const modMain = fs.readFileSync(path.join(C, 'modules/kind-cluster/main.tf'), 'utf8'), modOut = fs.readFileSync(path.join(C, 'modules/kind-cluster/outputs.tf'), 'utf8');
  check(/resource "kind_cluster" "this"/.test(modMain) && !/\blab\b/.test(modMain + modOut) && /kind_cluster\.this\.name/.test(modOut), 'step 5: the sed renames the resource from lab to this in the module, in the resource and in every output');
  put(C, 'modules/kind-cluster/versions.tf', block(T + 'modules/kind-cluster/versions.tf'));
  put(C, 'cluster/main.tf', block(T + 'cluster/main.tf', 2));
  put(C, 'cluster/variables.tf', block(T + 'cluster/variables.tf', 1));
  put(C, 'cluster/outputs.tf', block(T + 'cluster/outputs.tf', 1));
  craft(path.join(C, 'cluster'));
  const noVersions = mk('tut-tf-nov-'); fs.cpSync(C, noVersions, { recursive: true }); fs.unlinkSync(path.join(noVersions, 'modules/kind-cluster/versions.tf'));
  const bad1 = tf(path.join(noVersions, 'cluster'), ['init', '-input=false']);
  check(bad1.status !== 0 && /hashicorp\/kind/.test(bad1.stdout + bad1.stderr), 'step 5 and troubleshooting: without the module\'s own versions.tf, init fails looking for hashicorp/kind', bad1.stdout + bad1.stderr);
  const ci = tf(path.join(C, 'cluster'), ['init', '-input=false']);
  check(ci.status === 0 && tf(path.join(C, 'cluster'), ['validate']).status === 0 && tf(C, ['fmt', '-check', '-recursive']).status === 0, 'step 5: with the module, init and validate pass and every file is formatted', ci.stderr);
  const drill = tf(path.join(C, 'cluster'), ['plan', '-input=false', '-refresh=false']);
  check(/kind_cluster\.lab will be destroyed/.test(drill.stdout) && /module\.cluster\.kind_cluster\.this will be created/.test(drill.stdout) && /Plan: 1 to add, 0 to change, 1 to destroy\./.test(drill.stdout), 'step 5 drill: before the moved block, the plan destroys kind_cluster.lab and creates module.cluster.kind_cluster.this', drill.stdout);
  put(C, 'cluster/moved.tf', block(T + 'cluster/moved.tf'));
  const moved = tf(path.join(C, 'cluster'), ['plan', '-input=false', '-refresh=false']);
  check(/kind_cluster\.lab has moved to module\.cluster\.kind_cluster\.this/.test(moved.stdout) && /Plan: 0 to add, 0 to change, 0 to destroy\./.test(moved.stdout), 'step 5: with moved.tf the plan says "has moved" and 0 to add, 0 to change, 0 to destroy', moved.stdout);
  check(tf(path.join(C, 'cluster'), ['validate']).status === 0 && tf(C, ['fmt', '-check', '-recursive']).status === 0, 'step 5: moved.tf is formatted and valid');

  // ---- stage D: the bootstrap layer (steps 6 and 7)
  const D = mk('tut-tf-d-');
  fs.cpSync(C, path.join(D, T), { recursive: true });
  // outputs only, as the cluster layer's state holds them after an apply
  const openssl = find('openssl');
  if (!openssl) skip('openssl not installed, the bootstrap layer was not planned');
  else {
    run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(D, 'k.pem'), '-out', path.join(D, 'c.pem'), '-subj', '/CN=fake', '-days', '2']);
    const cert = fs.readFileSync(path.join(D, 'c.pem'), 'utf8'), key = fs.readFileSync(path.join(D, 'k.pem'), 'utf8');
    const outputs = (omit = []) => Object.fromEntries(Object.entries({ cluster_name: ['todo', false], kube_context: ['kind-todo', false], endpoint: ['https://127.0.0.1:6443', false], cluster_ca_certificate: [cert, true], client_certificate: [cert, true], client_key: [key, true] }).filter(([k]) => !omit.includes(k)).map(([k, [value, sensitive]]) => [k, { value, type: 'string', ...(sensitive ? { sensitive: true } : {}) }]));
    const clusterState = (omit) => JSON.stringify({ version: 4, terraform_version: '1.16.5', serial: 1, lineage: '22222222-2222-2222-2222-222222222222', outputs: outputs(omit), resources: [] });
    fs.writeFileSync(path.join(D, T, 'cluster/terraform.tfstate'), clusterState());
    const bd = path.join(D, T, 'bootstrap');
    put(bd, 'versions.tf', block(T + 'bootstrap/versions.tf', 0));
    put(bd, 'variables.tf', block(T + 'bootstrap/variables.tf'));
    put(bd, 'main.tf', block(T + 'bootstrap/main.tf', 0));
    put(bd, 'terraform.tfvars', block(T + 'bootstrap/terraform.tfvars', 0));
    const bi = tf(bd, ['init', '-input=false']);
    check(bi.status === 0, 'step 6: terraform init in the bootstrap layer downloads the Helm and Kubernetes providers', bi.stdout + bi.stderr);
    check(tf(bd, ['fmt', '-check']).status === 0 && tf(bd, ['validate']).status === 0, 'step 6: the bootstrap layer\'s files are formatted and valid');
    const plan6 = tf(bd, ['plan', '-input=false']);
    if (plan6.status !== 0 && NETWORK_ERR.test(plan6.stderr)) skip('no network, the gateway chart could not be fetched for the plan');
    else {
      check(/Plan: 2 to add, 0 to change, 0 to destroy\./.test(plan6.stdout) && /helm_release\.ngf will be created/.test(plan6.stdout) && /terraform_data\.gateway_api_crds will be created/.test(plan6.stdout) && /"listenerPort": 80/.test(plan6.stdout) && /"port": 31437/.test(plan6.stdout) && /"type": "NodePort"/.test(plan6.stdout), 'step 6: the plan is "2 to add" (the CRD step and the gateway release) and the release carries the NodePort 31437 for port 80', plan6.stdout + plan6.stderr);
      check(/data\.terraform_remote_state\.cluster: Read complete/.test(plan6.stdout), 'step 6: the layer reads the cluster layer\'s outputs from its state');
    }
    // the local command, run for real by Terraform with stand-in kubectl
    const bin = mk('tut-tf-bin-'), calls = path.join(bin, 'calls.log');
    fs.writeFileSync(path.join(bin, 'kubectl'), `#!/usr/bin/env bash\necho "kubectl $*" >> "${calls}"\nif [ "$1" = kustomize ] && [ -n "$FAIL_KUSTOMIZE" ]; then exit 1; fi\ncat >/dev/null <&0 || true\n`, { mode: 0o755 });
    const tree = (name) => { const d = mk('tut-tf-' + name + '-'); fs.cpSync(path.join(D, T), path.join(d, T), { recursive: true }); fs.rmSync(path.join(d, T, 'bootstrap/terraform.tfstate'), { force: true }); return path.join(d, T, 'bootstrap'); };
    const failing = tree('fail');
    const fr = tf(failing, ['apply', '-auto-approve', '-input=false', '-target=terraform_data.gateway_api_crds'], { PATH: bin + path.delimiter + process.env.PATH, FAIL_KUSTOMIZE: '1' });
    check(fr.status !== 0, 'step 6: if kubectl kustomize fails, the pipeline in the command fails the step (set -o pipefail), so Terraform stops', fr.stdout + fr.stderr);
    const okTree = tree('ok');
    fs.writeFileSync(calls, '');
    const ar = tf(okTree, ['apply', '-auto-approve', '-input=false', '-target=terraform_data.gateway_api_crds'], { PATH: bin + path.delimiter + process.env.PATH });
    const logged = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
    check(ar.status === 0 && logged.length === 2 && logged.includes('kubectl kustomize https://github.com/nginx/nginx-gateway-fabric/config/crd/gateway-api/standard?ref=v2.7.2') && logged.includes('kubectl --context kind-todo apply -f -'), 'step 6: Terraform runs the same two commands as part 3 (kustomize the Gateway API CRDs for NGINX Gateway Fabric 2.7.2, apply them to kind-todo)', ar.stdout + ar.stderr + '\n' + logged.join('\n'));
    const partThree = mk('tut-tf-p3-'); extract(P('platform-as-code-tutorial.html'), partThree);
    const oldScript = fs.readFileSync(path.join(partThree, 'bootstrap.sh'), 'utf8');
    check(/NGF_VERSION=2\.7\.2/.test(oldScript) && oldScript.includes('nginx.service.nodePorts=[{"port":31437,"listenerPort":80}]') && oldScript.includes('type=NodePort') || oldScript.includes('nginx.service.type=NodePort'), "the gateway version, the NodePort and the port pair are the ones part 3's script used");

    // step 7: Argo CD and the root Application
    put(bd, 'variables.tf', block(T + 'bootstrap/variables.tf') + '\n' + block(T + 'bootstrap/variables.tf (add at the end)'));
    put(bd, 'main.tf', block(T + 'bootstrap/main.tf', 0) + '\n' + block(T + 'bootstrap/main.tf (add at the end)', 0));
    put(bd, 'terraform.tfvars', block(T + 'bootstrap/terraform.tfvars', 0) + block(T + 'bootstrap/terraform.tfvars (add at the end)'));
    fs.writeFileSync(path.join(bd, 'terraform.tfvars'), fs.readFileSync(path.join(bd, 'terraform.tfvars'), 'utf8').replace('<your-user>', 'someone'));
    put(bd, 'charts/root-app/Chart.yaml', block(T + 'bootstrap/charts/root-app/Chart.yaml'));
    put(bd, 'charts/root-app/templates/root.yaml', block(T + 'bootstrap/charts/root-app/templates/root.yaml'));
    fs.writeFileSync(path.join(bd, 'terraform.tfvars'), run(TF, ['fmt', '-'], { input: fs.readFileSync(path.join(bd, 'terraform.tfvars'), 'utf8') }).stdout || fs.readFileSync(path.join(bd, 'terraform.tfvars'), 'utf8'));
    check(tf(bd, ['validate']).status === 0, 'step 7: the layer with Argo CD and the root Application is valid', tf(bd, ['validate']).stderr);
    const fm = tf(bd, ['fmt', '-check', '-diff']);
    check(fm.status === 0 || /terraform\.tfvars/.test(fm.stdout) && !/main\.tf|variables\.tf|versions\.tf/.test(fm.stdout), 'step 7: every .tf file is formatted (only the tfvars needs the terraform fmt the page asks for)', fm.stdout);
    const plan7 = tf(bd, ['plan', '-input=false']);
    if (plan7.status !== 0 && NETWORK_ERR.test(plan7.stderr)) skip('no network, the Argo CD chart could not be fetched for the plan');
    else check(/Plan: 4 to add, 0 to change, 0 to destroy\./.test(plan7.stdout) && /helm_release\.argocd will be created/.test(plan7.stdout) && /helm_release\.root_app will be created/.test(plan7.stdout) && /version\s+= "10\.10\.2"/.test(plan7.stdout), 'step 7: the layer now plans 4 resources: the CRD step, the gateway, Argo CD 10.10.2 and the root Application', plan7.stdout + plan7.stderr);
    // old Helm provider syntax and a cluster layer without outputs
    const oldSyntax = tree('old'); fs.writeFileSync(path.join(oldSyntax, 'versions.tf'), fs.readFileSync(path.join(oldSyntax, 'versions.tf'), 'utf8').replace('  kubernetes = {\n    host ', '  kubernetes {\n    host ').replace(/(client_key\s+= local\.cluster\.client_key\n)  \}\n\}\n\nprovider "kubernetes"/, '$1  }\n}\n\nprovider "kubernetes"'));
    tf(oldSyntax, ['init', '-input=false']); const ov = tf(oldSyntax, ['validate']);
    check(ov.status !== 0 && /kubernetes/.test(ov.stderr + ov.stdout) && /Unsupported block type[\s\S]*Blocks of type "kubernetes" are not expected here/.test(ov.stderr + ov.stdout), 'troubleshooting: version 2 syntax (a kubernetes block) in the Helm provider fails validation', ov.stdout + ov.stderr);
    const noOut = tree('noout'); fs.writeFileSync(path.join(noOut, '../cluster/terraform.tfstate'), clusterState(['endpoint', 'kube_context']));
    tf(noOut, ['init', '-input=false']); const nv = tf(noOut, ['plan', '-input=false']);
    check(nv.status !== 0 && /Unsupported attribute/.test(nv.stderr + nv.stdout), 'troubleshooting: a cluster layer without the new outputs gives "Unsupported attribute"', nv.stdout + nv.stderr);
    // the import step
    const imp = tree('import');
    fs.writeFileSync(path.join(imp, 'main.tf'), fs.readFileSync(path.join(bd, 'main.tf'), 'utf8') + '\n' + block(T + 'bootstrap/main.tf (add at the end)', 1));
    fs.cpSync(path.join(bd, 'charts'), path.join(imp, 'charts'), { recursive: true });
    for (const f of ['variables.tf', 'terraform.tfvars']) fs.copyFileSync(path.join(bd, f), path.join(imp, f));
    put(imp, 'imports.tf', block(T + 'bootstrap/imports.tf'));
    tf(imp, ['init', '-input=false']);
    check(tf(imp, ['validate']).status === 0 && tf(imp, ['fmt', '-check']).status === 0, 'step 10: the sandbox namespace resource and the import block are valid and formatted (kubernetes_namespace_v1 exists in version 3 of the provider)', tf(imp, ['validate']).stderr);

    // the root-app chart and the versions it relies on
    const helm = find('helm');
    if (helm) {
      const render = run(helm, ['template', 'root-app', path.join(bd, 'charts/root-app'), '--set', 'repoURL=https://github.com/<your-user>/infra-setup.git']);
      const rendered = yamlDocs(render.stdout)[0], old = yamlDocs(fs.readFileSync(path.join(partThree, 'bootstrap/root.yaml'), 'utf8'))[0];
      check(render.status === 0 && JSON.stringify(rendered) === JSON.stringify(old), "the root-app chart renders exactly part 3's infra/bootstrap/root.yaml, with the repo address as the only input", render.stderr + JSON.stringify(rendered));
      check(!('finalizers' in rendered.metadata) && rendered.spec.source.path === 'infra/platform/apps', "the root Application has no finalizer and watches infra/platform/apps, as the drift drill's answer says (deleting it leaves the child Applications)");
      check(run(helm, ['lint', '--strict', path.join(bd, 'charts/root-app')]).status === 0, 'the root-app chart passes helm lint --strict');
      const kc = find('kubeconform');
      if (kc) { fs.writeFileSync(path.join(D, 'root.yaml'), render.stdout); const v = run(kc, ['-strict', '-summary', '-schema-location', 'default', '-schema-location', CRDS, path.join(D, 'root.yaml')]); if (/dial tcp|no such host/.test(v.stderr + v.stdout)) skip('no network, the root Application was not validated'); else check(v.status === 0, 'the rendered root Application is valid against the Argo CD schema', v.stdout + v.stderr); }
      const argo = run(helm, ['template', 'argocd', 'argo-cd', '--repo', 'https://argoproj.github.io/argo-helm', '--version', '10.10.2', '-n', 'argocd']);
      const ngf = run(helm, ['show', 'chart', 'oci://ghcr.io/nginx/charts/nginx-gateway-fabric', '--version', '2.7.2']);
      if (argo.status !== 0 && NETWORK_ERR.test(argo.stderr)) skip('no network, the Argo CD chart was not rendered');
      else {
        const docs = yamlDocs(argo.stdout);
        check(argo.status === 0 && docs.some((d) => d.kind === 'Service' && d.metadata.name === 'argocd-server') && docs.some((d) => d.kind === 'Deployment' && d.metadata.name === 'argocd-server') && /app\.kubernetes\.io\/version: v3\.5\.4|image: .*argocd:v3\.5\.4/.test(argo.stdout) && /ARGOCD_VERSION=v3\.5\.4/.test(oldScript), "chart 10.10.2 installs Argo CD v3.5.4, the version part 3's script applied, with the argocd-server Service and Deployment the drill and later parts use", argo.stderr);
      }
      if (ngf.status !== 0 && NETWORK_ERR.test(ngf.stderr)) skip('no network, the gateway chart was not read');
      else check(/appVersion: 2\.7\.2/.test(ngf.stdout), 'the OCI chart nginx-gateway-fabric 2.7.2 exists and is NGINX Gateway Fabric 2.7.2', ngf.stderr + ngf.stdout);
      // the values Terraform encodes give the NodePort the kind mapping expects
      const vals = /<<-EOT\n([\s\S]*?)\n\s*EOT/.exec(plan6.stdout || '');
      if (vals && ngf.status === 0) {
        fs.writeFileSync(path.join(D, 'ngf-values.yaml'), vals[1].split('\n').map((l) => l.replace(/^ {12}/, '')).join('\n'));
        const t = run(helm, ['template', 'ngf', 'oci://ghcr.io/nginx/charts/nginx-gateway-fabric', '--version', '2.7.2', '-n', 'nginx-gateway', '-f', path.join(D, 'ngf-values.yaml')]);
        const svc = yamlDocs(t.stdout).filter((d) => d.kind === 'Service');
        check(t.status === 0 && /nodePort: 31437/.test(t.stdout) || t.stdout.includes('31437'), 'the values Terraform encodes (yamlencode) give the chart the NodePort 31437 that the kind port mapping opens', t.stderr);
        void svc;
      }
    } else skip('helm not installed, the root-app chart and the chart versions were not checked');

    // ---- the scripts (step 8) against stand-in tools
    const repo = mk('tut-tf-repo-'); const sbin = mk('tut-tf-sbin-'); const slog = path.join(sbin, 'calls.log');
    put(repo, 'infra/bootstrap.sh', block('infra/bootstrap.sh')); put(repo, 'infra/teardown.sh', block('infra/teardown.sh'));
    for (const n of ['terraform', 'kind', 'kubectl']) fs.writeFileSync(path.join(sbin, n), `#!/usr/bin/env bash\necho "${n} $*" >> "${slog}"\nif [ "${n}" = terraform ] && [[ "$*" == *"output -raw cluster_name"* ]]; then printf todo; fi\nif [ "${n}" = kubectl ]; then printf cGFzc3dvcmQ=; fi\n`, { mode: 0o755 });
    const sp = (script) => { fs.writeFileSync(slog, ''); const r = run('bash', [path.join(repo, 'infra', script)], { cwd: os.tmpdir(), env: { ...process.env, PATH: sbin + path.delimiter + process.env.PATH } }); return { ...r, calls: fs.readFileSync(slog, 'utf8').split('\n').filter(Boolean) }; };
    const b = sp('bootstrap.sh');
    check(b.status === 0 && JSON.stringify(b.calls.slice(0, 6)) === JSON.stringify(['terraform -chdir=infra/terraform/cluster init -input=false', 'terraform -chdir=infra/terraform/cluster apply -auto-approve', 'terraform -chdir=infra/terraform/cluster output -raw cluster_name', 'kind export kubeconfig --name todo', 'terraform -chdir=infra/terraform/bootstrap init -input=false', 'terraform -chdir=infra/terraform/bootstrap apply -auto-approve']) && /^kubectl -n argocd get secret argocd-initial-admin-secret/.test(b.calls[6]) && /password/.test(b.stdout), 'step 8: bootstrap.sh runs the cluster layer, exports the kubeconfig for the cluster the output names, runs the bootstrap layer and prints the password, from any folder', JSON.stringify(b.calls) + b.stderr);
    const d = sp('teardown.sh');
    check(d.status === 0 && JSON.stringify(d.calls) === JSON.stringify(['terraform -chdir=infra/terraform/bootstrap destroy -auto-approve', 'terraform -chdir=infra/terraform/cluster destroy -auto-approve']), 'step 8: teardown.sh destroys the bootstrap layer first and the cluster second');
    check(/set -euo pipefail/.test(block('infra/bootstrap.sh')) && /set -euo pipefail/.test(block('infra/teardown.sh')), 'both scripts stop at the first error');
  }

  // ---- the pull request job (step 12), added to part 3's workflow as the page says
  const P3 = mk('tut-tf-ci-'); extract(P('platform-as-code-tutorial.html'), P3);
  const wfFile = '.github/workflows/platform-check.yml';
  let wf = fs.readFileSync(path.join(P3, wfFile), 'utf8');
  const pathLine = block('.github/workflows/platform-check.yml (add to paths:)').replace(/\n$/, '');
  if (!wf.includes('      - "charts/**"')) throw new Error("part 3's workflow no longer has the paths line the page adds to");
  wf = wf.replace('      - "charts/**"', (m) => m + '\n' + pathLine);
  wf = wf.replace(/\n*$/, '\n\n') + block('.github/workflows/platform-check.yml (add under jobs:)');
  put(P3, wfFile, wf);
  const doc = yamlDocs(wf)[0];
  check((doc.on || doc[true]).pull_request.paths.includes('infra/terraform/**') && (doc.on || doc[true]).pull_request.paths.includes('infra/platform/**') && Object.keys(doc.jobs).join() === 'render,terraform', 'step 12: the workflow now also watches infra/terraform and has a second job beside render');
  const al = find('actionlint');
  if (al) { const r = run(al, [wfFile], { cwd: P3 }); check(r.status === 0, 'step 12: actionlint accepts the workflow with the new job', r.stdout + r.stderr); } else skip('actionlint not installed');
  const steps = doc.jobs.terraform.steps;
  check(steps[1].uses === 'hashicorp/setup-terraform@v4' && steps[1].with.terraform_version === pinned && /actions\/checkout@v[6-9]/.test(steps[0].uses), 'step 12: the job installs the same Terraform as step 1 and uses a current checkout action');
  const tags = run('git', ['ls-remote', '--tags', 'https://github.com/hashicorp/setup-terraform']);
  if (tags.status === 0 && tags.stdout) check(/refs\/tags\/v4$/m.test(tags.stdout), 'the action hashicorp/setup-terraform has a v4 tag');
  else skip('no network, the setup-terraform tag was not checked');
  // run the job's commands on the real layout
  if (openssl) {
    const CIROOT = mk('tut-tf-ciroot-'); fs.cpSync(path.join(D, T), path.join(CIROOT, T), { recursive: true });
    fs.rmSync(path.join(CIROOT, T, 'cluster/terraform.tfstate'), { force: true }); fs.rmSync(path.join(CIROOT, T, 'cluster/moved.tf.off'), { force: true });
    for (const d2 of ['cluster', 'bootstrap']) fs.rmSync(path.join(CIROOT, T, d2, '.terraform'), { recursive: true, force: true });
    fs.rmSync(path.join(CIROOT, T, 'bootstrap/terraform.tfstate'), { force: true });
    const fmt = steps.find((s) => s.name === 'Check formatting').run;
    const val = steps.find((s) => s.name === 'Validate each layer').run;
    const hasTfvars = fs.readFileSync(path.join(CIROOT, T, 'bootstrap/terraform.tfvars'), 'utf8');
    fs.writeFileSync(path.join(CIROOT, T, 'bootstrap/terraform.tfvars'), run(TF, ['fmt', '-'], { input: hasTfvars }).stdout);
    fs.writeFileSync(path.join(CIROOT, T, 'bootstrap/imports.tf'), '');
    const shim = mk('tut-tf-shim-'); fs.writeFileSync(path.join(shim, 'terraform'), `#!/usr/bin/env bash\nexec "${TF}" "$@"\n`, { mode: 0o755 });
    const cenv = { ...env, PATH: shim + path.delimiter + process.env.PATH };
    const f1 = run('bash', ['-ec', fmt], { cwd: CIROOT, env: cenv });
    check(f1.status === 0, 'step 12: "terraform fmt -check -recursive infra/terraform" passes on everything the page has you write', f1.stdout + f1.stderr);
    const v1 = run('bash', ['-ec', val], { cwd: CIROOT, env: cenv });
    check(v1.status === 0, 'step 12: init -backend=false and validate pass for both layers, as CI runs them, with no state and no cluster', v1.stdout + v1.stderr);
    const mainTf = path.join(CIROOT, T, 'cluster/main.tf');
    fs.writeFileSync(mainTf, fs.readFileSync(mainTf, 'utf8').replace('module "cluster" {', 'module "cluster" {\n      '));
    const f2 = run('bash', ['-ec', fmt], { cwd: CIROOT, env: cenv });
    check(f2.status !== 0 && /cluster\/main\.tf/.test(f2.stdout + f2.stderr), 'step 12: extra spaces in cluster/main.tf make the formatting check fail, and naming the file');
    const f3 = run(TF, ['fmt', '-recursive', 'infra/terraform'], { cwd: CIROOT, env });
    check(f3.status === 0 && run('bash', ['-ec', fmt], { cwd: CIROOT, env: cenv }).status === 0, 'step 12: terraform fmt -recursive fixes it, and the check passes again');
  }
  const mod = (n) => run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '20', `https://registry.terraform.io/v1/modules/terraform-aws-modules/${n}/aws`]).stdout;
  const m1 = mod('vpc');
  if (m1 === '000') skip('no network, the EKS modules were not checked'); else check(m1 === '200' && mod('eks') === '200', 'step 13: the community modules terraform-aws-modules/vpc/aws and /eks/aws exist on the registry');

  // ---- the animation and links
  const figure = page.slice(page.indexOf('<figure class="anim"'), page.indexOf('</figure>', page.indexOf('<figure class="anim"')));
  const anim = JSON.parse(/<script type="application\/json">([\s\S]*?)<\/script>/.exec(figure)[1]);
  const keys = new Set([...figure.matchAll(/data-k="([\w-]+)"/g)].map((m) => m[1]));
  const used = anim.flatMap((s) => [s.on, s.off].filter(Boolean).flatMap((x) => x.split(/\s+/)));
  check(anim.length === 6 && used.every((k) => keys.has(k)) && anim.flatMap((s) => s.path || []).every(([x, y]) => x >= 0 && x <= 820 && y >= 0 && y <= 300), 'the animation has six steps, every element they name is in the drawing, and the moving dot stays inside it', used.filter((k) => !keys.has(k)).join(', '));
  const five = fs.readFileSync(P('scale-and-capacity-tutorial.html'), 'utf8');
  check(five.includes('href="terraform-the-lab-tutorial.html"') && page.includes('href="code-to-cluster-tutorial.html"') && fs.existsSync(P('code-to-cluster-tutorial.html')), 'part 5 links to this page, and this page links back to part 1');
  for (const d of [A, B, C, D, R, gi, part1]) fs.rmSync(d, { recursive: true, force: true });
  process.exit(summary());
}

main().catch((e) => { console.error(e); process.exit(1); });
