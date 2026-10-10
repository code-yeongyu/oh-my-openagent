import { join } from "node:path"
import { writeSync } from "node:fs"

import { writeRunJsonAtomic } from "../run-artifacts"
import { waitForRunSentinel } from "../run-sentinel"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
writeSync(2, "Error: waiting for publication\n")
await writeRunJsonAtomic(join(runDir, "ready.json"), { ready: true })
await waitForRunSentinel(join(runDir, "release"), Date.now() + 30_000, Date.now)
writeSync(2, "late supervisor stderr\n")
await writeRunJsonAtomic(join(runDir, "released.json"), { released: true })
