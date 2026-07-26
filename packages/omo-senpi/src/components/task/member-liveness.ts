import type { TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"

export const TEAM_MEMBER_LIVENESS_MESSAGE_TYPE = "senpi-task.team-member-liveness"

export type TeamMemberLivenessDetails = {
  readonly memberName: string
  readonly lastKnownState: TaskStatus
  readonly reason?: string
}

export type TeamMemberLivenessNotifier = {
  notifyTerminal(record: TaskRecord): void
}

export type TeamMemberLivenessNotifierDeps = {
  readonly pi: Pick<SenpiExtensionAPI, "sendMessage">
  readonly coordinator?: Pick<IdleInjectionCoordinator, "enqueue" | "scheduleFlush" | "flushSoon">
  readonly isStreaming: () => boolean
}

const TEAM_MEMBER_NAME_PATTERN = /^team:[0-9a-f-]{36}:([a-z0-9-]+)$/i

export function createTeamMemberLivenessNotifier(
  deps: TeamMemberLivenessNotifierDeps,
): TeamMemberLivenessNotifier {
  const delivered = new Set<string>()

  return {
    notifyTerminal(record) {
      const details = livenessDetails(record)
      if (details === undefined) return
      const key = `team-member-liveness:${record.task_id}:${record.notification.run_epoch}`
      if (delivered.has(key)) return
      delivered.add(key)
      const content = livenessContent(details)
      if (deps.coordinator !== undefined) {
        deps.coordinator.enqueue({ key, source: "team-liveness", content })
        if (deps.isStreaming()) deps.coordinator.scheduleFlush()
        else deps.coordinator.flushSoon()
        return
      }
      deps.pi.sendMessage({
        customType: TEAM_MEMBER_LIVENESS_MESSAGE_TYPE,
        content,
        display: true,
        details,
      }, { triggerTurn: true, deliverAs: "steer" })
    },
  }
}

export function livenessDetails(record: TaskRecord): TeamMemberLivenessDetails | undefined {
  const memberName = TEAM_MEMBER_NAME_PATTERN.exec(record.name ?? "")?.[1]
  if (memberName === undefined || (record.status !== "error" && record.status !== "lost")) return undefined
  return {
    memberName,
    lastKnownState: record.status,
    ...(record.error_message === undefined ? {} : { reason: record.error_message }),
  }
}

export function livenessContent(details: TeamMemberLivenessDetails): string {
  const reason = details.reason === undefined ? "" : ` Reason: ${details.reason}`
  return `Team member liveness: ${details.memberName} exited abnormally; last known state: ${details.lastKnownState}.${reason}`
}
