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
    questionMessage: "Agent is asking a question",
    permissionMessage: "Agent needs permission to continue",
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

  const QUESTION_TOOLS = new Set(["question", "ask_user_question", "askuserquestion"])
  const PERMISSION_EVENTS = new Set(["permission.ask", "permission.asked", "permission.updated", "permission.requested"])
  const PERMISSION_HINT_PATTERN = /\b(permission|approve|approval|allow|deny|consent)\b/i

  const getSessionID = (properties: Record<string, unknown> | undefined): string | undefined => {
    const sessionID = properties?.sessionID
    if (typeof sessionID === "string" && sessionID.length > 0) return sessionID

    const sessionId = properties?.sessionId
    if (typeof sessionId === "string" && sessionId.length > 0) return sessionId

    const info = properties?.info as Record<string, unknown> | undefined
    const infoSessionID = info?.sessionID
    if (typeof infoSessionID === "string" && infoSessionID.length > 0) return infoSessionID

    const infoSessionId = info?.sessionId
    if (typeof infoSessionId === "string" && infoSessionId.length > 0) return infoSessionId

    return undefined
  }

  const shouldNotifyForSession = (sessionID: string): boolean => {
    if (subagentSessions.has(sessionID)) return false

    const mainSessionID = getMainSessionID()
    if (mainSessionID && sessionID !== mainSessionID) return false

    return true
  }

  const getEventToolName = (properties: Record<string, unknown> | undefined): string | undefined => {
    const tool = properties?.tool
    if (typeof tool === "string" && tool.length > 0) return tool

    const name = properties?.name
    if (typeof name === "string" && name.length > 0) return name

    return undefined
  }

  const getQuestionText = (properties: Record<string, unknown> | undefined): string => {
    const args = properties?.args as Record<string, unknown> | undefined
    const questions = args?.questions
    if (!Array.isArray(questions) || questions.length === 0) return ""

    const firstQuestion = questions[0] as Record<string, unknown> | undefined
    const questionText = firstQuestion?.question
    return typeof questionText === "string" ? questionText : ""
  }

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
      const sessionID = getSessionID(props)
      if (!sessionID) return

      if (!shouldNotifyForSession(sessionID)) return

      scheduler.scheduleIdleNotification(sessionID)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = getSessionID({ ...props, info })
      if (sessionID) {
        scheduler.markSessionActivity(sessionID)
      }
      return
    }

    if (PERMISSION_EVENTS.has(event.type)) {
      const sessionID = getSessionID(props)
      if (!sessionID) return
      if (!shouldNotifyForSession(sessionID)) return

      scheduler.markSessionActivity(sessionID)
      await sendSessionNotification(ctx, currentPlatform, mergedConfig.title, mergedConfig.permissionMessage)
      if (mergedConfig.playSound && mergedConfig.soundPath) {
        await playSessionNotificationSound(ctx, currentPlatform, mergedConfig.soundPath)
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
            if (!shouldNotifyForSession(sessionID)) return

            const questionText = getQuestionText(props)
            const message = PERMISSION_HINT_PATTERN.test(questionText)
              ? mergedConfig.permissionMessage
              : mergedConfig.questionMessage

            await sendSessionNotification(ctx, currentPlatform, mergedConfig.title, message)
            if (mergedConfig.playSound && mergedConfig.soundPath) {
              await playSessionNotificationSound(ctx, currentPlatform, mergedConfig.soundPath)
            }
          }
        }
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
