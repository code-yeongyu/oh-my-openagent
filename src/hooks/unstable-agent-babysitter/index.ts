import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import { getMainSessionID, getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"

const HOOK_NAME = "unstable-agent-babysitter"
const DEFAULT_TIMEOUT_MS = 120000
const COOLDOWN_MS = 5 * 60 * 1000
const THINKING_SUMMARY_MAX_CHARS = 500

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
        }
        query?: { directory?: string }
      }) => Promise<unknown>
      promptAsync: (args: {
        path: { id: string }
        body: {
          parts: Array<{ type: "text"; text: string }>
          agent?: string
          model?: { providerID: string; modelID: string }
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

type MessageInfo = {
  role?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  providerID?: string
  modelID?: string
}

type MessagePart = {
  type?: string
  text?: string
  thinking?: string
}

function hasData(value: unknown): value is { data?: unknown } {
  return typeof value === "object" && value !== null && "data" in value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getMessageInfo(value: unknown): MessageInfo | undefined {
  if (!isRecord(value)) return undefined
  if (!isRecord(value.info)) return undefined
  const info = value.info
  const modelValue = isRecord(info.model)
    ? info.model
    : undefined
  const model = modelValue && typeof modelValue.providerID === "string" && typeof modelValue.modelID === "string"
    ? { providerID: modelValue.providerID, modelID: modelValue.modelID }
    : undefined
  return {
    role: typeof info.role === "string" ? info.role : undefined,
    agent: typeof info.agent === "string" ? info.agent : undefined,
    model,
    providerID: typeof info.providerID === "string" ? info.providerID : undefined,
    modelID: typeof info.modelID === "string" ? info.modelID : undefined,
  }
}

function getMessageParts(value: unknown): MessagePart[] {
  if (!isRecord(value)) return []
  if (!Array.isArray(value.parts)) return []
  return value.parts.filter(isRecord).map((part) => ({
    type: typeof part.type === "string" ? part.type : undefined,
    text: typeof part.text === "string" ? part.text : undefined,
    thinking: typeof part.thinking === "string" ? part.thinking : undefined,
  }))
}

function extractMessages(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  if (hasData(value) && Array.isArray(value.data)) {
    return value.data
  }
  return []
}

function isUnstableTask(task: BackgroundTask): boolean {
  if (task.isUnstableAgent === true) return true
  const modelId = task.model?.modelID?.toLowerCase()
  return modelId ? modelId.includes("gemini") || modelId.includes("minimax") : false
}

async function resolveMainSessionTarget(
  ctx: BabysitterContext,
  sessionID: string
): Promise<{ agent?: string; model?: { providerID: string; modelID: string } }> {
  let agent = getSessionAgent(sessionID)
  let model: { providerID: string; modelID: string } | undefined

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
        break
      }
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to resolve main session agent`, { sessionID, error: String(error) })
  }

  return { agent, model }
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

function buildReminder(task: BackgroundTask, summary: string | null, idleMs: number): string {
  const idleSeconds = Math.round(idleMs / 1000)
  const summaryText = summary ?? "(No thinking trace available)"
  return `Unstable background agent appears idle for ${idleSeconds}s.

Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}
Session ID: ${task.sessionID ?? "N/A"}

Thinking summary (first ${THINKING_SUMMARY_MAX_CHARS} chars):
${summaryText}

Suggested actions:
- background_output task_id="${task.id}" full_session=true include_thinking=true include_tool_results=true message_limit=50
- background_cancel taskId="${task.id}"

This is a reminder only. No automatic action was taken.`
}

export function createUnstableAgentBabysitterHook(ctx: BabysitterContext, options: BabysitterOptions) {
  const reminderCooldowns = new Map<string, number>()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type !== "session.idle") return

    const props = event.properties as Record<string, unknown> | undefined
    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    const mainSessionID = getMainSessionID()
    if (!mainSessionID || sessionID !== mainSessionID) return

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
      const { agent, model } = await resolveMainSessionTarget(ctx, mainSessionID)

      try {
        await ctx.client.session.promptAsync({
          path: { id: mainSessionID },
          body: {
            ...(agent ? { agent } : {}),
            ...(model ? { model } : {}),
            parts: [{ type: "text", text: reminder }],
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
