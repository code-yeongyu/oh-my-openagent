import { z } from "zod"

import type { RuntimeState, Task } from "../types"

const REQUIRED_OUTPUT_BLOCKING_STATES = ["failed", "missing"] as const

const RequiredOutputMetadataSchema = z.object({
  requiredOutput: z.object({
    status: z.enum(["satisfied", ...REQUIRED_OUTPUT_BLOCKING_STATES]),
    reason: z.string().min(1).optional(),
  }).optional(),
}).passthrough()

type RequiredOutputBlockingState = (typeof REQUIRED_OUTPUT_BLOCKING_STATES)[number]

type RequiredOutputBlocker = {
  readonly taskId: string
  readonly subject: string
  readonly reason: string
}

export type MemberWakeRequirement = {
  readonly state: "none" | "pending" | "blocked" | "error"
  readonly reason?: string
  readonly messageCount: number
}

export type MemberWakeError = {
  readonly messageId: string
  readonly reason: string
}

export type ClosureEligibility = {
  readonly state: "not_ready" | "eligible" | "blocked" | "closed"
  readonly reasons: readonly string[]
  readonly terminalTasks: number
  readonly activeTasks: number
  readonly blockedRequiredOutputs: readonly RequiredOutputBlocker[]
}

export type DerivedTeamStatus = RuntimeState["status"] | "blocked"

function assertNever(value: never): never {
  throw new Error(`unexpected lifecycle state ${JSON.stringify(value)}`)
}

function isTerminalTask(task: Task): boolean {
  return task.status === "completed" || task.status === "deleted"
}

function formatRequiredOutputReason(task: Task, state: RequiredOutputBlockingState, reason: string | undefined): string {
  return reason ?? `required output ${state} for task ${task.id}`
}

function getRequiredOutputBlocker(task: Task): RequiredOutputBlocker | undefined {
  const metadata = RequiredOutputMetadataSchema.parse(task.metadata ?? {})
  const requiredOutput = metadata.requiredOutput
  if (requiredOutput === undefined || requiredOutput.status === "satisfied") return undefined

  return {
    taskId: task.id,
    subject: task.subject,
    reason: formatRequiredOutputReason(task, requiredOutput.status, requiredOutput.reason),
  }
}

export function resolveMemberWakeRequirement(
  member: RuntimeState["members"][number],
  unreadMessages: number,
  wakeErrors: readonly MemberWakeError[] = [],
): MemberWakeRequirement {
  if (member.pendingInjectedMessageIds.length > 0) {
    return {
      state: "pending",
      reason: "live delivery pending recipient acknowledgement",
      messageCount: member.pendingInjectedMessageIds.length,
    }
  }

  if (unreadMessages === 0) return { state: "none", messageCount: 0 }

  if (wakeErrors.length > 0) {
    const firstError = wakeErrors[0]
    return {
      state: "error",
      reason: `live delivery wake failed: ${firstError?.reason ?? "unknown error"}`,
      messageCount: wakeErrors.length,
    }
  }

  if (member.sessionId === undefined) {
    return {
      state: "blocked",
      reason: "missing session id for unread messages",
      messageCount: unreadMessages,
    }
  }

  switch (member.status) {
    case "idle":
      return { state: "pending", reason: "recipient idle has unread messages", messageCount: unreadMessages }
    case "pending":
      return { state: "pending", reason: "recipient pending has unread messages", messageCount: unreadMessages }
    case "running":
      return { state: "pending", reason: "recipient running has unread messages", messageCount: unreadMessages }
    case "errored":
      return { state: "blocked", reason: "recipient errored with unread messages", messageCount: unreadMessages }
    case "completed":
      return { state: "blocked", reason: "recipient completed with unread messages", messageCount: unreadMessages }
    case "shutdown_approved":
      return { state: "blocked", reason: "recipient shutdown approved with unread messages", messageCount: unreadMessages }
    default:
      return assertNever(member.status)
  }
}

export function assessClosureEligibility(runtimeState: RuntimeState, tasks: readonly Task[]): ClosureEligibility {
  const activeTasks = tasks.filter((task) => !isTerminalTask(task))
  const blockedRequiredOutputs = tasks.flatMap((task) => {
    const blocker = getRequiredOutputBlocker(task)
    return blocker === undefined ? [] : [blocker]
  })
  const activeMembers = runtimeState.members.filter((member) => (
    member.agentType !== "leader"
    && member.status !== "completed"
    && member.status !== "shutdown_approved"
    && member.status !== "errored"
  ))
  const requiredOutputReasons = blockedRequiredOutputs.map((blocker) => (
    `required output failed for task ${blocker.taskId}: ${blocker.reason}`
  ))
  const activeTaskReasons = activeTasks.map((task) => `task ${task.id} is ${task.status}`)
  const activeMemberReasons = activeMembers.map((member) => `member ${member.name} is ${member.status}`)
  const terminalTasks = tasks.length - activeTasks.length

  if (runtimeState.status === "deleted") {
    return {
      state: "closed",
      reasons: [],
      terminalTasks,
      activeTasks: activeTasks.length,
      blockedRequiredOutputs,
    }
  }

  if (blockedRequiredOutputs.length > 0) {
    return {
      state: "blocked",
      reasons: [...requiredOutputReasons, ...activeTaskReasons, ...activeMemberReasons],
      terminalTasks,
      activeTasks: activeTasks.length,
      blockedRequiredOutputs,
    }
  }

  if (activeTasks.length > 0 || activeMembers.length > 0) {
    return {
      state: "not_ready",
      reasons: [...activeTaskReasons, ...activeMemberReasons],
      terminalTasks,
      activeTasks: activeTasks.length,
      blockedRequiredOutputs,
    }
  }

  return {
    state: "eligible",
    reasons: [],
    terminalTasks,
    activeTasks: 0,
    blockedRequiredOutputs,
  }
}

export function deriveTeamStatus(runtimeState: RuntimeState, closureEligibility: ClosureEligibility): DerivedTeamStatus {
  if (closureEligibility.state === "blocked") return "blocked"
  return runtimeState.status
}
