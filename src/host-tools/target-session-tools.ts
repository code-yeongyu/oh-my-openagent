import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import type { HostKind, HostToolDefinition, JsonObject } from "../host-contract"

type TargetHost = Exclude<HostKind, "opencode">

type SessionHeader = {
  type: "session"
  id: string
  timestamp?: string
  cwd?: string
}

type SessionRecord = {
  id: string
  path: string
  timestamp: string
  cwd: string
  entries: Record<string, unknown>[]
}

type TargetSessionToolOptions = {
  host: TargetHost
  cwd: string
  agentDir?: string
}

const sessionListSchema: JsonObject = {
  type: "object",
  properties: {
    limit: { type: "number" },
    from_date: { type: "string" },
    to_date: { type: "string" },
    project_path: { type: "string" },
  },
  additionalProperties: false,
}

const sessionIDSchema: JsonObject = {
  type: "object",
  properties: {
    session_id: { type: "string" },
  },
  required: ["session_id"],
  additionalProperties: false,
}

const sessionReadSchema: JsonObject = {
  type: "object",
  properties: {
    session_id: { type: "string" },
    include_todos: { type: "boolean" },
    include_transcript: { type: "boolean" },
    limit: { type: "number" },
  },
  required: ["session_id"],
  additionalProperties: false,
}

const sessionSearchSchema: JsonObject = {
  type: "object",
  properties: {
    query: { type: "string" },
    session_id: { type: "string" },
    case_sensitive: { type: "boolean" },
    limit: { type: "number" },
  },
  required: ["query"],
  additionalProperties: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function resolveAgentDir(options: TargetSessionToolOptions): string {
  if (options.agentDir) return options.agentDir
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR
  return join(homedir(), options.host === "pi" ? ".pi" : ".omp", "agent")
}

function collectJsonlFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectJsonlFiles(path))
    if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path)
  }
  return files
}

function parseSession(path: string): SessionRecord | undefined {
  const entries: Record<string, unknown>[] = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed)) entries.push(parsed)
    } catch {
      continue
    }
  }
  const header = entries.find((entry) => entry.type === "session") as SessionHeader | undefined
  if (!header || typeof header.id !== "string") return undefined
  return {
    id: header.id,
    path,
    timestamp: text(header.timestamp) || statSync(path).mtime.toISOString(),
    cwd: text(header.cwd),
    entries,
  }
}

function parseSessionSummary(path: string): SessionRecord | undefined {
  const descriptor = openSync(path, "r")
  const buffer = Buffer.alloc(8_192)
  let bytesRead = 0
  try {
    bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0)
  } finally {
    closeSync(descriptor)
  }
  const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0]
  if (!firstLine) return undefined
  try {
    const header: unknown = JSON.parse(firstLine)
    if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string") return undefined
    return {
      id: header.id,
      path,
      timestamp: text(header.timestamp) || statSync(path).mtime.toISOString(),
      cwd: text(header.cwd),
      entries: [],
    }
  } catch {
    return undefined
  }
}

function loadSessions(options: TargetSessionToolOptions): SessionRecord[] {
  const directory = join(resolveAgentDir(options), "sessions")
  return collectJsonlFiles(directory)
    .map(parseSessionSummary)
    .filter((session): session is SessionRecord => session !== undefined)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
}

function findSession(options: TargetSessionToolOptions, sessionID: string): SessionRecord | undefined {
  const summary = loadSessions(options).find((session) => session.id === sessionID || session.id.startsWith(sessionID))
  return summary ? parseSession(summary.path) : undefined
}

function entryMessageText(entry: Record<string, unknown>): string {
  if (entry.type !== "message" || !isRecord(entry.message)) return ""
  const role = text(entry.message.role) || "message"
  const content = Array.isArray(entry.message.content) ? entry.message.content : []
  const parts = content
    .filter(isRecord)
    .filter((part) => part.type === "text" || part.type === "thinking")
    .map((part) => text(part.text) || text(part.thinking))
    .filter(Boolean)
  return parts.length > 0 ? `${role}: ${parts.join("\n")}` : ""
}

