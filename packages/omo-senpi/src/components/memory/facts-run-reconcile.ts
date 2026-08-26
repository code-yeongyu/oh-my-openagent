import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { describe, runLiveness } from "./facts-run-storage"
import type { FactsRunLedger } from "./facts-runner-types"
import { readRunJson, runOutcomeMatchesLedger, type RunOutcome } from "./worker/run-artifacts"

/**
 * Both terminal paths take the ledger: the caller records the run's queued endpoints in the
 * failure ledger BEFORE its sentinel lands, and only the ledger knows which endpoints those are.
 */
export async function reconcileFactsRuns(options: {
  readonly factsDir: string
  readonly now: () => Date
  readonly finalize: (runDir: string) => Promise<void>
  readonly fail: (runDir: string, ledger: FactsRunLedger, detail: string) => Promise<void>
  readonly abandon: (runDir: string, ledger: FactsRunLedger, reason: "unknown_liveness") => Promise<void>
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
}): Promise<boolean> {
  const runsDir = join(options.factsDir, "runs")
  const names = await readdir(runsDir).catch(() => [])
  let active = false
  for (const name of names.sort()) {
    const runDir = join(runsDir, name)
    if (existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json"))) continue
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json")).catch(() => undefined)
    if (ledger === undefined) continue
    if (existsSync(join(runDir, "outcome.json"))) {
      const outcome = await readRunJson<RunOutcome>(join(runDir, "outcome.json"))
      if (runOutcomeMatchesLedger(ledger, outcome)) {
        try {
          await options.finalize(runDir)
        } catch (error) {
          options.warn?.("facts run reconciliation remains pending", {
            runId: ledger.runId,
            error: describe(error),
          })
          active = true
        }
        continue
      }
    }
    const verdict = await runLiveness(ledger)
    if (verdict === "alive" || options.now().getTime() <= ledger.deadlineAt) {
      active = true
      continue
    }
    if (verdict === "unknown") {
      await options.abandon(runDir, ledger, "unknown_liveness")
    } else {
      await options.fail(runDir, ledger, "facts supervisor and child are not alive")
    }
  }
  return active
}
