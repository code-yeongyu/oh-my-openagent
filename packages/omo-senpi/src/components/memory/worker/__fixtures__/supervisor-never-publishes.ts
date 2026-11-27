import { join } from "node:path"

import { updateRunLedger, writeRunJsonAtomic } from "../run-artifacts"
import { waitForRunSentinel } from "../run-sentinel"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
// This fixture models an admitted supervisor that stalls, not an unbounded queued run.
await updateRunLedger(join(runDir, "ledger.json"), { queued: false })
await waitForRunSentinel(join(runDir, "release"), Date.now() + 30_000, Date.now)
await writeRunJsonAtomic(join(runDir, "released.json"), { released: true })
