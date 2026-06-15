import { isRecord } from "@oh-my-opencode/utils"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type RuntimeEnv = Readonly<Record<string, string | undefined>>

export type SessionContextDeps = {
  readonly fileExists?: (path: string) => boolean
  readonly listDirectory?: (path: string) => readonly string[]
  readonly readTextFile?: (path: string) => string
  readonly homeDirectory?: () => string
}

export const SPARKSHELL_SESSION_CONTEXT_ENV = "OMO_SPARKSHELL_SESSION_CONTEXT"
export const SPARKSHELL_SESSION_ID_ENV = "OMO_SPARKSHELL_SESSION_ID"
export const CODEX_THREAD_ID_ENV = "CODEX_THREAD_ID"

const RECENT_MESSAGE_COUNT = 5
const REQUEST_MAX_CHARS = 3000
const RECENT_MESSAGE_MAX_CHARS = 800
const DAY_MS = 86_400_000

type RolloutMessage = {
  readonly role: "user" | "agent"
  readonly text: string
}

type ExtractedSessionContext = {
  readonly cwd: string
  readonly originator: string
  readonly subagent: string
  readonly firstUserRequest: string
  readonly latestUserRequest: string
  readonly recentMessages: readonly RolloutMessage[]
  readonly userMessageCount: number
  readonly conversationMessageCount: number
}

export function resolveCodexSessionId(env: RuntimeEnv): string | null {
  const candidate = env[SPARKSHELL_SESSION_ID_ENV]?.trim() || env[CODEX_THREAD_ID_ENV]?.trim() || ""
  return /^[0-9a-f][0-9a-f-]{7,}$/i.test(candidate) ? candidate : null
}

export function findRolloutPath(sessionId: string, env: RuntimeEnv, deps: SessionContextDeps = {}): string | null {
  const fileExists = deps.fileExists ?? existsSync
  const listDirectory = deps.listDirectory ?? ((path: string) => readdirSync(path))
  const homeDirectory = deps.homeDirectory ?? homedir
  const codexHome = env["CODEX_HOME"]?.trim() || join(homeDirectory(), ".codex")
  const roots = [join(codexHome, "sessions"), join(codexHome, "archived_sessions")]
  const fileSuffix = `-${sessionId}.jsonl`

  const scanDay = (dayDir: string): string | null => {
    if (!fileExists(dayDir)) {
      return null
    }
    for (const name of listSafely(listDirectory, dayDir)) {
      if (name.startsWith("rollout-") && name.endsWith(fileSuffix)) {
        return join(dayDir, name)
      }
    }
    return null
  }

  for (const dayDir of uuidV7DayDirCandidates(sessionId)) {
    for (const root of roots) {
      const found = scanDay(join(root, dayDir))
      if (found) {
        return found
      }
    }
  }

  for (const root of roots) {
    if (!fileExists(root)) {
      continue
    }
    for (const year of numericNamesDescending(listSafely(listDirectory, root))) {
      for (const month of numericNamesDescending(listSafely(listDirectory, join(root, year)))) {
        for (const day of numericNamesDescending(listSafely(listDirectory, join(root, year, month)))) {
          const found = scanDay(join(root, year, month, day))
          if (found) {
            return found
          }
        }
      }
    }
  }
  return null
}

export type SessionContextDetails = {
  readonly block: string
  readonly firstUserRequest: string
  readonly latestUserRequest: string
}

export function loadCodexSessionContextDetails(env: RuntimeEnv, deps: SessionContextDeps = {}): SessionContextDetails | null {
  if (isFalsy(env[SPARKSHELL_SESSION_CONTEXT_ENV])) {
    return null
  }
  const sessionId = resolveCodexSessionId(env)
  if (sessionId === null) {
    return null
  }
  const rolloutPath = findRolloutPath(sessionId, env, deps)
  if (rolloutPath === null) {
    return null
  }
  const readTextFile = deps.readTextFile ?? ((path: string) => readFileSync(path, "utf8"))
  let rolloutText: string
  try {
    rolloutText = readTextFile(rolloutPath)
  } catch {
    return null
  }
  const extracted = extractSessionContext(rolloutText)
  if (extracted === null) {
    return null
  }
  return {
    block: formatSessionContextBlock(sessionId, extracted),
    firstUserRequest: extracted.firstUserRequest,
    latestUserRequest: extracted.latestUserRequest,
  }
}

export function loadCodexSessionContext(env: RuntimeEnv, deps: SessionContextDeps = {}): string {
  return loadCodexSessionContextDetails(env, deps)?.block ?? ""
}

