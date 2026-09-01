import { join } from "node:path"

import { readRunJson, writeRunJsonAtomic, type RunLaunchManifest } from "../run-artifacts"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
const launch = await readRunJson<RunLaunchManifest>(join(runDir, "launch.json"))
await writeRunJsonAtomic(join(runDir, "publishing.json"), {
  version: 1,
  runId: launch.runId,
  attempt: launch.attempt,
  finishedAt: new Date().toISOString(),
})
await writeRunJsonAtomic(join(runDir, "outcome.json"), {
  version: 1,
  runId: launch.runId,
  attempt: launch.attempt,
  finishedAt: new Date().toISOString(),
  childExit: { code: null, signal: "SIGTERM" },
  timedOut: true,
})
// Simulate a supervisor crash after publication starts but before launch cleanup completes.
process.exit(1)
