import type { ReloadGuardDagRun, ReloadGuardDagSource } from "./reload-guard"

// A run leaves the live set only once it is genuinely finished; anything else is mid-flight work a
// reload would suspend.
const TERMINAL_DAG_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

// The narrow DAG seam the reload source reads: run summaries for a session plus the snapshot that
// carries the human-facing run name used in the veto message.
export interface DagReloadRunManager {
  list(parentSessionId: string, options?: { readonly limit?: number }): readonly {
    readonly runId: string
    readonly status: string
  }[]
  snapshot(runId: string, parentSessionId: string): { readonly name: string }
}

export interface DagReloadSourceDeps {
  readonly manager: DagReloadRunManager
  readonly sessionId: () => string | undefined
}

// A paused run counts as live: it is suspended mid-flight work, which is precisely the state the
// user must be warned about before reloading again.
export function createDagReloadSource(deps: DagReloadSourceDeps): ReloadGuardDagSource {
  return {
    liveRuns(): readonly ReloadGuardDagRun[] {
      const sessionId = deps.sessionId()
      // Fail-open: with no session to scope there is nothing live to protect, so never block reload.
      if (sessionId === undefined) return []
      const live: ReloadGuardDagRun[] = []
      for (const summary of deps.manager.list(sessionId)) {
        if (TERMINAL_DAG_RUN_STATUSES.has(summary.status)) continue
        // A run pruned between list and snapshot is stale, not fatal: fall back to its id.
        live.push({ runId: summary.runId, name: runName(deps, summary.runId, sessionId), status: summary.status })
      }
      return live
    },
  }
}

function runName(deps: DagReloadSourceDeps, runId: string, sessionId: string): string {
  try {
    return deps.manager.snapshot(runId, sessionId).name
  } catch {
    return runId
  }
}
