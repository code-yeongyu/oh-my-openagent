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
  dispatchedAt?: number
  toolCallDeferralStartedAt?: number
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
    ...(wake.dispatchedAt !== undefined ? { dispatchedAt: wake.dispatchedAt } : {}),
    ...(wake.toolCallDeferralStartedAt !== undefined
      ? { toolCallDeferralStartedAt: wake.toolCallDeferralStartedAt }
      : {}),
  }
}

export function isRedundantParentWake(latestWake: PendingParentWake, dispatchedWake: PendingParentWake): boolean {
  return parentWakePromptContextMatches(latestWake, dispatchedWake)
    && parentWakeReplyModeIsCovered(latestWake, dispatchedWake)
    && parentWakeNotificationsAreCovered(latestWake, dispatchedWake)
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
