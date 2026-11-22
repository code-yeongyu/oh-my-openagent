// An admitted supervisor that dies before it publishes: the ledger leaves the queue, the pid is
// recorded for the test, and the process exits non-zero with no outcome.

import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { updateRunLedger } from "../run-artifacts"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
await updateRunLedger(join(runDir, "ledger.json"), { queued: false })
writeFileSync(join(runDir, "supervisor.pid"), `${process.pid}\n`)
process.exit(3)
