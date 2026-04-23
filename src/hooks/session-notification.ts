import type { PluginInput } from "@opencode-ai/plugin"
import { subagentSessions, getMainSessionID } from "../features/claude-code-session-state"
import { buildReadyNotificationContent } from "./session-notification-content"
import { type Platform } from "./session-notification-sender"
import * as sessionNotificationSender from "./session-notification-sender"
import { getEventToolName, getQuestionText, getSessionID } from "./session-notification-event-properties"
import { hasIncompleteTodos } from "./session-todo-status"
import { createIdleNotificationScheduler } from "./session-notification-scheduler"
import { createSessionNotificationInit } from "./session-notification-init"

interface SessionNotificationConfig {
  title?: string
  message?: string
  questionMessage?: string
  permissionMessage?: string
  playSound?: boolean
  soundPath?: string
  /** Delay in ms before sending notification to confirm session is still idle (default: 1500) */
  idleConfirmationDelay?: number
  /** Skip notification if there are incomplete todos (default: true) */
  skipIfIncompleteTodos?: boolean
  /** Maximum number of sessions to track before cleanup (default: 100) */
  maxTrackedSessions?: number
  enforceMainSessionFilter?: boolean
  /** Grace period in ms to ignore late-arriving activity events after scheduling (default: 100) */
  activityGracePeriodMs?: number
}

export function createSessionNotification(ctx: PluginInput, config: SessionNotificationConfig = {}) {
  const mergedConfig = {
    title: "OpenCode",
    message: "Agent is ready for input",
    questionMessage: "Agent is asking a question",
    permissionMessage: "Agent needs permission to continue",
    playSound: false,
    soundPath: "",
    idleConfirmationDelay: 1500,
    skipIfIncompleteTodos: true,
    maxTrackedSessions: 100,
    enforceMainSessionFilter: true,
    ...config,
  }

  const sessionNotificationInit = createSessionNotificationInit()
  let currentPlatform: Platform | null = null
  let defaultSoundPath = mergedConfig.soundPath

  const scheduler = createIdleNotificationScheduler({
    ctx,
    platform: "unsupported",
    config: mergedConfig,
    hasIncompleteTodos,
    send: async (hookCtx, platform, sessionID) => {
      if (typeof hookCtx.client.session.get !== "function" && typeof hookCtx.client.session.messages !== "function") {
        await sessionNotificationSender.sendSessionNotification(hookCtx, platform, mergedConfig.title, mergedConfig.message)
        return
      }

      const content = await buildReadyNotificationContent(hookCtx, {
        sessionID,
        baseTitle: mergedConfig.title,
        baseMessage: mergedConfig.message,
      })

      await sessionNotificationSender.sendSessionNotification(hookCtx, platform, content.title, content.message)
    },
    playSound: sessionNotificationSender.playSessionNotificationSound,
  })

  const QUESTION_TOOLS = new Set(["question", "ask_user_question", "askuserquestion"])
  const PERMISSION_EVENTS = new Set(["permission.ask", "permission.asked", "permission.updated", "permission.requested"])
  const PERMISSION_HINT_PATTERN = /\b(permission|approve|approval|allow|deny|consent)\b/i

  const ensureNotificationPlatform = (): Platform => {
    if (currentPlatform) return currentPlatform

    const initialized = sessionNotificationInit.initialize()
    currentPlatform = initialized.platform
    defaultSoundPath = initialized.defaultSoundPath || mergedConfig.soundPath
    return currentPlatform
  }

  const shouldNotifyForSession = (sessionID: string): boolean => {
    if (subagentSessions.has(sessionID)) return false

    if (mergedConfig.enforceMainSessionFilter) {
      const mainSessionID = getMainSessionID()
      if (mainSessionID && sessionID !== mainSessionID) return false
    }

    return true
  }

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.id as string | undefined
      if (sessionID) scheduler.markSessionActivity(sessionID)
      return
    }

    if (event.type === "session.idle") {
      const sessionID = getSessionID(props)
      if (!sessionID) return

      const platform = ensureNotificationPlatform()
      if (platform === "unsupported") return
      if (!shouldNotifyForSession(sessionID)) return

      scheduler.scheduleIdleNotification(sessionID)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = getSessionID({ ...props, info })
      if (sessionID) scheduler.markSessionActivity(sessionID)
      return
    }

    if (PERMISSION_EVENTS.has(event.type)) {
      const sessionID = getSessionID(props)
      if (!sessionID) return

      const platform = ensureNotificationPlatform()
      if (platform === "unsupported") return
      if (!shouldNotifyForSession(sessionID)) return

      scheduler.markSessionActivity(sessionID)
      await sessionNotificationSender.sendSessionNotification(ctx, platform, mergedConfig.title, mergedConfig.permissionMessage)
      if (mergedConfig.playSound && defaultSoundPath) {
        await sessionNotificationSender.playSessionNotificationSound(ctx, platform, defaultSoundPath)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = getSessionID(props)
      if (sessionID) {
        scheduler.markSessionActivity(sessionID)

        if (event.type === "tool.execute.before") {
          const toolName = getEventToolName(props)?.toLowerCase()
          if (toolName && QUESTION_TOOLS.has(toolName)) {
            const platform = ensureNotificationPlatform()
            if (platform === "unsupported") return
            if (!shouldNotifyForSession(sessionID)) return

            const questionText = getQuestionText(props)
            const message = PERMISSION_HINT_PATTERN.test(questionText) ? mergedConfig.permissionMessage : mergedConfig.questionMessage

            await sessionNotificationSender.sendSessionNotification(ctx, platform, mergedConfig.title, message)
            if (mergedConfig.playSound && defaultSoundPath) {
              await sessionNotificationSender.playSessionNotificationSound(ctx, platform, defaultSoundPath)
            }
          }
        }
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) scheduler.deleteSession(sessionInfo.id)
    }
  }
}
