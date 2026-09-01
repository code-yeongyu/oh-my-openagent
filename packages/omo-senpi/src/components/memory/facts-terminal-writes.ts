// Ordered terminal writes for a facts run.
//
// THE ORDERING IS THE CONTRACT: the failure record lands BEFORE the terminal sentinel
// (final.json / abandoned.json). A crash in that window is safe - reconciliation replays the
// same run with the same failureId and `applyFailure` is idempotent per failureId, so the
// streak cannot double-increment. The reverse order would lose the increment entirely: the
// sentinel makes the run terminal, reconciliation skips it, and the batch relaunches forever
// with no backoff - the incident shape this module exists to prevent.
//
// THE FAILURE IDENTITY IS THE LEDGER'S `batchId`, NEVER THE RUN NAME. Retention can free
// `facts-<digest>-<attempt>` and hand the same name to a later launch (see `nextAttempt`), so a
// run-name failureId would make a genuine new failure look like a crash replay of the pruned one:
// `applyFailure` would skip it, the streak would stay pinned and the batch would never park.
// `batchId` is minted fresh per launch and written into ledger.json, so replays (which read the
// same ledger) stay idempotent while distinct launches can never collide.

import type {
  FactsFailureReason,
  FactsFailureTarget,
  FactsQueueEntry,
} from "@oh-my-opencode/memory-core"

import { ledgerTargets, type FactsFailurePort } from "./facts-failure-recording"
import { cleanupTerminalFactsRun, type RemoveRunArtifact } from "./facts-run-cleanup"
import { writeFactsFinal } from "./facts-run-storage"
import type { FactsRunLedger } from "./facts-runner-types"
import { writeRunJsonAtomic } from "./worker/run-artifacts"
import { join } from "node:path"

export type FactsTerminalOutcome = "committed" | "no_facts" | "failed" | "parent_dirty"

export interface FactsTerminalWritesOptions {
  readonly failures: FactsFailurePort
  readonly now: () => Date
  readonly markConsumed: (entries: readonly FactsQueueEntry[]) => Promise<void>
  /** Sentinel write seam; tests crash inside the ordering window through it. */
  readonly write?: (path: string, value: unknown) => Promise<void>
  /** Post-sentinel deletion seam for the run's disposable artifacts. */
  readonly remove?: RemoveRunArtifact
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
}

export interface FactsFailureWrite {
  readonly runDir: string
  readonly runId: string
  /** Per-launch ledger id; the failure identity, because run names can be reused after pruning. */
  readonly batchId: string
  readonly targets: readonly FactsFailureTarget[]
  readonly reason: FactsFailureReason
  readonly detail: string
  readonly outcome?: "failed" | "parent_dirty"
}

export class FactsTerminalWrites {
  constructor(private readonly options: FactsTerminalWritesOptions) {}

  /** Record first, sentinel second. A store failure aborts the sentinel deliberately. */
  async fail(write: FactsFailureWrite): Promise<void> {
    await this.record(write.targets, write.batchId, write.reason, write.detail)
    await this.final(write.runDir, write.runId, write.outcome ?? "failed", write.detail)
  }

  /** Reconciliation could not prove the run dead; the endpoints still took a failure. */
  async abandon(runDir: string, ledger: FactsRunLedger, reason: "unknown_liveness"): Promise<void> {
    await this.record(ledgerTargets(ledger.queued), ledger.batchId, reason, "facts run liveness is unknown")
    await this.sentinel(join(runDir, "abandoned.json"), {
      version: 1,
      runId: ledger.runId,
      abandonedAt: this.options.now().toISOString(),
      reason,
    })
    await this.cleanup(runDir)
  }

  /** Failures raised before a run dir exists key idempotency on a fresh preflight id. */
  async preflightFail(
    targets: readonly FactsFailureTarget[],
    failureId: string,
    reason: FactsFailureReason,
    detail: string,
  ): Promise<void> {
    await this.record(targets, failureId, reason, detail)
  }

  /** Terminal success: consume the batch, THEN drop its now-meaningless failure history. */
  async succeed(
    runDir: string,
    runId: string,
    outcome: "committed" | "no_facts",
    batch: { readonly entries: readonly FactsQueueEntry[]; readonly targets: readonly FactsFailureTarget[] },
    sha?: string,
  ): Promise<void> {
    await this.options.markConsumed(batch.entries)
    await this.clear(batch.targets)
    await this.final(runDir, runId, outcome, undefined, sha)
  }

  private async record(
    targets: readonly FactsFailureTarget[],
    failureId: string,
    reason: FactsFailureReason,
    detail: string,
  ): Promise<void> {
    if (targets.length === 0) return
    await this.options.failures.recordFailure({ targets, failureId, reason, detail })
  }

  private async clear(targets: readonly FactsFailureTarget[]): Promise<void> {
    if (targets.length === 0) return
    try {
      await this.options.failures.clearOnSuccess(targets)
    } catch (error) {
      // A stale record only delays the next launch; it never corrupts memory. Refusing an
      // already-committed outcome over it would be strictly worse.
      this.options.warn?.("facts failure records survived a successful run", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private final(
    runDir: string,
    runId: string,
    outcome: FactsTerminalOutcome,
    detail?: string,
    sha?: string,
  ): Promise<void> {
    return writeFactsFinal({
      runDir,
      runId,
      outcome,
      now: this.options.now,
      detail,
      sha,
      ...(this.options.write === undefined ? {} : { write: this.options.write }),
      ...(this.options.remove === undefined ? {} : { remove: this.options.remove }),
      ...(this.options.warn === undefined ? {} : { warn: this.options.warn }),
    })
  }

  private sentinel(path: string, value: unknown): Promise<void> {
    return (this.options.write ?? writeRunJsonAtomic)(path, value)
  }

  /** Sentinel-second deletion: only reached once the run is durably terminal. */
  private cleanup(runDir: string): Promise<void> {
    return cleanupTerminalFactsRun({
      runDir,
      ...(this.options.remove === undefined ? {} : { remove: this.options.remove }),
      ...(this.options.warn === undefined ? {} : { warn: this.options.warn }),
    })
  }
}
