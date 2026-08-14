import { join } from "node:path"

import { readRunJson, unlinkRunArtifact, writeRunJsonAtomic, type RunLaunchManifest } from "../run-artifacts"
import { waitForRunSentinel } from "../run-sentinel"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
const launch = await readRunJson<RunLaunchManifest>(join(runDir, "launch.json"))
await writeRunJsonAtomic(join(runDir, "outcome.json"), {
  version: 1,
  runId: launch.runId,
  attempt: launch.attempt,
  finishedAt: new Date().toISOString(),
  childExit: { code: 0, signal: null },
  timedOut: false,
})
await unlinkRunArtifact(join(runDir, "launch.json"))
await waitForRunSentinel(join(runDir, "release"), Date.now() + 30_000, Date.now)
await writeRunJsonAtomic(join(runDir, "released.json"), { released: true })
