import type { BackgroundManager } from "../../features/background-agent"
import { getMainSessionID, getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { createInternalAgentTextPart, isAmbiguousPostDispatchPromptFailure, resolveInheritedPromptTools } from "../../shared"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { isAbortError } from "../../shared/is-abort-error"
import {
  buildReminder,
  extractMessages,
  getMessageCreatedAt,
  getMessageInfo,
  getMessageParts,
  isUnstableTask,
  THINKING_SUMMARY_MAX_CHARS,
} from "./task-message-analyzer"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"

const HOOK_NAME = "unstable-agent-babysitter"
const DEFAULT_TIMEOUT_MS = 120000
const COOLDOWN_MS = 5 * 60 * 1000
const USER_MESSAGE_IN_PROGRESS_WINDOW_MS = 2000

type BabysittingConfig = {
  timeout_ms?: number
}

type BabysitterContext = {
  directory: string
  client: {
    session: {
      messages: (args: { path: { id: string } }) => Promise<{ data?: unknown } | unknown[]>
      promptAsync: (args: {
        path: { id: string }
        body: {
          parts: Array<{ type: "text"; text: string }>
          agent?: string
          variant?: string
          model?: { providerID: string; modelID: string }
          tools?: Record<string, boolean>
        }
        query?: { directory?: string }
      }) => Promise<unknown>
      status?: () => Promise<unknown>
    }
  }
}

type BabysitterOptions = {
  backgroundManager: Pick<BackgroundManager, "getTasksByParentSession">
  config?: BabysittingConfig
  idleSettleMs?: number
}


function getTaskSessionId(task: { sessionId?: string | null; sessionID?: string | null }): string | undefined {
  return task.sessionId ?? task.sessionID ?? undefined
}

async function resolveMainSessionTarget(
  ctx: BabysitterContext,
  sessionID: string
): Promise<{ agent?: string; model?: { providerID: string; modelID: string; variant?: string }; tools?: Record<string, boolean> }> {
  let agent = getSessionAgent(sessionID)
  let model: { providerID: string; modelID: string; variant?: string } | undefined
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

async function latestMainSessionUserMessageIsInProgress(ctx: BabysitterContext, sessionID: string, now: number): Promise<boolean> {
  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
    })
    const messages = extractMessages(messagesResp)
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      const role = getMessageInfo(message)?.role
      if (role === "user") {
        const createdAt = getMessageCreatedAt(message)
        return createdAt !== undefined && now - createdAt <= USER_MESSAGE_IN_PROGRESS_WINDOW_MS
      }
      if (role === "assistant" || role === "tool") {
        return false
      }
    }
    return false
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to inspect recent main session user activity`, { sessionID, error: String(error) })
    return false
  }
}

function getTaskLastActivityAt(task: { progress?: { lastUpdate?: Date; lastMessageAt?: Date } }): Date | undefined {
  const lastMessageAt = task.progress?.lastMessageAt
  const lastUpdate = task.progress?.lastUpdate
  if (!lastMessageAt) return lastUpdate
  if (!lastUpdate) return lastMessageAt
  return lastUpdate.getTime() > lastMessageAt.getTime() ? lastUpdate : lastMessageAt
}

export function createUnstableAgentBabysitterHook(ctx: BabysitterContext, options: BabysitterOptions) {
  const reminderCooldowns = new Map<string, number>()
  const cancelledSessions = new Set<string>()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = resolveSessionEventID(props)
      if (!sessionID || !isAbortError(props?.error)) return

      cancelledSessions.add(sessionID)
      log(`[${HOOK_NAME}] Marked session cancelled`, { sessionID })
      return
    }

    if (event.type === "session.stop") {
      const sessionID = resolveSessionEventID(props)
      if (!sessionID) return

      cancelledSessions.add(sessionID)
      log(`[${HOOK_NAME}] Marked session cancelled via session.stop`, { sessionID })
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = resolveMessageEventSessionID(props)
      const role = info?.role as string | undefined
      if (!sessionID || (role !== "user" && role !== "assistant")) return

      cancelledSessions.delete(sessionID)
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = resolveMessageEventSessionID(props)
      if (!sessionID) return

      cancelledSessions.delete(sessionID)
      return
    }

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(props)
      if (!sessionID) return

      cancelledSessions.delete(sessionID)
      return
    }

    if (event.type !== "session.idle") return

    const sessionID = resolveSessionEventID(props)
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
    if (await latestMainSessionUserMessageIsInProgress(ctx, mainSessionID, now)) {
      log(`[${HOOK_NAME}] Skipped reminder: main session has recent user activity`, { sessionID: mainSessionID })
      return
    }

    for (const task of tasks) {
      if (task.status !== "running") continue
      if (!isUnstableTask(task)) continue

      const lastActivityAt = getTaskLastActivityAt(task)
      if (!lastActivityAt) continue

      const idleMs = now - lastActivityAt.getTime()
      if (idleMs < timeoutMs) continue

      const lastReminderAt = reminderCooldowns.get(task.id)
      if (lastReminderAt && now - lastReminderAt < COOLDOWN_MS) continue

      const taskSessionId = getTaskSessionId(task)
      const summary = taskSessionId ? await getThinkingSummary(ctx, taskSessionId) : null
      const reminder = buildReminder(task, summary, idleMs)
      const { agent, model, tools } = await resolveMainSessionTarget(ctx, mainSessionID)

      try {
        if (options.idleSettleMs !== undefined && options.idleSettleMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.idleSettleMs))
          if (cancelledSessions.has(mainSessionID)) {
            log(`[${HOOK_NAME}] Skipped reminder: session was cancelled during idle settle`, {
              sessionID: mainSessionID,
            })
            continue
          }
        }

        const launchModel = model
          ? { providerID: model.providerID, modelID: model.modelID }
          : undefined
        const launchVariant = model?.variant
        const promptResult = await dispatchInternalPrompt({
          mode: "async",
          client: ctx.client,
          sessionID: mainSessionID,
          source: HOOK_NAME,
          settleMs: options.idleSettleMs === undefined ? undefined : 0,
          queueBehavior: "defer",
          input: {
            path: { id: mainSessionID },
            body: {
              ...(agent ? { agent } : {}),
              ...(launchModel ? { model: launchModel } : {}),
              ...(launchVariant ? { variant: launchVariant } : {}),
              ...(tools ? { tools } : {}),
              parts: [createInternalAgentTextPart(reminder)],
            },
            query: { directory: ctx.directory },
          },
        })
        if (!isInternalPromptDispatchAccepted(promptResult)) {
          if (promptResult.status === "failed" && isAmbiguousPostDispatchPromptFailure(promptResult)) {
            reminderCooldowns.set(task.id, now)
          }
          log(`[${HOOK_NAME}] Reminder skipped by promptAsync gate`, {
            taskId: task.id,
            sessionID: mainSessionID,
            status: promptResult.status,
          })
          continue
        }

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
