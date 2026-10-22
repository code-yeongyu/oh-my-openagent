import { join } from "node:path"

import { writeRunJsonAtomic } from "../run-artifacts"
import { waitForRunSentinel } from "../run-sentinel"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
if (process.env.FIXTURE_NOISY_SUPERVISOR === "1") {
  process.stderr.write(`${"x".repeat(4096)}\nerror: fixture supervisor is still alive\n`)
}
await waitForRunSentinel(join(runDir, "release"), Date.now() + 30_000, Date.now)
await writeRunJsonAtomic(join(runDir, "released.json"), { released: true })