function formatSessionList(sessions: SessionRecord[]): string {
  if (sessions.length === 0) return "No sessions found."
  return sessions
    .map((session) => `${session.id}\n  ${session.timestamp}\n  ${session.cwd || "(unknown cwd)"}\n  ${basename(session.path)}`)
    .join("\n")
}

function formatSessionRead(session: SessionRecord, limit?: number): string {
  let messages = session.entries.map(entryMessageText).filter(Boolean)
  if (typeof limit === "number" && limit > 0) messages = messages.slice(0, limit)
  return messages.length > 0 ? messages.join("\n\n") : `Session ${session.id} has no messages.`
}

function formatSessionInfo(session: SessionRecord): string {
  const model = session.entries.find((entry) => entry.type === "model_change")
  const thinking = session.entries.find((entry) => entry.type === "thinking_level_change")
  const messageCount = session.entries.filter((entry) => entry.type === "message").length
  return [
    `Session ID: ${session.id}`,
    `Timestamp: ${session.timestamp}`,
    `CWD: ${session.cwd || "(unknown)"}`,
    `Messages: ${messageCount}`,
    `Model: ${text(model?.model) || text(model?.modelId) || "(unknown)"}`,
    `Thinking: ${text(thinking?.thinkingLevel) || "(unknown)"}`,
    `Path: ${session.path}`,
  ].join("\n")
}

function tool(
  name: string,
  description: string,
  parameters: JsonObject,
  execute: HostToolDefinition<JsonObject>["execute"],
): HostToolDefinition<JsonObject> {
  return { name, label: name, description, parameters, execute }
}

export function createTargetSessionTools(options: TargetSessionToolOptions): Record<string, HostToolDefinition<JsonObject>> {
  return {
    session_list: tool("session_list", "List persisted target-harness sessions.", sessionListSchema, async ({ input }) => {
      const projectPath = text(input.project_path) || options.cwd
      const fromDate = text(input.from_date)
      const toDate = text(input.to_date)
      const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : undefined
      let sessions = loadSessions(options).filter((session) => !projectPath || session.cwd === projectPath)
      if (fromDate) sessions = sessions.filter((session) => session.timestamp >= fromDate)
      if (toDate) sessions = sessions.filter((session) => session.timestamp <= toDate)
      if (limit) sessions = sessions.slice(0, limit)
      return { content: [{ type: "text", text: formatSessionList(sessions) }] }
    }),
    session_read: tool("session_read", "Read messages from a persisted target-harness session.", sessionReadSchema, async ({ input }) => {
      const sessionID = text(input.session_id)
      const session = findSession(options, sessionID)
      const output = session
        ? formatSessionRead(session, typeof input.limit === "number" ? input.limit : undefined)
        : `Session not found: ${sessionID}`
      return { content: [{ type: "text", text: output }], isError: !session }
    }),
    session_search: tool("session_search", "Search persisted target-harness session messages.", sessionSearchSchema, async ({ input }) => {
      const query = text(input.query)
      const caseSensitive = input.case_sensitive === true
      const needle = caseSensitive ? query : query.toLowerCase()
      const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : 20
      const requestedSession = text(input.session_id)
      const sessions = requestedSession
        ? [findSession(options, requestedSession)].filter(Boolean) as SessionRecord[]
        : loadSessions(options).map((session) => parseSession(session.path)).filter((session): session is SessionRecord => session !== undefined)
      const matches: string[] = []
      for (const session of sessions) {
        for (const entry of session.entries) {
          const message = entryMessageText(entry)
          const haystack = caseSensitive ? message : message.toLowerCase()
          if (!message || !haystack.includes(needle)) continue
          matches.push(`${session.id}: ${message}`)
          if (matches.length >= limit) break
        }
        if (matches.length >= limit) break
      }
      return { content: [{ type: "text", text: matches.length > 0 ? matches.join("\n\n") : "No matches found." }] }
    }),
    session_info: tool("session_info", "Inspect metadata for a persisted target-harness session.", sessionIDSchema, async ({ input }) => {
      const sessionID = text(input.session_id)
      const session = findSession(options, sessionID)
      return {
        content: [{ type: "text", text: session ? formatSessionInfo(session) : `Session not found: ${sessionID}` }],
        isError: !session,
      }
    }),
  }
}
