import type { PluginInput } from "@opencode-ai/plugin"
import type { NotificationOnIdleConfig } from "./types"

export type { NotificationOnIdleConfig }

// Question detection patterns (English + Korean)
const questionPatterns = [
  // English patterns
  /\?\s*$/,                    // Ends with question mark
  /would you like/i,          // Suggestion question
  /do you want/i,             // Intent question
  /should I/i,                // Confirmation question
  /what (do|would|should)/i,  // What question
  /which (one|option)/i,      // Choice question
  /please (confirm|choose|select)/i,  // Confirmation request

  // Korean patterns
  /[인가요까요할까요실까요드릴까요볼까요]\s*[?]?\s*$/,  // Question endings
  /어떻게\s*(할까요|하실|생각하)/,  // How question
  /원하시|선택해|확인해/,          // Request patterns
]

function containsQuestion(content: string): boolean {
  return questionPatterns.some((pattern) => pattern.test(content))
}

async function findCommand(name: string): Promise<string | null> {
  try {
    const result = await Bun.$`which ${name}`.text()
    return result.trim() || null
  } catch {
    return null
  }
}

async function sendNotification(ctx: PluginInput, title: string, message: string): Promise<void> {
  // 1. Try terminal-notifier first
  const terminalNotifier = await findCommand("terminal-notifier")
  if (terminalNotifier) {
    await ctx.$`${terminalNotifier} -title ${title} -message ${message}`.catch(() => {})
    return
  }

  // 2. Fallback to osascript
  const osascript = await findCommand("osascript")
  if (osascript) {
    const esTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    const esMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    await ctx.$`${osascript} -e ${"display notification \"" + esMessage + "\" with title \"" + esTitle + "\""}`.catch(() => {})
    return
  }

  // 3. No notification method available - log warning
  console.warn(`[notification-on-idle] No notification method available. ${title}: ${message}`)
}

export function createNotificationOnIdleHook(
  ctx: PluginInput,
  config: NotificationOnIdleConfig = {}
) {
  const mergedConfig = {
    title: "OpenCode",
    questionMessage: "AI has a question for you",
    completeMessage: "Response complete",
    ...config,
  }

  // State: track sessions that have already been notified about a question
  const questionNotifiedSessions = new Set<string>()

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined

      // Handle message.updated - check for AI questions
      if (event.type === "message.updated") {
        const info = props?.info as { sessionID?: string; role?: string } | undefined
        const content = props?.content as string | undefined
        const sessionID = info?.sessionID

        if (!sessionID || !content) return

        // Only check assistant messages
        if (info?.role !== "assistant") return

        // Skip if already notified for this session
        if (questionNotifiedSessions.has(sessionID)) return

        // Check if content contains a question
        if (containsQuestion(content)) {
          questionNotifiedSessions.add(sessionID)
          await sendNotification(ctx, mergedConfig.title, mergedConfig.questionMessage)
        }
        return
      }

      // Handle session.idle - send completion notification
      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        // Reset question notification state for next turn
        questionNotifiedSessions.delete(sessionID)

        // Send completion notification
        await sendNotification(ctx, mergedConfig.title, mergedConfig.completeMessage)
        return
      }

      // Handle session.deleted - cleanup state
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          questionNotifiedSessions.delete(sessionInfo.id)
        }
      }
    },
  }
}
