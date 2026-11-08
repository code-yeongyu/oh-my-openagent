import { writeFileSync } from "node:fs"
import { join } from "node:path"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
writeFileSync(
  join(runDir, "env-probe.json"),
  JSON.stringify({ bunBeBun: process.env.BUN_BE_BUN ?? null }),
)
