import { ComputerError, fromPortFailure } from "./errors"
import type { BatchOptions, BatchReport, BatchStepOutcome, Computer, Step } from "./facade"
import type { ActionReport } from "./types"

function failedReport(error: ComputerError): ActionReport {
  return {
    disposition: error.disposition,
    delivered: null,
    effect: error.nothingSent ? "refused" : "unverifiable",
    route: null,
    hit: null,
    focusRestoration: "not_confirmed",
    openedSurfaces: [],
    nextCall: null,
    note: error.message,
    warning: null,
    auditIds: [],
    timings: null,
    legacy: false,
  }
}

/**
 * Runs each step in order, as separate tool calls would, and stops at the first failure: the failed step's report
 * carries the error's disposition (`refused` when nothing was sent), later steps are `skipped`. Never retries.
 */
export async function runBatch(
  computer: Computer,
  steps: readonly Step[],
  options: BatchOptions = {},
): Promise<BatchReport> {
  const outcomes: BatchStepOutcome[] = []
  let stoppedAt: number | null = null
  for (const [index, step] of steps.entries()) {
    const label = step.label ?? null
    if (stoppedAt !== null) {
      outcomes.push({ label, status: "skipped" })
      continue
    }
    try {
      options.signal?.throwIfAborted()
      outcomes.push({ label, status: "ok", report: await step.run(computer) })
    } catch (error) {
      const failure =
        error instanceof ComputerError
          ? error
          : options.signal?.aborted
            ? new ComputerError("Cancelled", "batch was cancelled", {
                disposition: { delivery: "not_delivered", retry: "safe" },
                reason: "aborted",
                cause: error,
              })
            : fromPortFailure("batch", "exec", error)
      outcomes.push({ label, status: "failed", report: failedReport(failure), error: failure })
      stoppedAt = index
    }
  }
  return {
    completed: outcomes.filter((outcome) => outcome.status === "ok").length,
    of: steps.length,
    stoppedAt,
    steps: outcomes,
  }
}
