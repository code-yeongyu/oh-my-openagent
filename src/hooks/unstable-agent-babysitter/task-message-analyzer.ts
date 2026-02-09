import type { BackgroundTask } from "../../features/background-agent"

export const THINKING_SUMMARY_MAX_CHARS = 500 as const

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

export function getMessageInfo(value: unknown): MessageInfo | undefined {
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

export function getMessageParts(value: unknown): MessagePart[] {
  if (!isRecord(value)) return []
  if (!Array.isArray(value.parts)) return []
  return value.parts.filter(isRecord).map((part) => ({
    type: typeof part.type === "string" ? part.type : undefined,
    text: typeof part.text === "string" ? part.text : undefined,
    thinking: typeof part.thinking === "string" ? part.thinking : undefined,
  }))
}

export function extractMessages(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  if (hasData(value) && Array.isArray(value.data)) {
    return value.data
  }
  return []
}

export function isUnstableTask(task: BackgroundTask): boolean {
  if (task.isUnstableAgent === true) return true
  const modelId = task.model?.modelID?.toLowerCase()
  return modelId ? modelId.includes("gemini") || modelId.includes("minimax") : false
}

export function buildReminder(task: BackgroundTask, summary: string | null, idleMs: number): string {
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
