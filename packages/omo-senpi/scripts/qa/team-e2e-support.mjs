#!/usr/bin/env node
// Lane-private helpers for team-e2e.mjs (todo 28): JSON event parsing, tool-result extraction,
// team-core mailbox/runtime path math (senpi-task's own state-dir resolver + team-registry/paths), and
// the crash-reservation fixture the durability path reclaims. Kept separate so the driver stays under
// the logic-file LOC ceiling. NEVER edits the shared scripts/qa files.
import { createHash, randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { sandboxStateDir } from "./sandbox-child-env.mjs"

const RESERVED_PREFIX = ".delivering-"

// The plan-consultant #7/#8 credential-isolation guarantee: these four files in the real ~/.senpi/agent must be
// byte-unchanged across a QA run. The whole-dir digest is informational only (a live dev machine writes
// senpi-debug.log + concurrent session JSONL), so allPass gates on THIS scoped digest, never the dir.
export { credentialDigest } from "./drive.mjs"

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

// baseDir = <task state dir>/teams (resolveStateDir default + teamStorageBaseDir). A sandbox is
// `{ cwd, agentDir }`: the lead and every member run on isolatedChildEnv(…, sandbox.agentDir), so the
// engine resolves the task state dir from that agent dir, never from the project alone.
export function teamBaseDir(sandbox) {
  return join(taskStateDir(sandbox), "teams")
}

export function runtimeRootDir(sandbox) {
  return join(teamBaseDir(sandbox), "runtime")
}

export function runtimeDir(sandbox, teamRunId) {
  return join(runtimeRootDir(sandbox), teamRunId)
}

export function taskStateDir(sandbox) {
  return sandboxStateDir(sandbox)
}

export function memberInboxDir(sandbox, teamRunId, memberName) {
  return join(runtimeRootDir(sandbox), teamRunId, "inboxes", memberName)
}

export function memberTaskId(sandbox, teamRunId, memberName) {
  const map = readJsonIfPresent(join(runtimeDir(sandbox, teamRunId), "senpi-task-members.json"))
  const taskId = map?.[memberName]
  return typeof taskId === "string" ? taskId : undefined
}

export function taskRecord(sandbox, taskId) {
  return readJsonIfPresent(join(taskStateDir(sandbox), "tasks", `${taskId}.json`))
}

export function taskEventText(sandbox, taskId) {
  return readText(join(taskStateDir(sandbox), "logs", `${taskId}.jsonl`)) ?? ""
}

export function unreadMessagePath(sandbox, teamRunId, recipient, messageId) {
  return join(memberInboxDir(sandbox, teamRunId, recipient), `${messageId}.json`)
}

export function reservedMessagePath(sandbox, teamRunId, recipient, messageId) {
  return join(memberInboxDir(sandbox, teamRunId, recipient), `${RESERVED_PREFIX}${messageId}.json`)
}

export function processedMessagePath(sandbox, teamRunId, recipient, messageId) {
  return join(memberInboxDir(sandbox, teamRunId, recipient), "processed", `${messageId}.json`)
}

export function memberSessionDir(sandbox, taskId) {
  return join(taskStateDir(sandbox), "children", taskId, "sessions", taskId)
}

export function sessionEnvelopeCount(sandbox, taskId, messageId) {
  const marker = `messageId=\"${messageId}\"`
  return sessionStringValues(sandbox, taskId)
    .filter((value) => value.includes("<peer_message ") && value.includes(marker))
    .length
}

export function sessionContainsText(sandbox, taskId, needle) {
  return sessionStringValues(sandbox, taskId).some((value) => value.includes(needle))
}

export function deliveredEventCount(sandbox, taskId, messageId) {
  let count = 0
  for (const line of taskEventText(sandbox, taskId).split(/\r?\n/)) {
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
export function discoverRunIds(sandbox) {
  const root = runtimeRootDir(sandbox)
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

function sessionStringValues(sandbox, taskId) {
  const sessionDir = memberSessionDir(sandbox, taskId)
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