function extractSessionContext(rolloutText: string): ExtractedSessionContext | null {
  let cwd = ""
  let originator = ""
  let subagent = ""
  let metaSeen = false
  let firstUserRequest = ""
  let latestUserRequest = ""
  let userMessageCount = 0
  let conversationMessageCount = 0
  const recentMessages: RolloutMessage[] = []

  for (const line of rolloutText.split("\n")) {
    const isMetaCandidate = !metaSeen && line.includes('"session_meta"')
    const isMessageCandidate = line.includes('"user_message"') || line.includes('"agent_message"')
    if (!isMetaCandidate && !isMessageCandidate) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(parsed) || !isRecord(parsed["payload"])) {
      continue
    }
    const payload = parsed["payload"]

    if (parsed["type"] === "session_meta" && !metaSeen) {
      metaSeen = true
      cwd = readString(payload["cwd"])
      originator = readString(payload["originator"])
      const nickname = readString(payload["agent_nickname"])
      const role = readString(payload["agent_role"])
      subagent = nickname.length > 0 ? (role.length > 0 ? `${nickname} (${role})` : nickname) : role
      continue
    }
    if (parsed["type"] !== "event_msg") {
      continue
    }

    const payloadType = payload["type"]
    if (payloadType !== "user_message" && payloadType !== "agent_message") {
      continue
    }
    const text = readString(payload["message"]).trim()
    if (text.length === 0) {
      continue
    }

    conversationMessageCount += 1
    if (payloadType === "user_message") {
      userMessageCount += 1
      if (firstUserRequest.length === 0) {
        firstUserRequest = text
      }
      latestUserRequest = text
    }
    recentMessages.push({ role: payloadType === "user_message" ? "user" : "agent", text })
    if (recentMessages.length > RECENT_MESSAGE_COUNT) {
      recentMessages.shift()
    }
  }

  if (firstUserRequest.length === 0 && recentMessages.length === 0) {
    return null
  }
  return {
    cwd,
    originator,
    subagent,
    firstUserRequest,
    latestUserRequest,
    recentMessages,
    userMessageCount,
    conversationMessageCount,
  }
}

function formatSessionContextBlock(sessionId: string, context: ExtractedSessionContext): string {
  const metaParts: string[] = []
  if (context.cwd.length > 0) {
    metaParts.push(`workspace: ${context.cwd}`)
  }
  if (context.originator.length > 0) {
    metaParts.push(`originator: ${context.originator}`)
  }
  if (context.subagent.length > 0) {
    metaParts.push(`subagent: ${context.subagent}`)
  }

  const lines: string[] = [
    "===== codex session context (auto-attached by sparkshell) =====",
    `thread: ${sessionId} | ${context.userMessageCount} user request(s), ${context.conversationMessageCount} conversation message(s) so far`,
  ]
  if (metaParts.length > 0) {
    lines.push(metaParts.join(" | "))
  }

  lines.push("", "[first user request]", truncateMiddle(context.firstUserRequest, REQUEST_MAX_CHARS))
  lines.push("", "[latest user request]")
  if (context.latestUserRequest === context.firstUserRequest) {
    lines.push("(same as the first user request)")
  } else {
    lines.push(truncateMiddle(context.latestUserRequest, REQUEST_MAX_CHARS))
  }

  if (context.recentMessages.length > 0) {
    lines.push("", `[last ${context.recentMessages.length} conversation message(s), oldest first]`)
    context.recentMessages.forEach((message, index) => {
      lines.push(`${index + 1}. [${message.role}] ${truncateMiddle(message.text, RECENT_MESSAGE_MAX_CHARS)}`)
    })
  }

  lines.push(
    "",
    "Combine this session context with the shell result above to keep follow-up instructions aligned with the user's actual goals.",
    "===== end codex session context =====",
  )
  return lines.join("\n")
}

function uuidV7DayDirCandidates(sessionId: string): readonly string[] {
  const hex = sessionId.replaceAll("-", "").slice(0, 12)
  if (!/^[0-9a-f]{12}$/i.test(hex)) {
    return []
  }
  const ms = Number.parseInt(hex, 16)
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    return []
  }
  const candidates: string[] = []
  for (const offsetDays of [0, 1, -1]) {
    const date = new Date(ms + offsetDays * DAY_MS)
    candidates.push(join(String(date.getFullYear()), pad2(date.getMonth() + 1), pad2(date.getDate())))
  }
  return candidates
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function numericNamesDescending(names: readonly string[]): readonly string[] {
  return names.filter((name) => /^\d+$/.test(name)).sort((left, right) => Number(right) - Number(left))
}

function listSafely(listDirectory: (path: string) => readonly string[], path: string): readonly string[] {
  try {
    return listDirectory(path)
  } catch {
    return []
  }
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  const headLength = Math.floor(maxChars * 0.7)
  const tailLength = maxChars - headLength
  return `${text.slice(0, headLength)}\n…[${text.length - maxChars} chars truncated]…\n${text.slice(text.length - tailLength)}`
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}



function isFalsy(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}
