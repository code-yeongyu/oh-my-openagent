import type { PluginInput } from "@opencode-ai/plugin"

import type { MomusReviewVerdict } from "../../features/boulder-state"

type OpencodeClient = PluginInput["client"]

export interface ReviewMetadata {
  agent?: string
  prompt?: string
  model?: string
  sessionId?: string
}

export interface SessionReviewContext {
  promptText?: string
  model?: string
  durationMs?: number
}

const VERDICT_PATTERN = /\*\*\[(OKAY|REJECT)\]\*\*/
// Anchored to a token boundary so a plan path is captured whole: an absolute
// path keeps its leading directories instead of being reduced to the current
// project's `.omo/plans/...` suffix, and a match cannot start mid-word.
const PLAN_PATH_PATTERN =
  /(?:^|[\s"'`(\[=:])([^\s"'`)\]]*?(?:\.omo|\.sisyphus)\/plans\/[^\s"'`)\]]+?\.md)/gm

export function parseMomusVerdict(outputText: string): MomusReviewVerdict | null {
  const match = VERDICT_PATTERN.exec(outputText)
  if (!match) {
    return null
  }
  return match[1] === "OKAY" ? "okay" : "reject"
}

export function extractMomusVerdictBlock(outputText: string): string | null {
  const match = VERDICT_PATTERN.exec(outputText)
  if (!match) {
    return null
  }
  return outputText.slice(match.index)
}

export function extractSinglePlanPath(promptText: string): string | null {
  const matches = [...promptText.matchAll(PLAN_PATH_PATTERN)].map((match) => match[1])
  const unique = [...new Set(matches)]
  return unique.length === 1 ? unique[0] : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function formatModel(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value
  }
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const providerID = readString(record, "providerID")
  const modelID = readString(record, "modelID")
  if (providerID && modelID) {
    return `${providerID}/${modelID}`
  }
  return modelID ?? providerID
}

export function readReviewMetadata(metadata: unknown, args?: Record<string, unknown>): ReviewMetadata {
  const record = asRecord(metadata) ?? {}
  const agent = readString(record, "agent")
    ?? readString(args ?? {}, "subagent_type")
    ?? readString(args ?? {}, "agent")
    ?? readString(record, "requested_subagent_type")
  return {
    agent,
    prompt: readString(record, "prompt") ?? readString(args ?? {}, "prompt"),
    model: formatModel(record.model),
    sessionId: readString(record, "sessionId") ?? readString(record, "taskId"),
  }
}

interface SDKMessageInfo {
  role?: string
  providerID?: string
  modelID?: string
  time?: { created?: number; completed?: number }
}

interface SDKMessage {
  info?: SDKMessageInfo
  parts?: Array<{ type?: string; text?: string }>
}

function messageText(message: SDKMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
}

export async function resolveSessionReviewContext(
  client: OpencodeClient,
  sessionId: string,
): Promise<SessionReviewContext> {
  try {
    const response = (await client.session.messages({ path: { id: sessionId } })) as { data?: SDKMessage[] }
    const messages = response.data ?? []

    const firstUser = messages.find((message) => message.info?.role === "user")
    const firstAssistant = messages.find((message) => message.info?.role === "assistant" && message.info?.modelID)
    const lastAssistant = [...messages].reverse().find((message) => message.info?.role === "assistant")

    const startedAt = firstUser?.info?.time?.created
    const endedAt = lastAssistant?.info?.time?.completed ?? lastAssistant?.info?.time?.created
    const durationMs = startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
      ? endedAt - startedAt
      : undefined

    const providerID = firstAssistant?.info?.providerID
    const modelID = firstAssistant?.info?.modelID

    return {
      promptText: firstUser ? messageText(firstUser) : undefined,
      model: modelID ? (providerID ? `${providerID}/${modelID}` : modelID) : undefined,
      durationMs,
    }
  } catch {
    return {}
  }
}
