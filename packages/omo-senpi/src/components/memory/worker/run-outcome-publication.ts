import { existsSync, readFileSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { isRetryableModelMiss } from "./model-miss"
import {
  unlinkRunArtifact,
  updateRunLedger,
  writeRunJsonAtomic,
  type RunLaunchManifest,
  type RunOutcome,
} from "./run-artifacts"
import {
  claimRunTerminal,
  readRunTerminalClaim,
  runTerminalClaimMatches,
  runTerminalClaimPath,
} from "./run-terminal-claim"
import { withRunTerminalGate } from "./run-terminal-gate"

export async function publishRunOutcome(
  runDir: string,
  manifest: RunLaunchManifest,
  outcome: RunOutcome,
): Promise<void> {
  const identity = { runId: manifest.runId, attempt: manifest.attempt ?? 1 }
  const claim = await claimRunTerminal(runDir, identity, "publish")
  if (!runTerminalClaimMatches(claim, identity, "publish")) return
  await writeRunJsonAtomic(join(runDir, "publishing.json"), {
    version: 1,
    ...identity,
    finishedAt: outcome.finishedAt,
  })
  await withRunTerminalGate(runDir, manifest.runId, async () => {
    if (existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json"))) return
    if (!runTerminalClaimMatches(readRunTerminalClaim(runDir), identity, "publish")) return
    const retrying = isRetryableModelMiss({
      code: outcome.childExit.code,
      stdout: readFileSync(manifest.stdoutPath, "utf8"),
      stderr: readFileSync(manifest.stderrPath, "utf8"),
      timedOut: outcome.timedOut,
    })
    if (retrying && manifest.nextAttempt !== undefined) {
      await updateRunLedger(join(runDir, "ledger.json"), {
        attempt: manifest.nextAttempt.attempt,
        model: manifest.nextAttempt.model,
        ...(manifest.nextAttempt.thinking === undefined ? { thinking: undefined } : { thinking: manifest.nextAttempt.thinking }),
        launching: true,
        pid: undefined,
        processStart: undefined,
        childPid: undefined,
        childProcessStart: undefined,
      })
    }
    await writeRunJsonAtomic(join(runDir, "outcome.json"), outcome)
    if (retrying) await unlinkRunArtifact(runTerminalClaimPath(runDir))
  })
}
