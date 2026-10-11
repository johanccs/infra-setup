// Runs every command shown in the lessons' ```bash blocks through the simulator.
// Commands may legitimately fail (the object they name does not exist in an empty sandbox), but the
// sandbox must *understand* them: no unknown command, unknown flag or "not simulated" answers.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { newSim, ROOT, S } from "./load-sim.mjs";

const dir = path.join(ROOT, "src/lessons");
const BAD = /unknown flag|unknown shorthand|unknown command|command not found|not simulated|sandbox error|is not supported|only .* (is|are) simulated|invalid option|requires? (at least )?\d arguments?|flag needs an argument|syntax error|unable to match a printer|is not a git command/i;
let total = 0, failures = 0;
const embedded = new Map();

for (const f of readdirSync(dir).filter((x) => x.endsWith(".html")).sort()) {
  const src = readFileSync(path.join(dir, f), "utf8"), sim = newSim(), num = parseInt(f, 10);
  sim.ui.edit = async () => null;
  for (const m of src.matchAll(/^:::lab[ \t]+([\w-]+)/gm)) {
    if (embedded.has(m[1])) { failures++; console.error(`  ✗ scenario ${m[1]} is embedded in two lessons`); }
    embedded.set(m[1], num);
  }
  for (const m of src.matchAll(/^```bash[^\n]*\n([\s\S]*?)^```/gm)) {
    const lines = m[1].replace(/\\\n\s*/g, " ").split("\n").map((l) => l.replace(/\s+#\s.*$/, "").trim()).filter((l) => l && l[0] !== "#");
    for (const line of lines) {
      total++;
      const r = await sim.sh(line);
      if (BAD.test(r.out)) { failures++; console.error(`  ✗ ${f}: ${line}\n      ${r.out.trim().split("\n").slice(0, 2).join(" | ").slice(0, 200)}`); }
      while (sim.scopes.length > 1) await sim.sh("exit");
    }
  }
}
for (const id of Object.keys(S.labs)) {
  if (!embedded.has(id)) { failures++; console.error(`  ✗ scenario ${id} is not embedded in any lesson`); }
  else if (embedded.get(id) !== S.labs[id].lesson) { failures++; console.error(`  ✗ scenario ${id} says lesson ${S.labs[id].lesson} but is embedded in lesson ${embedded.get(id)}`); }
}
for (const id of embedded.keys()) if (!S.labs[id]) { failures++; console.error(`  ✗ lesson ${embedded.get(id)} embeds unknown scenario ${id}`); }
console.log(failures ? `\n${failures} problem(s)` : `  ✓ ${total} lesson commands understood by the sandbox; ${embedded.size} scenarios each embedded in the lesson they name`);
process.exit(failures ? 1 : 0);
