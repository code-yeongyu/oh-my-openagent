import type { PluginInput } from "@opencode-ai/plugin"
import { subagentSessions, getMainSessionID } from "../features/claude-code-session-state"
import { startBackgroundCheck, cleanupOldSessions } from "./session-notification-utils"
import {
  detectPlatform,
  getDefaultSoundPath,
  sendNotification,
  playSound,
  hasIncompleteTodos,
} from "./session-notification-platform"
import { extractProjectName, resolveMessageFormat } from "./session-notification-format"

interface SessionNotificationConfig {
  title?: string
  /** Custom message format with {project} and {cwd} template variables */
  message_format?: string
  playSound?: boolean
  soundPath?: string
  /** Delay in ms before sending notification to confirm session is still idle (default: 1500) */
  idleConfirmationDelay?: number
  /** Skip notification if there are incomplete todos (default: true) */
  skipIfIncompleteTodos?: boolean
  /** Maximum number of sessions to track before cleanup (default: 100) */
  maxTrackedSessions?: number
}

export function createSessionNotification(
  ctx: PluginInput,
  config: SessionNotificationConfig = {}
) {
  const currentPlatform = detectPlatform()
  const defaultSoundPath = getDefaultSoundPath(currentPlatform)

  startBackgroundCheck(currentPlatform)

  const mergedConfig = {
    title: "OpenCode",
    message_format: "{project} \u2014 Agent is ready for input",
    playSound: false,
    soundPath: defaultSoundPath,
    idleConfirmationDelay: 1500,
    skipIfIncompleteTodos: true,
    maxTrackedSessions: 100,
    ...config,
  }

  const notifiedSessions = new Set<string>()
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const sessionActivitySinceIdle = new Set<string>()
  // Track notification execution version to handle race conditions
  const notificationVersions = new Map<string, number>()
  // Track sessions currently executing notification (prevents duplicate execution)
  const executingNotifications = new Set<string>()

  function cleanupTrackedSessions() {
    cleanupOldSessions(
      mergedConfig.maxTrackedSessions,
      notifiedSessions,
      sessionActivitySinceIdle,
      notificationVersions,
      executingNotifications,
    )
  }

  function cancelPendingNotification(sessionID: string) {
    const timer = pendingTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      pendingTimers.delete(sessionID)
    }
    sessionActivitySinceIdle.add(sessionID)
    // Increment version to invalidate any in-flight notifications
    notificationVersions.set(sessionID, (notificationVersions.get(sessionID) ?? 0) + 1)
  }

  function markSessionActivity(sessionID: string) {
    cancelPendingNotification(sessionID)
    if (!executingNotifications.has(sessionID)) {
      notifiedSessions.delete(sessionID)
    }
  }

  async function executeNotification(sessionID: string, version: number) {
    if (executingNotifications.has(sessionID)) { pendingTimers.delete(sessionID); return }
    if (notificationVersions.get(sessionID) !== version) { pendingTimers.delete(sessionID); return }
    if (sessionActivitySinceIdle.has(sessionID)) {
      sessionActivitySinceIdle.delete(sessionID); pendingTimers.delete(sessionID); return
    }
    if (notifiedSessions.has(sessionID)) { pendingTimers.delete(sessionID); return }

    executingNotifications.add(sessionID)
    try {
      if (mergedConfig.skipIfIncompleteTodos) {
        const hasPendingWork = await hasIncompleteTodos(ctx, sessionID)
        if (notificationVersions.get(sessionID) !== version) return
        if (hasPendingWork) return
      }

      if (notificationVersions.get(sessionID) !== version) return
      if (sessionActivitySinceIdle.has(sessionID)) {
        sessionActivitySinceIdle.delete(sessionID); return
      }

      notifiedSessions.add(sessionID)

      const project = extractProjectName(ctx.directory)
      const resolvedMessage = resolveMessageFormat(
        mergedConfig.message_format,
        { project, cwd: ctx.directory }
      )
      await sendNotification(ctx, currentPlatform, mergedConfig.title, resolvedMessage)

      if (mergedConfig.playSound && mergedConfig.soundPath) {
        await playSound(ctx, currentPlatform, mergedConfig.soundPath)
      }
    } finally {
      executingNotifications.delete(sessionID)
      pendingTimers.delete(sessionID)
      // Clear notified state if there was activity during notification
      if (sessionActivitySinceIdle.has(sessionID)) {
        notifiedSessions.delete(sessionID)
        sessionActivitySinceIdle.delete(sessionID)
      }
    }
  }

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (currentPlatform === "unsupported") return

    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.id as string | undefined
      if (sessionID) {
        markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      if (subagentSessions.has(sessionID)) return

      const mainSessionID = getMainSessionID()
      if (mainSessionID && sessionID !== mainSessionID) return

      if (notifiedSessions.has(sessionID)) return
      if (pendingTimers.has(sessionID)) return
      if (executingNotifications.has(sessionID)) return

      sessionActivitySinceIdle.delete(sessionID)
      
      const currentVersion = (notificationVersions.get(sessionID) ?? 0) + 1
      notificationVersions.set(sessionID, currentVersion)

      const timer = setTimeout(() => {
        executeNotification(sessionID, currentVersion)
      }, mergedConfig.idleConfirmationDelay)

      pendingTimers.set(sessionID, timer)
      cleanupTrackedSessions()
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const role = info?.role as string | undefined
      const sessionID = info?.sessionID as string | undefined
      if (sessionID && role === "assistant") {
        markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cancelPendingNotification(sessionInfo.id)
        notifiedSessions.delete(sessionInfo.id)
        sessionActivitySinceIdle.delete(sessionInfo.id)
        notificationVersions.delete(sessionInfo.id)
        executingNotifications.delete(sessionInfo.id)
      }
    }
  }
}
