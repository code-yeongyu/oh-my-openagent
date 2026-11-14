// The Windows QA job's gate over a saved `windows.ts --all` output (R70br(3)): green only with one
// SET line, pass >= 1, fail=0 and every block a named precondition counted in that line. It lives
// beside windows.ts, not in windows/, because --all imports every .ts file in that folder.
//   bun script/qa/computer/windows-set-gate.ts <file>
import { readFileSync } from "node:fs"

import { gateSet } from "./windows/set.ts"

const file = process.argv[2]
if (file === undefined) {
  console.error("usage: windows-set-gate.ts <file of windows.ts --all output>")
  process.exit(2)
}
const problems = gateSet(readFileSync(file, "utf8").split(/\r?\n/))
for (const problem of problems) console.error(`GATE ${problem}`)
console.log(problems.length === 0 ? "GATE windows --all green" : `GATE windows --all red (${problems.length})`)
process.exit(problems.length === 0 ? 0 : 1)
