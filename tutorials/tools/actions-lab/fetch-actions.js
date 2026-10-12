// Gather the real metadata (inputs, runtime, commit SHA) of every action the course uses, from GitHub itself.
// The ref a lesson uses is the moving major tag (v7) when it points at the same commit as the latest release,
// otherwise the exact release tag.
const { execFileSync } = require('child_process');
const fs = require('fs');
const yaml = require(process.env.JS_YAML || 'js-yaml');
const gh = (a) => execFileSync('gh', ['api', ...a], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
const j = (a) => JSON.parse(gh(a));
const commitOf = (repo, tag) => {
  const ref = j([`repos/${repo}/git/ref/tags/${tag}`]).object;
  return ref.type === 'tag' ? j([`repos/${repo}/git/tags/${ref.sha}`]).object.sha : ref.sha;
};
const list = [
  ['actions/checkout'], ['actions/setup-dotnet'], ['actions/setup-node'], ['actions/cache'], ['actions/upload-artifact'], ['actions/download-artifact'],
  ['actions/github-script'], ['actions/dependency-review-action'], ['actions/attest'], ['docker/login-action'], ['docker/setup-buildx-action'],
  ['docker/build-push-action'], ['docker/metadata-action'], ['sigstore/cosign-installer'], ['aquasecurity/trivy-action'],
  ['github/codeql-action', 'init'], ['github/codeql-action', 'analyze'], ['aws-actions/configure-aws-credentials'], ['azure/setup-helm'],
];
const out = {};
for (const [repo, sub] of list) {
  let latest = repo === 'github/codeql-action' ? null : j([`repos/${repo}/releases/latest`]).tag_name;
  if (!latest) {
    // codeql-action's latest release is a bundle; take the highest vX.Y.Z tag instead
    const all = j([`repos/${repo}/tags?per_page=100`]).map((t) => t.name).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
    latest = all.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  }
  const latestSha = commitOf(repo, latest);
  // The moving major tag (v7) exists only for some actions. Ask for it directly, and use it only if it points at the latest release.
  let use = latest;
  const major = 'v' + /^v?(\d+)/.exec(latest)[1];
  let majorSha = null;
  try { majorSha = commitOf(repo, major); } catch (e) { /* no moving tag: the action publishes exact tags only */ }
  if (majorSha && majorSha === latestSha && major !== latest) use = major;
  const file = (sub ? sub + '/' : '') + 'action.yml';
  let raw;
  try { raw = Buffer.from(j([`repos/${repo}/contents/${file}?ref=${use}`]).content, 'base64').toString('utf8'); }
  catch (e) { raw = Buffer.from(j([`repos/${repo}/contents/${file.replace('.yml', '.yaml')}?ref=${use}`]).content, 'base64').toString('utf8'); }
  const meta = yaml.load(raw);
  const key = repo + (sub ? '/' + sub : '');
  out[key] = { use, latestRelease: latest, sha: latestSha, using: (meta.runs || {}).using,
    inputs: Object.fromEntries(Object.entries(meta.inputs || {}).map(([k, v]) => [k, { required: !!(v && v.required), default: v && v.default !== undefined && v.default !== null ? String(v.default) : null }])),
    outputs: Object.keys(meta.outputs || {}) };
  console.log(key.padEnd(42), ('@' + use).padEnd(9), 'release', latest.padEnd(9), latestSha.slice(0, 7), String((meta.runs || {}).using).padEnd(9), Object.keys(out[key].inputs).length + ' inputs');
}
fs.writeFileSync(require('path').join(__dirname, 'vendor', 'actions-meta.json'), JSON.stringify(out, null, 1));
