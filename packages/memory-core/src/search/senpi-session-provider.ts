// Transcript provider over senpi's session JSONL store (~/.senpi/agent/sessions).
//
// Verified against senpi packages/coding-agent/src/core/session-manager.ts:
//   SessionHeader        { type: "session", version?, id, timestamp, cwd, parentSession? }
//   SessionEntryBase     { type, id, parentId, timestamp }
//   SessionMessageEntry  { type: "message", message: AgentMessage }
// and pi-ai types.d.ts: UserMessage/AssistantMessage/ToolResultMessage with
// TextContent { type:"text", text }, ThinkingContent { type:"thinking", thinking },
// ToolCall { type:"toolCall", id, name, arguments }.
//
// One file is one conversation. Entry ids are unique per conversation, so shared
// ancestors of forked branches are emitted once. Malformed lines are skipped
// individually and never discard the rest of the file.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import type { SearchDocument } from "./query"
import type { TranscriptConversation, TranscriptProvider } from "./engine"

export interface SenpiSessionHeader {
  type: "session"
  id: string
  timestamp?: string
  cwd?: string
  version?: number
  parentSession?: string
}

export interface SenpiHiddenCandidate {
  filePath: string
  directoryName: string
  header?: SenpiSessionHeader
}

export interface SenpiSessionProviderOptions {
  /** Root sessions directory, e.g. ~/.senpi/agent/sessions. */
  sessionsDir: string
  /** Session subdirectory names treated as hidden (e.g. reflection session dirs). */
  excludedDirs?: readonly string[]
  /** Marker file inside a session directory that hides every session in it. */
  hiddenMarkerFile?: string
  /** Extra hidden rule, e.g. task-child sessions. */
  isHidden?: (candidate: SenpiHiddenCandidate) => boolean
}

const ARCHIVED_SUFFIX = ".archived"
const SESSION_SUFFIX = ".jsonl"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseHeader(value: unknown): SenpiSessionHeader | undefined {
  if (!isRecord(value)) return undefined
  if (value.type !== "session" || typeof value.id !== "string") return undefined
  return {
    type: "session",
    id: value.id,
    ...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    ...(typeof value.version === "number" ? { version: value.version } : {}),
    ...(typeof value.parentSession === "string" ? { parentSession: value.parentSession } : {}),
  }
}

function textOf(part: Record<string, unknown>, key: string): string {
  const value = part[key]
  return typeof value === "string" ? value : ""
}

interface MappedContent {
  content: string
  reasoning: string
  toolCalls: { name?: string; arguments?: string }[]
}

function mapContent(content: unknown): MappedContent {
  if (typeof content === "string") return { content, reasoning: "", toolCalls: [] }
  if (!Array.isArray(content)) return { content: "", reasoning: "", toolCalls: [] }

  const texts: string[] = []
  const thoughts: string[] = []
  const toolCalls: { name?: string; arguments?: string }[] = []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type === "text") {
      const text = textOf(part, "text")
      if (text) texts.push(text)
      continue
    }
    if (part.type === "thinking") {
      const thinking = textOf(part, "thinking")
      if (thinking) thoughts.push(thinking)
      continue
    }
    if (part.type === "toolCall") {
      const name = textOf(part, "name")
      const args = part.arguments === undefined ? undefined : safeStringify(part.arguments)
      toolCalls.push({ ...(name ? { name } : {}), ...(args ? { arguments: args } : {}) })
    }
  }
  return { content: texts.join("\n"), reasoning: thoughts.join("\n"), toolCalls }
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function toDocument(entry: Record<string, unknown>, conversationId: string): SearchDocument | undefined {
  if (entry.type !== "message" || typeof entry.id !== "string") return undefined
  const message = entry.message
  if (!isRecord(message)) return undefined
  const role = typeof message.role === "string" ? message.role : undefined
  if (!role) return undefined

  const mapped = mapContent(message.content)
  const toolName = typeof message.toolName === "string" ? message.toolName : undefined
  const toolCalls = toolName ? [...mapped.toolCalls, { name: toolName }] : mapped.toolCalls
  const isToolResult = role === "toolResult"

  return {
    id: entry.id,
    conversationId,
    messageType: role,
    ...(typeof entry.timestamp === "string" ? { date: entry.timestamp } : {}),
    ...(isToolResult ? {} : { content: mapped.content }),
    ...(isToolResult && mapped.content ? { toolReturn: mapped.content } : {}),
    ...(mapped.reasoning ? { reasoning: mapped.reasoning } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }
}

function readSessionFile(filePath: string): { header?: SenpiSessionHeader; lines: Record<string, unknown>[] } {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch {
    return { lines: [] }
  }

  let header: SenpiSessionHeader | undefined
  const lines: Record<string, unknown>[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!header) {
      const candidate = parseHeader(parsed)
      if (candidate) {
        header = candidate
        continue
      }
    }
    if (isRecord(parsed)) lines.push(parsed)
  }
  return { ...(header ? { header } : {}), lines }
}

function listSessionFiles(sessionsDir: string): { filePath: string; directoryName: string }[] {
  if (!existsSync(sessionsDir)) return []
  const files: { filePath: string; directoryName: string }[] = []
  let dirEntries: string[]
  try {
    dirEntries = readdirSync(sessionsDir)
  } catch {
    return []
  }
  for (const directoryName of dirEntries) {
    const directoryPath = join(sessionsDir, directoryName)
    try {
      const stat = statSync(directoryPath)
      if (!stat.isDirectory()) {
        // senpi stores sessions flat as <sessionDir>/<ts>_<id>.jsonl (no conversation subdirectories).
        if (directoryName.endsWith(SESSION_SUFFIX)) {
          files.push({ filePath: directoryPath, directoryName: basename(sessionsDir) })
        }
        continue
      }
      for (const name of readdirSync(directoryPath)) {
        if (!name.endsWith(SESSION_SUFFIX)) continue
        files.push({ filePath: join(directoryPath, name), directoryName })
      }
    } catch {
      continue
    }
  }
  return files
}

export class SenpiSessionProvider implements TranscriptProvider {
  private readonly options: SenpiSessionProviderOptions

  constructor(options: SenpiSessionProviderOptions) {
    this.options = options
  }

  listConversations(): TranscriptConversation[] {
    const conversations: TranscriptConversation[] = []
    for (const { filePath, directoryName } of listSessionFiles(this.options.sessionsDir)) {
      const { header, lines } = readSessionFile(filePath)
      const id = header?.id ?? basename(filePath, SESSION_SUFFIX)

      const seen = new Set<string>()
      const messages: SearchDocument[] = []
      for (const entry of lines) {
        const document = toDocument(entry, id)
        if (!document || seen.has(document.id)) continue
        seen.add(document.id)
        messages.push(document)
      }
      if (messages.length === 0) continue

      const hidden = this.isHidden({ filePath, directoryName, ...(header ? { header } : {}) })
      conversations.push({ id, messages, ...(hidden ? { hidden } : {}) })
    }
    return conversations
  }

  private isHidden(candidate: SenpiHiddenCandidate): boolean {
    if (existsSync(`${candidate.filePath}${ARCHIVED_SUFFIX}`)) return true
    if (this.options.excludedDirs?.includes(candidate.directoryName)) return true
    const marker = this.options.hiddenMarkerFile
    if (marker && existsSync(join(candidate.filePath, "..", marker))) return true
    return this.options.isHidden?.(candidate) === true
  }
}
