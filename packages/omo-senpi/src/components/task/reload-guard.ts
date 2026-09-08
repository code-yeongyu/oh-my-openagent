import type { SenpiExtensionAPI } from "../../extension/types"

// The DAG seam the guard reads: an in-flight run is durable but a reload pauses it mid-flight.
export interface ReloadGuardDagRun {
  readonly runId: string
  readonly name: string
  readonly status: string
}

export interface ReloadGuardDagSource {
  liveRuns(): readonly ReloadGuardDagRun[]
}

export type ReloadVeto = { readonly cancel: true; readonly reason: string } | undefined

export function evaluateReloadVeto(dag?: ReloadGuardDagSource): ReloadVeto {
  const liveRuns = dag?.liveRuns() ?? []
  if (liveRuns.length === 0) return undefined
  return {
    cancel: true,
    reason: `${liveRuns.length} DAG run(s) still in flight: ${liveRuns.map((entry) => entry.name).join(", ")} - wait for them to finish or cancel them (dag cancel) before reloading.`,
  }
}

/**
 * Keep reload protection for in-flight DAG runs. Resident task children are intentionally not
 * checked here: session_shutdown already suspends them durably and session_start reconciles them,
 * so blocking the user's reload on a running child is redundant and makes config reload
 * impossible while background work is active.
 */
export function wireReloadGuard(pi: SenpiExtensionAPI, dag?: ReloadGuardDagSource): void {
  pi.on("session_before_reload", () => evaluateReloadVeto(dag))
}
