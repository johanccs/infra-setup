// Runs every scenario headlessly: set it up, check it starts unsolved, play the documented solution, check it ends solved.
// Usage: node tests/lab-tests.mjs [lab-id ...] [-v]
import { S, newSim } from "./load-sim.mjs";

const args = process.argv.slice(2), verbose = args.includes("-v"), only = args.filter((a) => a !== "-v");
const ids = Object.keys(S.labs).filter((id) => !only.length || only.includes(id));
let failures = 0;

export async function playLab(id, { log = false } = {}) {
  const def = S.labs[id], sim = newSim(), h = S.labHelpers(sim);
  let transcript = "";
  const io = { out: (t) => { transcript += t; }, err: (t) => { transcript += t; } };
  const state = () => def.tasks.map((t, i) => { let ok = false; try { ok = !!t.check(sim, h); } catch { ok = false; } if (t.sticky && done[i]) ok = true; if (ok) done[i] = true; return ok; });
  const done = {};
  if (def.setup) await def.setup(sim, h);
  sim.history = [];
  if (def.cwd) sim.host.cwd = def.cwd;
  const before = state();
  for (const step of def.solution) {
    if (typeof step === "string") { transcript += sim.prompt() + step + "\n"; await sim.run(step, io); state(); }
    else if (step.file) { sim.fs.write(S.util.norm(step.file, sim.host.cwd), step.content); transcript += `[edit ${step.file}]\n`; }
  }
  for (let i = 0; i < 40; i++) { sim.advance(1000); state(); }
  const after = state();
  return { def, before, after, transcript, sim, h };
}

for (const id of ids) {
  let r;
  try { r = await playLab(id); }
  catch (e) { failures++; console.error(`  ✗ ${id}: threw ${e.stack || e}`); continue; }
  const problems = [];
  if (r.before.every(Boolean)) problems.push("already solved before the solution ran");
  r.after.forEach((ok, i) => { if (!ok) problems.push(`task ${i + 1} not satisfied: ${r.def.tasks[i].text.replace(/<[^>]+>/g, "").slice(0, 70)}`); });
  if (/sandbox error|is not a function|\[object Object\]|\bNaN\b|undefined(?! \(reading| volume| service)/.test(r.transcript)) problems.push("suspicious output (undefined / internal error)");
  if (problems.length) { failures++; console.error(`  ✗ ${id}: ${problems.join("; ")}`); if (verbose || only.length) console.error(r.transcript); }
  else { console.log(`  ✓ ${id}`); if (verbose) console.log(r.transcript); }
}
console.log(failures ? `\n${failures} scenario(s) failed` : `\nAll ${ids.length} scenarios play through`);
if (import.meta.url === `file://${process.argv[1]}`) process.exit(failures ? 1 : 0);
