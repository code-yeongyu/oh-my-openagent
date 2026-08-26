import { existsSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  deliveredEventCount,
  discoverRunIds,
  inboxCounts,
  memberInboxDir,
  memberSessionDir,
  memberTaskId,
  processedMessagePath,
  readJsonIfPresent,
  reservedMessagePath,
  sessionEnvelopeCount,
  taskRecord,
  taskStateDir,
  teamBaseDir,
  unreadMessagePath,
} from "./team-e2e-support.mjs"
import { isProcessAlive, killProcess, pollUntil, terminateProcessTree } from "./team-e2e-runtime.mjs"

const STALE_RESERVATION_AGE_MS = 20 * 60 * 1000
const ABNORMAL_MEMBER_STATES = new Set(["error", "lost"])

export function createCrashOperations(overrides = {}) {
  const processAlive = overrides.isProcessAlive ?? isProcessAlive
  return {
    pollUntil,
    readCrashTarget,
    readCrashReservationState,
    readMemberTerminal: (cwd, target) => readMemberTerminal(cwd, target, processAlive),
    readPostCrashMailbox,
    ageCrashReservation,
    isProcessAlive: processAlive,
    killProcess,
    terminateProcessTree,
    taskRecord,
    ...overrides,
  }
}

export function replacementMemberEnv(cwd, target) {
  return {
    SENPI_TASK_MEMBER: `${target.runId}::crash`,
    SENPI_TASK_MEMBER_TASK_ID: target.taskId,
    SENPI_CODING_AGENT_SESSION_DIR: memberSessionDir(cwd, target.taskId),
    SENPI_TASK_TEAM_CONFIG: JSON.stringify({
      enabled: true,
      tmux_visualization: false,
      base_dir: teamBaseDir(cwd),
      stateDir: taskStateDir(cwd),
      members: ["crash"],
      max_members: 8,
      max_parallel_members: 4,
      max_messages_per_run: 10000,
      max_wall_clock_minutes: 120,
      max_member_turns: 500,
      message_payload_max_bytes: 32768,
      recipient_unread_max_bytes: 262144,
      mailbox_poll_interval_ms: 3000,
    }),
  }
}

export function emptyMailboxState(target) {
  return {
    messageId: target.messageId,
    unread: 0,
    reserved: 0,
    processed: 0,
    reservedExists: false,
    unreadExists: false,
    processedExists: false,
    eventCount: 0,
    envelopeCount: 0,
  }
}

export function failedParentTermination(pid, error) {
  return { kind: "failed", pid: pid ?? null, platform: process.platform, status: null, error }
}

export function writeRunLogs(outDir, prefix, result) {
  writeFileSync(join(outDir, `${prefix}-stdout.json.log`), result.stdout)
  writeFileSync(join(outDir, `${prefix}-stderr.log`), result.stderr)
}

function readCrashReservationState(cwd, target) {
  if (!target.ready) return { reservedExists: false, processedExists: false, eventCount: 0 }
  return {
    reservedExists: existsSync(reservedMessagePath(cwd, target.runId, "crash", target.messageId)),
    processedExists: existsSync(processedMessagePath(cwd, target.runId, "crash", target.messageId)),
    eventCount: deliveredEventCount(cwd, target.taskId, target.messageId),
  }
}

function readPostCrashMailbox(cwd, target) {
  if (!target.ready) return emptyMailboxState(target)
  return {
    ...inboxCounts(memberInboxDir(cwd, target.runId, "crash")),
    reservedExists: existsSync(reservedMessagePath(cwd, target.runId, "crash", target.messageId)),
    unreadExists: existsSync(unreadMessagePath(cwd, target.runId, "crash", target.messageId)),
    processedExists: existsSync(processedMessagePath(cwd, target.runId, "crash", target.messageId)),
    eventCount: deliveredEventCount(cwd, target.taskId, target.messageId),
    envelopeCount: sessionEnvelopeCount(cwd, target.taskId, target.messageId),
  }
}

function readMemberTerminal(cwd, target, processAlive) {
  const record = target.taskId === undefined ? undefined : taskRecord(cwd, target.taskId)
  if (record !== undefined && ABNORMAL_MEMBER_STATES.has(record.status)) return { kind: "record", status: record.status }
  if (target.pid !== undefined && !processAlive(target.pid)) return { kind: "exit" }
  return { kind: undefined }
}

function ageCrashReservation(cwd, target) {
  const path = reservedMessagePath(cwd, target.runId, "crash", target.messageId)
  if (!existsSync(path)) return false
  const aged = (Date.now() - STALE_RESERVATION_AGE_MS) / 1000
  utimesSync(path, aged, aged)
  return true
}

function readCrashTarget(cwd, markerPath) {
  const marker = readJsonIfPresent(markerPath)
  const messageId = typeof marker?.messageId === "string" ? marker.messageId : undefined
  const runId = discoverRunIds(cwd)[0]
  const taskId = runId === undefined ? undefined : memberTaskId(cwd, runId, "crash")
  const record = taskId === undefined ? undefined : taskRecord(cwd, taskId)
  const pid = typeof record?.pid === "number" ? record.pid : undefined
  const leadSessionId = typeof record?.parent_session_id === "string" ? record.parent_session_id : undefined
  return {
    ready: messageId !== undefined && runId !== undefined && taskId !== undefined && pid !== undefined && leadSessionId !== undefined,
    markerPath,
    messageId,
    runId,
    taskId,
    pid,
    leadSessionId,
  }
}
