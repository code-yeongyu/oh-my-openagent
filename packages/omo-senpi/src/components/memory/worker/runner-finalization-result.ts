import type { ReservationRunResult } from "./run-finalization-types"
import type { ReflectionRunResult } from "./runner-types"

export function requireFinalizedResult(
  result: ReservationRunResult | undefined,
): ReflectionRunResult {
  if (result === undefined) throw new Error("Reflection finalization claim is busy")
  if (result.outcome === "abandoned_unknown" || result.completion === undefined) {
    throw new Error(`Reflection finalization did not publish completion for ${result.runId}`)
  }
  return {
    runId: result.runId,
    outcome: result.outcome,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(result.detail === undefined ? {} : { detail: result.detail }),
    completion: result.completion,
    ...(result.launch === undefined ? {} : { launch: result.launch }),
  }
}
