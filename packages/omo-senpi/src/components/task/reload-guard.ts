import { taskIdentityLabel, type TaskRecord } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"

// The narrow manager seam the guard reads: the live resident set (exactly what a reload's
// session_shutdown teardown would destroy) plus record lookup for status/labels.
export interface ReloadGuardManager {
  residentTaskIds(): readonly string[]
  get(taskId: string): TaskRecord | undefined
}

export type ReloadVeto = { readonly cancel: true; readonly reason: string } | undefined

export function evaluateReloadVeto(manager: ReloadGuardManager): ReloadVeto {
  const running = manager
    .residentTaskIds()
    .map((taskId) => manager.get(taskId))
    .filter((entry): entry is TaskRecord => entry !== undefined && entry.status === "running")
  if (running.length === 0) return undefined
  const labels = running.map((entry) =>
    taskIdentityLabel({
      taskId: entry.task_id,
      ...(entry.name !== undefined && { name: entry.name }),
      ...(entry.description !== undefined && { description: entry.description }),
    }),
  )
  return {
    cancel: true,
    reason: `${running.length} subagent(s) still running: ${labels.join(", ")} - wait for them to finish or cancel them (task_cancel) before reloading.`,
  }
}

/**
 * Block senpi's session reload (senpi cancellable `session_before_reload` event) while any
 * resident child is still running: a reload emits session_shutdown{reason:"reload"}, and the
 * task lifecycle tears down EVERY resident child on that event - killing in-flight subagents
 * and team members. Terminal residents (revivable finished children) never block.
 */
export function wireReloadGuard(pi: SenpiExtensionAPI, manager: ReloadGuardManager): void {
  pi.on("session_before_reload", () => evaluateReloadVeto(manager))
}
