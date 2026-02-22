import type { PluginInput } from "@opencode-ai/plugin"
import { subagentSessions, getMainSessionID } from "../features/claude-code-session-state"
import {
  startBackgroundCheck,
} from "./session-notification-utils"
import {
  detectPlatform,
  getDefaultSoundPath,
  playSessionNotificationSound,
  sendSessionNotification,
} from "./session-notification-sender"
import { hasIncompleteTodos } from "./session-todo-status"
import { createIdleNotificationScheduler } from "./session-notification-scheduler"

interface SessionNotificationConfig {
  title?: string
  message?: string
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
    message: "Agent is ready for input",
    playSound: false,
    soundPath: defaultSoundPath,
    idleConfirmationDelay: 1500,
    skipIfIncompleteTodos: true,
    maxTrackedSessions: 100,
    ...config,
  }

  const scheduler = createIdleNotificationScheduler({
    ctx,
    platform: currentPlatform,
    config: mergedConfig,
    hasIncompleteTodos,
    send: sendSessionNotification,
    playSound: playSessionNotificationSound,
  })

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (currentPlatform === "unsupported") return

    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.id as string | undefined
      if (sessionID) {
        scheduler.markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      if (subagentSessions.has(sessionID)) return

      // Only trigger notifications for the main session (not subagent sessions)
      const mainSessionID = getMainSessionID()
      if (mainSessionID && sessionID !== mainSessionID) return

      scheduler.scheduleIdleNotification(sessionID)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (sessionID) {
        scheduler.markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        scheduler.markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        scheduler.deleteSession(sessionInfo.id)
      }
    }
  }
}
