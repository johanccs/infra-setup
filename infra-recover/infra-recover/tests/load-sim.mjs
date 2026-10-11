// Loads the browser simulator scripts into Node (they are plain scripts that attach to globalThis.InfraSim).
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SIM_FILES = ["core", "images", "tmpl", "docker", "docker-build", "k8s", "kubectl", "kubectl2", "helm", "argocd", "labkit"];
const require = createRequire(import.meta.url);
globalThis.jsyaml = require("js-yaml");
for (const f of SIM_FILES) {
  const file = path.join(ROOT, "assets/js/sim", f + ".js");
  if (existsSync(file)) vm.runInThisContext(readFileSync(file, "utf8"), { filename: file });
}
for (const f of ["labs-docker", "labs-k8s", "labs-gitops"]) {
  const file = path.join(ROOT, "assets/js", f + ".js");
  if (existsSync(file)) vm.runInThisContext(readFileSync(file, "utf8"), { filename: file });
}
export const S = globalThis.InfraSim;

export function newSim(opts = {}) {
  const sim = new S.Sim({ seed: 7, epoch: Date.UTC(2026, 9, 11, 9, 0, 0), ...opts });
  sim.sh = async (script) => {
    let out = "";
    const code = await sim.run(script, { out: (t) => { out += t; }, err: (t) => { out += t; } });
    return { out, code };
  };
  return sim;
}
