import type { AgentSessionSource } from "./types"

export interface TranscriptContentBlock {
  readonly type?: string
  readonly text?: string
}

export type TranscriptContent = string | ReadonlyArray<TranscriptContentBlock>

export interface TranscriptToolCall {
  readonly name: string
  readonly changedFiles: ReadonlyArray<string>
}

/** The fields the desktop `TranscriptRecord` schema selected, plus the tool calls a digest needs. */
export interface TranscriptRecord {
  readonly type?: string
  readonly timestamp?: string
  readonly cwd?: string
  readonly sessionId?: string
  readonly aiTitle?: string
  readonly isSidechain?: boolean
  readonly isMeta?: boolean
  readonly isCompactSummary?: boolean
  readonly message?: { readonly role?: string; readonly content?: TranscriptContent; readonly model?: string }
  readonly payload?: {
    readonly id?: string
    readonly session_id?: string
    readonly type?: string
    readonly role?: string
    readonly message?: string
    readonly model?: string
    readonly cwd?: string
    readonly content?: ReadonlyArray<TranscriptContentBlock>
    readonly internal_chat_message_metadata_passthrough?: unknown
  }
  readonly tools?: ReadonlyArray<TranscriptToolCall>
}

type Fields = Readonly<Record<string, unknown>>

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value)

class Invalid extends Error {}

function pick<T>(source: Fields, keys: ReadonlyArray<string>, check: (value: unknown) => value is T): Record<string, T> {
  const out: Record<string, T> = {}
  for (const key of keys) {
    const value = source[key]
    if (value === undefined) continue
    if (!check(value)) throw new Invalid()
    out[key] = value
  }
  return out
}

const isString = (value: unknown): value is string => typeof value === "string"
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"

function decodeBlocks(value: unknown): ReadonlyArray<TranscriptContentBlock> {
  if (!Array.isArray(value)) throw new Invalid()
  return value.map((block: unknown) => {
    if (!isFields(block)) throw new Invalid()
    return pick(block, ["type", "text"], isString)
  })
}

function decodeMessage(value: unknown): TranscriptRecord["message"] {
  if (!isFields(value)) throw new Invalid()
  const content = value["content"]
  return {
    ...pick(value, ["role", "model"], isString),
    ...(content === undefined ? {} : { content: typeof content === "string" ? content : decodeBlocks(content) }),
  }
}

function decodePayload(value: unknown): TranscriptRecord["payload"] {
  if (!isFields(value)) throw new Invalid()
  const content = value["content"]
  const passthrough = value["internal_chat_message_metadata_passthrough"]
  return {
    ...pick(value, ["id", "session_id", "type", "role", "message", "model", "cwd"], isString),
    ...(content === undefined ? {} : { content: decodeBlocks(content) }),
    ...(passthrough === undefined ? {} : { internal_chat_message_metadata_passthrough: passthrough }),
  }
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "write", "edit"])
const PATCH_FILE_LINE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm

export function filesFromApplyPatch(patch: string): Array<string> {
  return Array.from(patch.matchAll(PATCH_FILE_LINE), (match) => (match[1] ?? match[2] ?? "").trim()).filter(
    (path) => path.length > 0,
  )
}

function claudeToolCalls(message: unknown): Array<TranscriptToolCall> {
  if (!isFields(message) || !Array.isArray(message["content"])) return []
  return message["content"].flatMap((block: unknown): Array<TranscriptToolCall> => {
    if (!isFields(block) || block["type"] !== "tool_use" || !isString(block["name"])) return []
    const input = isFields(block["input"]) ? block["input"] : {}
    const target = input["file_path"] ?? input["notebook_path"] ?? input["path"]
    const changedFiles = WRITE_TOOLS.has(block["name"]) && isString(target) ? [target] : []
    return [{ name: block["name"], changedFiles }]
  })
}

function patchInput(payload: Fields): string | null {
  if (isString(payload["input"])) return payload["input"]
  if (!isString(payload["arguments"])) return null
  try {
    const parsed: unknown = JSON.parse(payload["arguments"])
    if (isFields(parsed) && isString(parsed["input"])) return parsed["input"]
    if (isFields(parsed) && Array.isArray(parsed["command"])) return parsed["command"].filter(isString).join("\n")
  } catch {
    return payload["arguments"]
  }
  return null
}

function codexToolCalls(payload: unknown): Array<TranscriptToolCall> {
  if (!isFields(payload)) return []
  const kind = payload["type"]
  if (kind !== "function_call" && kind !== "custom_tool_call" && kind !== "local_shell_call") return []
  const name = isString(payload["name"]) ? payload["name"] : "shell"
  const input = patchInput(payload)
  const changedFiles = input !== null && input.includes("*** Begin Patch") ? filesFromApplyPatch(input) : []
  return [{ name, changedFiles }]
}

/** Mirrors the desktop schema decode: a field of the wrong type rejects the whole record. */
export function decodeTranscriptRecord(value: unknown, source: AgentSessionSource): TranscriptRecord | null {
  if (!isFields(value)) return null
  try {
    const message = value["message"]
    const payload = value["payload"]
    const tools = source === "claudeAgent" ? claudeToolCalls(message) : codexToolCalls(payload)
    return {
      ...pick(value, ["type", "timestamp", "cwd", "sessionId", "aiTitle"], isString),
      ...pick(value, ["isSidechain", "isMeta", "isCompactSummary"], isBoolean),
      ...(message === undefined ? {} : { message: decodeMessage(message) }),
      ...(payload === undefined ? {} : { payload: decodePayload(payload) }),
      ...(tools.length === 0 ? {} : { tools }),
    }
  } catch (cause) {
    if (cause instanceof Invalid) return null
    throw cause
  }
}

export function decodeTranscriptLine(line: string, source: AgentSessionSource): TranscriptRecord | null {
  try {
    return decodeTranscriptRecord(JSON.parse(line), source)
  } catch {
    return null
  }
}

export function extractDecodedCwd(record: TranscriptRecord): string | null {
  const cwd = record.cwd?.trim() || record.payload?.cwd?.trim()
  return cwd && cwd.length > 0 ? cwd : null
}

export function shouldRetainDecodedRecord(source: AgentSessionSource, record: TranscriptRecord): boolean {
  if (extractDecodedCwd(record) !== null || record.tools !== undefined) return true
  if (source === "claudeAgent") {
    return (
      record.type === "user" ||
      record.type === "assistant" ||
      record.sessionId !== undefined ||
      record.aiTitle !== undefined ||
      record.message?.model !== undefined
    )
  }
  return (
    record.type === "session_meta" ||
    record.type === "turn_context" ||
    (record.type === "event_msg" && record.payload?.type === "user_message") ||
    (record.type === "response_item" &&
      record.payload?.type === "message" &&
      (record.payload.role === "user" || record.payload.role === "assistant"))
  )
}

/** Extract `cwd` from a session-meta record, tolerating the shapes each CLI writes. */
export function extractCwdFromLine(line: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isFields(parsed)) return null
  if (isString(parsed["cwd"]) && parsed["cwd"].trim().length > 0) return parsed["cwd"]
  const payload = parsed["payload"]
  if (isFields(payload) && isString(payload["cwd"]) && payload["cwd"].trim().length > 0) return payload["cwd"]
  return null
}
