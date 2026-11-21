import { resolveRegisteredAgentName } from "../claude-code-session-state"

export type ParentWakePromptContext = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  tools?: Record<string, boolean>
}

export type PendingParentWake = {
  promptContext: ParentWakePromptContext
  notifications: string[]
  shouldReply: boolean
  queuedAt?: number
  dispatchedAt?: number
  noReplyAdmittedAt?: number
  /** Notices already deposited in the parent by an admit-only dispatch; a later reply dispatch does not repeat them. */
  admittedNotifications?: string[]
  toolCallDeferralStartedAt?: number
  allowEmptyAssistantTurnRetry?: boolean
  noAssistantOutputRetryCount?: number
  gateHoldExpiresAt?: number
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
    ...(wake.admittedNotifications !== undefined ? { admittedNotifications: [...wake.admittedNotifications] } : {}),
    ...(wake.toolCallDeferralStartedAt !== undefined
      ? { toolCallDeferralStartedAt: wake.toolCallDeferralStartedAt }
      : {}),
    ...(wake.allowEmptyAssistantTurnRetry !== undefined
      ? { allowEmptyAssistantTurnRetry: wake.allowEmptyAssistantTurnRetry }
      : {}),
    ...(wake.noAssistantOutputRetryCount !== undefined
      ? { noAssistantOutputRetryCount: wake.noAssistantOutputRetryCount }
      : {}),
    ...(wake.gateHoldExpiresAt !== undefined ? { gateHoldExpiresAt: wake.gateHoldExpiresAt } : {}),
  }
}

export function isRedundantParentWake(latestWake: PendingParentWake, dispatchedWake: PendingParentWake): boolean {
  return (
    parentWakePromptContextMatches(latestWake, dispatchedWake) &&
    parentWakeReplyModeIsCovered(latestWake, dispatchedWake) &&
    parentWakeNotificationsAreCovered(latestWake, dispatchedWake)
  )
}

export function mergeParentWakeNotifications(
  existingNotifications: readonly string[],
  nextNotification: string,
): string[] {
  // Every background task notice carries its own result, so none replaces another; only exact repeats collapse.
  if (existingNotifications.includes(nextNotification)) {
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
  return (
    wake.shouldReply &&
    wake.notifications.some((notification) =>
      getSystemReminderHeaderLines(notification).some(isBackgroundTaskFailureHeader),
    )
  )
}

function isBackgroundTaskFailureHeader(line: string): boolean {
  return (
    line === "[BACKGROUND TASK ERROR]" ||
    line === "[BACKGROUND TASK CANCELLED]" ||
    line === "[BACKGROUND TASK INTERRUPTED]"
  )
}

function getSystemReminderHeaderLines(notification: string): string[] {
  const lines = notification.split("\n")
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentLineIndex === -1) {
    return []
  }

  const headerStartIndex =
    lines[firstContentLineIndex]?.trim() === "<system-reminder>" ? firstContentLineIndex + 1 : firstContentLineIndex
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
