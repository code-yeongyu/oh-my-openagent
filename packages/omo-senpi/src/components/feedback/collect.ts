import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

export const TRANSCRIPT_MESSAGE_LIMIT = 50
const TOOL_RESULT_KEEP = 1200

const SECRET_KEY_WORD = /(^|_)(api_?key|key|keys|token|tokens|access_token|refresh_token|id_token|secret|secrets|password|passwd|passphrase|authorization|auth|cookie|cookies|credential|credentials|private_key|client_secret|bearer|session_key)$/
const NOT_SECRET = /(^|_)(max|min|limit|count|budget|window|length|size|context)(_|$)/

const isSecretKey = (key: string): boolean => {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase()
  return SECRET_KEY_WORD.test(snake) && !NOT_SECRET.test(snake)
}
const SECRET_CONTAINERS = new Set(["headers", "env"])

const blankUserinfo = (value: string): string => value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/i, "$1<redacted>@")

/**
 * Structural pass before text redaction: values under secret-named keys, and every value inside `headers` and `env`
 * maps, are blanked regardless of what they look like, because a custom header or env value has no shape a pattern
 * can recognize. URL userinfo is blanked too.
 */
export function blankConfigSecrets(value: unknown, insideSecretContainer = false): unknown {
  if (Array.isArray(value)) return value.map((item) => blankConfigSecrets(item, insideSecretContainer))
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (insideSecretContainer || isSecretKey(key)) {
        out[key] = child !== null && typeof child === "object" ? blankConfigSecrets(child, true) : "<redacted>"
        continue
      }
      out[key] = blankConfigSecrets(child, SECRET_CONTAINERS.has(key.toLowerCase()))
    }
    return out
  }
  if (insideSecretContainer) return "<redacted>"
  return typeof value === "string" ? blankUserinfo(value) : value
}

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part: unknown) => {
      const type: unknown = Reflect.get(Object(part), "type")
      if (type === "text") return String(Reflect.get(Object(part), "text") ?? "")
      if (type === "toolCall") {
        const name = String(Reflect.get(Object(part), "name") ?? "tool")
        return `[${name}] ${JSON.stringify(Reflect.get(Object(part), "arguments") ?? {})}`
      }
      if (type === "image") return "[image]"
      return ""
    })
    .filter((piece) => piece !== "")
    .join(" ")
}

const shorten = (text: string): string => {
  if (text.length <= TOOL_RESULT_KEEP * 2) return text
  const cut = text.length - TOOL_RESULT_KEEP * 2
  return `${text.slice(0, TOOL_RESULT_KEEP)} [${cut} characters cut] ${text.slice(-TOOL_RESULT_KEEP)}`
}

const clock = (timestamp: unknown): string => {
  const parsed = typeof timestamp === "string" || typeof timestamp === "number" ? new Date(timestamp) : null
  return parsed === null || Number.isNaN(parsed.getTime()) ? "" : ` (${parsed.toISOString().slice(11, 19)})`
}

/** The reported session's last messages as plain lines; custom extension entries (memory, notes) never appear. */
export function transcriptText(entries: readonly unknown[]): string {
  const lines: string[] = []
  for (const entry of entries) {
    if (Reflect.get(Object(entry), "type") !== "message") continue
    const message: unknown = Reflect.get(Object(entry), "message")
    const role = String(Reflect.get(Object(message), "role") ?? "unknown")
    const body = shorten(textOf(Reflect.get(Object(message), "content")).trim())
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .join("\n  ")
    lines.push(`${role}${clock(Reflect.get(Object(entry), "timestamp"))}: ${body}`)
  }
  return lines.slice(-TRANSCRIPT_MESSAGE_LIMIT).join("\n")
}

export const LOG_WINDOW_MS = 15 * 60 * 1000
const LOG_LINES_PER_FILE = 200
const LOG_TAIL_BYTES = 512 * 1024
const LOG_FIELDS = [
  "ts", "timestamp", "level", "event", "component", "source", "kind", "type", "reason", "code", "status", "outcome",
  "durationMs", "elapsedMs", "latencyMs", "ms", "attempt", "attempts", "turn", "from", "to", "chainKey", "model", "provider",
  "sessionId", "threadId", "taskId", "requestId", "pid", "exitCode", "signal",
] as const
const LOG_STRING_MAX = 160

const tailText = (path: string): string => {
  const size = statSync(path).size
  const start = Math.max(0, size - LOG_TAIL_BYTES)
  const text = readFileSync(path).subarray(start).toString("utf8")
  return start === 0 ? text : text.slice(text.indexOf("\n") + 1)
}

const projectLine = (line: string, since: number): string | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const ts = Date.parse(String(Reflect.get(parsed, "ts") ?? Reflect.get(parsed, "timestamp") ?? ""))
  if (Number.isNaN(ts) || ts < since) return undefined
  const kept: Record<string, string | number | boolean> = {}
  for (const field of LOG_FIELDS) {
    const value: unknown = Reflect.get(parsed, field)
    if (typeof value === "number" || typeof value === "boolean") kept[field] = value
    else if (typeof value === "string" && value.length <= LOG_STRING_MAX && !/[\r\n]/.test(value)) kept[field] = value
  }
  return JSON.stringify(kept)
}

/**
 * The engine's own logs (`<agent dir>/logs/*.log`, rotations skipped) for the last 15 minutes. Each line keeps only
 * allowlisted, content-free fields (time, level, event, ids, durations, outcome): log lines can belong to any session,
 * and the reported conversation has its own section.
 */
export function engineLogText(agentDir: string, now: Date): string {
  const dir = join(agentDir, "logs")
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".log")).sort()
  } catch {
    return ""
  }
  const since = now.getTime() - LOG_WINDOW_MS
  const blocks: string[] = []
  for (const name of names) {
    let text: string
    try {
      text = tailText(join(dir, name))
    } catch {
      continue
    }
    const lines = text
      .split("\n")
      .flatMap((line) => {
        const projected = projectLine(line, since)
        return projected === undefined ? [] : [projected]
      })
      .slice(-LOG_LINES_PER_FILE)
    if (lines.length > 0) blocks.push(`## ${name}\n${lines.join("\n")}`)
  }
  return blocks.join("\n\n")
}

