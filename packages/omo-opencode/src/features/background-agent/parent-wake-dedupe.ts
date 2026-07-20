import { resolveRegisteredAgentName } from "../claude-code-session-state"

export type ParentWakePromptContext = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  tools?: Record<string, boolean>
}

/**
 * Identity of a background task referenced by a parent wake. Lives on the
 * wake itself (not a side-channel map) so coalescing, cloning, and requeue
 * keep identities aligned with the wake — a separate map would lose earlier
 * identities when a later wake's `.set()` replaced them.
 */
export type TaskIdentity = {
  taskID?: string
  taskSessionID?: string
}

export type PendingParentWake = {
  promptContext: ParentWakePromptContext
  notifications: string[]
  shouldReply: boolean
  queuedAt?: number
  dispatchedAt?: number
  noReplyAdmittedAt?: number
  toolCallDeferralStartedAt?: number
  allowEmptyAssistantTurnRetry?: boolean
  noAssistantOutputRetryCount?: number
  // Flat de-duplicated union across every coalesced notification; intentionally NOT index-aligned with `notifications` (an all-complete wake's identities are a superset of the progress wakes it supersedes). The flush-time race guard drops the wake only when this list is non-empty AND every entry is consumed AND the wake is not a failure wake.
  taskIdentities?: TaskIdentity[]
}

export function resolveParentWakePromptContext(promptContext: ParentWakePromptContext): ParentWakePromptContext {
  const resolvedAgent = resolveRegisteredAgentName(promptContext.agent)
  return {
    ...promptContext,
    ...(resolvedAgent ? { agent: resolvedAgent } : {}),
    ...(promptContext.model ? { model: { ...promptContext.model } } : {}),
    ...(promptContext.tools ? { tools: { ...promptContext.tools } } : {}),
  }
}

export function cloneParentWake(wake: PendingParentWake): PendingParentWake {
  const promptContext = resolveParentWakePromptContext(wake.promptContext)
  return {
    promptContext,
    notifications: [...wake.notifications],
    shouldReply: wake.shouldReply,
    ...(wake.queuedAt !== undefined ? { queuedAt: wake.queuedAt } : {}),
    ...(wake.dispatchedAt !== undefined ? { dispatchedAt: wake.dispatchedAt } : {}),
    ...(wake.noReplyAdmittedAt !== undefined ? { noReplyAdmittedAt: wake.noReplyAdmittedAt } : {}),
    ...(wake.toolCallDeferralStartedAt !== undefined
      ? { toolCallDeferralStartedAt: wake.toolCallDeferralStartedAt }
      : {}),
    ...(wake.allowEmptyAssistantTurnRetry !== undefined
      ? { allowEmptyAssistantTurnRetry: wake.allowEmptyAssistantTurnRetry }
      : {}),
    ...(wake.noAssistantOutputRetryCount !== undefined
      ? { noAssistantOutputRetryCount: wake.noAssistantOutputRetryCount }
      : {}),
    ...(wake.taskIdentities ? { taskIdentities: wake.taskIdentities.map((id) => ({ ...id })) } : {}),
  }
}

export function isRedundantParentWake(latestWake: PendingParentWake, dispatchedWake: PendingParentWake): boolean {
  return parentWakePromptContextMatches(latestWake, dispatchedWake)
    && parentWakeReplyModeIsCovered(latestWake, dispatchedWake)
    && parentWakeNotificationsAreCovered(latestWake, dispatchedWake)
}

export function mergeParentWakeNotifications(existingNotifications: readonly string[], nextNotification: string): string[] {
  if (isFinalBackgroundTaskNotification(nextNotification)) {
    return [
      nextNotification,
      ...existingNotifications.filter((notification) =>
        notification !== nextNotification
        && !isBackgroundTaskProgressNotification(notification)
      ),
    ]
  }

  if (existingNotifications.includes(nextNotification)) {
    return [...existingNotifications]
  }

  if (
    isBackgroundTaskProgressNotification(nextNotification)
    && existingNotifications.some(isFinalBackgroundTaskNotification)
  ) {
    return [...existingNotifications]
  }

  return [...existingNotifications, nextNotification]
}

function parentWakePromptContextMatches(left: PendingParentWake, right: PendingParentWake): boolean {
  return JSON.stringify(left.promptContext) === JSON.stringify(right.promptContext)
}

function parentWakeReplyModeIsCovered(latestWake: PendingParentWake, dispatchedWake: PendingParentWake): boolean {
  return !latestWake.shouldReply || dispatchedWake.shouldReply
}

function parentWakeNotificationsAreCovered(latestWake: PendingParentWake, dispatchedWake: PendingParentWake): boolean {
  const dispatchedNotifications = new Set(dispatchedWake.notifications)
  return latestWake.notifications.every((notification) => dispatchedNotifications.has(notification))
}

export function isFailureParentWake(wake: PendingParentWake): boolean {
  return wake.shouldReply && wake.notifications.some((notification) =>
    getSystemReminderHeaderLines(notification).some(isBackgroundTaskFailureHeader)
  )
}

function isBackgroundTaskFailureHeader(line: string): boolean {
  return line === "[BACKGROUND TASK ERROR]"
    || line === "[BACKGROUND TASK CANCELLED]"
    || line === "[BACKGROUND TASK INTERRUPTED]"
    || (line.startsWith("[ALL BACKGROUND TASKS FINISHED") && line.endsWith("]"))
}

function isFinalBackgroundTaskNotification(notification: string): boolean {
  return getSystemReminderHeaderLines(notification).some((line) =>
    line === "[ALL BACKGROUND TASKS COMPLETE]"
    || (line.startsWith("[ALL BACKGROUND TASKS FINISHED") && line.endsWith("]"))
  )
}

function isBackgroundTaskProgressNotification(notification: string): boolean {
  if (!getSystemReminderHeaderLines(notification).some(isBackgroundTaskProgressHeader)) {
    return false
  }

  return notification.split("\n").some((line) =>
    /^\*\*\d+ tasks? still in progress\.\*\* You WILL be notified when ALL complete\.$/.test(line.trim())
  )
}

function isBackgroundTaskProgressHeader(line: string): boolean {
  return line === "[BACKGROUND TASK RESULT READY]"
    || line === "[BACKGROUND TASK CANCELLED]"
    || line === "[BACKGROUND TASK INTERRUPTED]"
    || line === "[BACKGROUND TASK ERROR]"
}

function getSystemReminderHeaderLines(notification: string): string[] {
  const lines = notification.split("\n")
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentLineIndex === -1) {
    return []
  }

  const headerStartIndex = lines[firstContentLineIndex]?.trim() === "<system-reminder>"
    ? firstContentLineIndex + 1
    : firstContentLineIndex
  const headerLines: string[] = []
  for (let index = headerStartIndex; index < lines.length; index++) {
    const line = lines[index]?.trim()
    if (!line || line === "</system-reminder>" || !/^\[[^\]]+\]$/.test(line)) {
      break
    }
    headerLines.push(line)
  }
  return headerLines
}
