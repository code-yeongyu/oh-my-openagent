import { taskIdentityLabel, type TaskRecord } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"

// The narrow manager seam the guard reads: the live resident set (exactly what a reload's
// session_shutdown teardown would destroy) plus record lookup for status/labels.
export interface ReloadGuardManager {
  residentTaskIds(): readonly string[]
  get(taskId: string): TaskRecord | undefined
}

// The DAG seam the guard reads: an in-flight run is durable but a reload PAUSES it mid-flight, so a
// live run must veto the reload exactly like a running resident child does.
export interface ReloadGuardDagRun {
  readonly runId: string
  readonly name: string
  readonly status: string
}

export interface ReloadGuardDagSource {
  liveRuns(): readonly ReloadGuardDagRun[]
}

export type ReloadVeto = { readonly cancel: true; readonly reason: string } | undefined

export function evaluateReloadVeto(manager: ReloadGuardManager, dag?: ReloadGuardDagSource): ReloadVeto {
  const running = manager
    .residentTaskIds()
    .map((taskId) => manager.get(taskId))
    .filter((entry): entry is TaskRecord => entry !== undefined && entry.status === "running")
  const liveRuns = dag?.liveRuns() ?? []
  if (running.length === 0 && liveRuns.length === 0) return undefined
  const labels = running.map((entry) =>
    taskIdentityLabel({
      taskId: entry.task_id,
      ...(entry.name !== undefined && { name: entry.name }),
      ...(entry.description !== undefined && { description: entry.description }),
      ...(entry.task_summary !== undefined && { taskSummary: entry.task_summary }),
    }),
  )
  const reasons: string[] = []
  if (running.length > 0) {
    reasons.push(
      `${running.length} subagent(s) still running: ${labels.join(", ")} - wait for them to finish or cancel them (task_cancel) before reloading.`,
    )
  }
  if (liveRuns.length > 0) {
    reasons.push(
      `${liveRuns.length} DAG run(s) still in flight: ${liveRuns.map((entry) => entry.name).join(", ")} - wait for them to finish or cancel them (dag cancel) before reloading.`,
    )
  }
  return { cancel: true, reason: reasons.join(" ") }
}

/**
 * Block senpi's session reload (senpi cancellable `session_before_reload` event) while any
 * resident child is still running: a reload emits session_shutdown{reason:"reload"}, and the
 * task lifecycle tears down EVERY resident child on that event - killing in-flight subagents
 * and team members. Terminal residents (revivable finished children) never block.
 *
 * The same reload also pauses every in-flight DAG run mid-flight (dag recovery's
 * pauseRunsForShutdown), so a live DAG run blocks the reload too - otherwise a long DAG silently
 * stops the moment the user reloads.
 */
export function wireReloadGuard(
  pi: SenpiExtensionAPI,
  manager: ReloadGuardManager,
  dag?: ReloadGuardDagSource,
): void {
  pi.on("session_before_reload", () => evaluateReloadVeto(manager, dag))
}
