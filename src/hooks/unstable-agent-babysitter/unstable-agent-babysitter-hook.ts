import type { BackgroundManager } from "../../features/background-agent"
import { getMainSessionID, getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { createInternalAgentTextPart, resolveInheritedPromptTools } from "../../shared"
import { isAbortError } from "../../shared/is-abort-error"
import {
  buildReminder,
  extractMessages,
  getMessageInfo,
  getMessageParts,
  isUnstableTask,
  THINKING_SUMMARY_MAX_CHARS,
} from "./task-message-analyzer"

const HOOK_NAME = "unstable-agent-babysitter"
const DEFAULT_TIMEOUT_MS = 120000
const COOLDOWN_MS = 5 * 60 * 1000

type BabysittingConfig = {
  timeout_ms?: number
}

type BabysitterContext = {
  directory: string
  client: {
    session: {
      messages: (args: { path: { id: string } }) => Promise<{ data?: unknown } | unknown[]>
      prompt: (args: {
        path: { id: string }
        body: {
          parts: Array<{ type: "text"; text: string }>
          agent?: string
          model?: { providerID: string; modelID: string }
          tools?: Record<string, boolean>
        }
        query?: { directory?: string }
      }) => Promise<unknown>
      promptAsync: (args: {
        path: { id: string }
        body: {
          parts: Array<{ type: "text"; text: string }>
          agent?: string
          model?: { providerID: string; modelID: string }
          tools?: Record<string, boolean>
        }
        query?: { directory?: string }
      }) => Promise<unknown>
    }
  }
}

type BabysitterOptions = {
  backgroundManager: Pick<BackgroundManager, "getTasksByParentSession">
  config?: BabysittingConfig
}


async function resolveMainSessionTarget(
  ctx: BabysitterContext,
  sessionID: string
): Promise<{ agent?: string; model?: { providerID: string; modelID: string }; tools?: Record<string, boolean> }> {
  let agent = getSessionAgent(sessionID)
  let model: { providerID: string; modelID: string } | undefined
  let tools: Record<string, boolean> | undefined

  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
    })
    const messages = extractMessages(messagesResp)
    for (let i = messages.length - 1; i >= 0; i--) {
      const info = getMessageInfo(messages[i])
      if (info?.agent || info?.model || (info?.providerID && info?.modelID)) {
        agent = agent ?? info?.agent
        model = info?.model ?? (info?.providerID && info?.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined)
        tools = resolveInheritedPromptTools(sessionID, info?.tools) ?? tools
        break
      }
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to resolve main session agent`, { sessionID, error: String(error) })
  }

  return { agent, model, tools: resolveInheritedPromptTools(sessionID, tools) }
}

async function getThinkingSummary(ctx: BabysitterContext, sessionID: string): Promise<string | null> {
  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
    })
    const messages = extractMessages(messagesResp)
    const chunks: string[] = []

    for (const message of messages) {
      const info = getMessageInfo(message)
      if (info?.role !== "assistant") continue
      const parts = getMessageParts(message)
      for (const part of parts) {
        if (part.type === "thinking" && part.thinking) {
          chunks.push(part.thinking)
        }
        if (part.type === "reasoning" && part.text) {
          chunks.push(part.text)
        }
      }
    }

    const combined = chunks.join("\n").trim()
    if (!combined) return null
    if (combined.length <= THINKING_SUMMARY_MAX_CHARS) return combined
    return combined.slice(0, THINKING_SUMMARY_MAX_CHARS) + "..."
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to fetch thinking summary`, { sessionID, error: String(error) })
    return null
  }
}

export function createUnstableAgentBabysitterHook(ctx: BabysitterContext, options: BabysitterOptions) {
  const reminderCooldowns = new Map<string, number>()
  const cancelledSessions = new Set<string>()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID || !isAbortError(props?.error)) return

      cancelledSessions.add(sessionID)
      reminderCooldowns.clear()
      log(`[${HOOK_NAME}] Marked session cancelled`, { sessionID })
      return
    }

    if (event.type === "session.stop") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      cancelledSessions.add(sessionID)
      reminderCooldowns.clear()
      log(`[${HOOK_NAME}] Marked session cancelled via session.stop`, { sessionID })
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined
      if (!sessionID || (role !== "user" && role !== "assistant")) return

      cancelledSessions.delete(sessionID)
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      cancelledSessions.delete(sessionID)
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (!sessionInfo?.id) return

      cancelledSessions.delete(sessionInfo.id)
      return
    }

    if (event.type !== "session.idle") return

    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    const mainSessionID = getMainSessionID()
    if (!mainSessionID || sessionID !== mainSessionID) return

    if (cancelledSessions.has(mainSessionID)) {
      log(`[${HOOK_NAME}] Skipped reminder: session was cancelled`, { sessionID: mainSessionID })
      return
    }

    const tasks = options.backgroundManager.getTasksByParentSession(mainSessionID)
    if (tasks.length === 0) return

    const timeoutMs = options.config?.timeout_ms ?? DEFAULT_TIMEOUT_MS
    const now = Date.now()

    for (const task of tasks) {
      if (task.status !== "running") continue
      if (!isUnstableTask(task)) continue

      const lastMessageAt = task.progress?.lastMessageAt
      if (!lastMessageAt) continue

      const idleMs = now - lastMessageAt.getTime()
      if (idleMs < timeoutMs) continue

      const lastReminderAt = reminderCooldowns.get(task.id)
      if (lastReminderAt && now - lastReminderAt < COOLDOWN_MS) continue

      const summary = task.sessionID ? await getThinkingSummary(ctx, task.sessionID) : null
      const reminder = buildReminder(task, summary, idleMs)
      const { agent, model, tools } = await resolveMainSessionTarget(ctx, mainSessionID)

      try {
        await ctx.client.session.promptAsync({
          path: { id: mainSessionID },
          body: {
            ...(agent ? { agent } : {}),
            ...(model ? { model } : {}),
            ...(tools ? { tools } : {}),
            parts: [createInternalAgentTextPart(reminder)],
          },
          query: { directory: ctx.directory },
        })
        reminderCooldowns.set(task.id, now)
        log(`[${HOOK_NAME}] Reminder injected`, { taskId: task.id, sessionID: mainSessionID })
      } catch (error) {
        log(`[${HOOK_NAME}] Reminder injection failed`, { taskId: task.id, error: String(error) })
      }
    }
  }

  return {
    event: eventHandler,
  }
}
