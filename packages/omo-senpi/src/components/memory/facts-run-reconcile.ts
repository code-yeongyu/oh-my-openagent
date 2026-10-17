import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { readdir } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { describe, runLiveness } from "./facts-run-storage"
import { emitMemoryReceipt, factsReceipt, type MemoryReceiptsPort } from "./receipts-port"
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
  /** The identity runtime dir; a terminal run's lost receipt is rebuilt only when it is given. */
  readonly receiptsDir?: string
  readonly receipts?: MemoryReceiptsPort
}): Promise<boolean> {
  const runsDir = join(options.factsDir, "runs")
  const names = await readdir(runsDir).catch(() => [])
  let active = false
  for (const name of names.sort()) {
    const runDir = join(runsDir, name)
    if (existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json"))) {
      if (options.receiptsDir !== undefined) await backfillFactsReceipt(options.receiptsDir, runDir, options.receipts, options.warn)
      continue
    }
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

const FACTS_OUTCOME_EVENTS: Readonly<Record<string, "committed" | "no_facts" | "failed">> = {
  committed: "committed",
  no_facts: "no_facts",
  failed: "failed",
  parent_dirty: "failed",
}

/**
 * Rebuilds the terminal receipt a crash or a failed append lost between the sentinel and the
 * receipt. The identity is the ledger's `batchId` plus the event, the same one the live write
 * used, so the idempotent append records it at most once.
 */
async function backfillFactsReceipt(
  runtimeDir: string,
  runDir: string,
  receipts: MemoryReceiptsPort | undefined,
  warn: ((message: string, fields: Readonly<Record<string, unknown>>) => void) | undefined,
): Promise<void> {
  const ledger = await readRunJson<{ readonly runId?: unknown; readonly batchId?: unknown }>(join(runDir, "ledger.json")).catch(() => undefined)
  if (typeof ledger?.batchId !== "string") {
    // Never guess a batch identity: a receipt keyed to the wrong batch would be a false record.
    warn?.("facts receipt backfill skipped: ledger unreadable", { runDir })
    return
  }
  const final = await readRunJson<{ readonly runId?: unknown; readonly outcome?: unknown; readonly sha?: unknown }>(join(runDir, "final.json")).catch(() => undefined)
  if (final !== undefined) {
    const event = typeof final.outcome === "string" ? FACTS_OUTCOME_EVENTS[final.outcome] : undefined
    if (event === undefined || final.runId !== ledger.runId) return
    const sha = event === "committed" && typeof final.sha === "string" ? { sha: final.sha } : {}
    await emitMemoryReceipt(runtimeDir, factsReceipt(ledger.batchId, event, sha), receipts, warn)
    return
  }
  const abandoned = await readRunJson<{ readonly runId?: unknown; readonly reason?: unknown }>(join(runDir, "abandoned.json")).catch(() => undefined)
  if (abandoned === undefined || abandoned.runId !== ledger.runId) return
  const reason = typeof abandoned.reason === "string" ? { reason: abandoned.reason } : {}
  await emitMemoryReceipt(runtimeDir, factsReceipt(ledger.batchId, "abandoned", reason), receipts, warn)
}
