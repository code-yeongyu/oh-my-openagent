#!/usr/bin/env node
// Lane-private helpers for team-e2e.mjs (todo 28): JSON event parsing, tool-result extraction,
// team-core mailbox/runtime path math (mirrors senpi-task store/state-dir + team-registry/paths), and
// the crash-reservation fixture the durability path reclaims. Kept separate so the driver stays under
// the logic-file LOC ceiling. NEVER edits the shared scripts/qa files.
import { createHash, randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const RESERVED_PREFIX = ".delivering-"

// The Metis #7/#8 credential-isolation guarantee: these four files in the real ~/.senpi/agent must be
// byte-unchanged across a QA run. The whole-dir digest is informational only (a live dev machine writes
// senpi-debug.log + concurrent session JSONL), so allPass gates on THIS scoped digest, never the dir.
const CREDENTIAL_FILES = ["auth.json", "models.json", "settings.json", "trust.json"]

export function credentialDigest(agentDir) {
  const hash = createHash("sha256")
  for (const name of CREDENTIAL_FILES) {
    const path = join(agentDir, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.from("absent"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function parseEvents(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return events
}

// Each executed tool result. senpi's tool_execution_end carries `toolName` + `result.{content,details}`
// with the boolean `isError` at the TOP LEVEL of the event (sibling to result), not inside result.
export function toolResults(events) {
  const results = []
  for (const event of events) {
    if (event?.type !== "tool_execution_end") continue
    const result = event.result ?? {}
    results.push({
      toolName: event.toolName,
      details: result.details,
      isError: event.isError === true,
      text: (result.content ?? []).map((part) => part?.text ?? "").join(""),
    })
  }
  return results
}

export function findResults(events, toolName) {
  return toolResults(events).filter((result) => result.toolName === toolName)
}

// baseDir = <cwd>/.omo/senpi-task/teams (resolveStateDir default + teamStorageBaseDir).
export function teamBaseDir(cwd) {
  return join(cwd, ".omo", "senpi-task", "teams")
}

export function runtimeRootDir(cwd) {
  return join(teamBaseDir(cwd), "runtime")
}

export function runtimeDir(cwd, teamRunId) {
  return join(runtimeRootDir(cwd), teamRunId)
}

export function taskStateDir(cwd) {
  return join(cwd, ".omo", "senpi-task")
}

export function memberInboxDir(cwd, teamRunId, memberName) {
  return join(runtimeRootDir(cwd), teamRunId, "inboxes", memberName)
}

export function memberTaskId(cwd, teamRunId, memberName) {
  const map = readJsonIfPresent(join(runtimeDir(cwd, teamRunId), "senpi-task-members.json"))
  const taskId = map?.[memberName]
  return typeof taskId === "string" ? taskId : undefined
}

export function taskRecord(cwd, taskId) {
  return readJsonIfPresent(join(taskStateDir(cwd), "tasks", `${taskId}.json`))
}

export function taskEventText(cwd, taskId) {
  return readText(join(taskStateDir(cwd), "logs", `${taskId}.jsonl`)) ?? ""
}

export function processedMessagePath(cwd, teamRunId, recipient, messageId) {
  return join(memberInboxDir(cwd, teamRunId, recipient), "processed", `${messageId}.json`)
}

export function sessionEnvelopeCount(cwd, taskId, messageId) {
  const marker = `messageId=\"${messageId}\"`
  return sessionStringValues(cwd, taskId)
    .filter((value) => value.includes("<peer_message ") && value.includes(marker))
    .length
}

export function sessionContainsText(cwd, taskId, needle) {
  return sessionStringValues(cwd, taskId).some((value) => value.includes(needle))
}

export function deliveredEventCount(cwd, taskId, messageId) {
  let count = 0
  for (const line of taskEventText(cwd, taskId).split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      continue
    }
    if (event?.type === "team_message_delivered" && event.payload?.message_id === messageId) count += 1
  }
  return count
}

// The teamRunId directories team-core minted under this run's runtime root (usually exactly one).
export function discoverRunIds(cwd) {
  const root = runtimeRootDir(cwd)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

// Unread = plain <id>.json; reserved = .delivering-<id>.json; processed = processed/<id>.json.
export function inboxCounts(inboxDir) {
  if (!existsSync(inboxDir)) return { unread: 0, reserved: 0, processed: 0 }
  let unread = 0
  let reserved = 0
  for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue
    if (entry.name.startsWith(RESERVED_PREFIX)) reserved += 1
    else if (!entry.name.startsWith(".")) unread += 1
  }
  const processedDir = join(inboxDir, "processed")
  let processed = 0
  if (existsSync(processedDir)) {
    processed = readdirSync(processedDir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).length
  }
  return { unread, reserved, processed }
}

export function buildMessage(from, to, body) {
  return { version: 1, messageId: randomUUID(), from, to, kind: "message", body, timestamp: Date.now() }
}

// Simulate a crash that left a delivery reservation dangling, aged past the reclaim TTL so
// session_start reclaim restores it. Returns the messageId the reclaim should re-list as unread.
export function seedCrashReservation(inboxDir, ageMs, memberName) {
  mkdirSync(inboxDir, { recursive: true })
  const message = buildMessage("teammate", memberName, "RECLAIM-CRASH-RESERVATION redeliver me")
  const reservedPath = join(inboxDir, `${RESERVED_PREFIX}${message.messageId}.json`)
  writeFileSync(reservedPath, `${JSON.stringify(message, null, 2)}\n`)
  const aged = (Date.now() - ageMs) / 1000
  utimesSync(reservedPath, aged, aged)
  return { messageId: message.messageId, reservedPath, restoredPath: join(inboxDir, `${message.messageId}.json`) }
}

export function readText(path) {
  if (!existsSync(path)) return undefined
  return readFileSync(path, "utf8")
}

export function readJsonIfPresent(path) {
  const text = readText(path)
  return text === undefined ? undefined : JSON.parse(text)
}

function sessionStringValues(cwd, taskId) {
  const sessionDir = join(taskStateDir(cwd), "children", taskId, "sessions", taskId)
  if (!existsSync(sessionDir)) return []
  const values = []
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith(".jsonl")) continue
    for (const line of readFileSync(join(sessionDir, entry), "utf8").split(/\r?\n/)) {
      if (line.trim().length === 0) continue
      try {
        collectStrings(JSON.parse(line), values)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }
  }
  return values
}

function collectStrings(value, output) {
  if (typeof value === "string") {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output)
    return
  }
  if (value === null || typeof value !== "object") return
  for (const item of Object.values(value)) collectStrings(item, output)
}
