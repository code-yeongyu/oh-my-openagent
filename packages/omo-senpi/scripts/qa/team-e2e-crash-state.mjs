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
    readMemberTerminal: (sandbox, target) => readMemberTerminal(sandbox, target, processAlive),
    readPostCrashMailbox,
    ageCrashReservation,
    isProcessAlive: processAlive,
    killProcess,
    terminateProcessTree,
    taskRecord,
    ...overrides,
  }
}

export function replacementMemberEnv(sandbox, target) {
  return {
    SENPI_TASK_MEMBER: `${target.runId}::crash`,
    SENPI_TASK_MEMBER_TASK_ID: target.taskId,
    SENPI_CODING_AGENT_SESSION_DIR: memberSessionDir(sandbox, target.taskId),
    SENPI_TASK_TEAM_CONFIG: JSON.stringify({
      enabled: true,
      tmux_visualization: false,
      base_dir: teamBaseDir(sandbox),
      stateDir: taskStateDir(sandbox),
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

function readCrashReservationState(sandbox, target) {
  if (!target.ready) return { reservedExists: false, processedExists: false, eventCount: 0 }
  return {
    reservedExists: existsSync(reservedMessagePath(sandbox, target.runId, "crash", target.messageId)),
    processedExists: existsSync(processedMessagePath(sandbox, target.runId, "crash", target.messageId)),
    eventCount: deliveredEventCount(sandbox, target.taskId, target.messageId),
  }
}

function readPostCrashMailbox(sandbox, target) {
  if (!target.ready) return emptyMailboxState(target)
  return {
    ...inboxCounts(memberInboxDir(sandbox, target.runId, "crash")),
    reservedExists: existsSync(reservedMessagePath(sandbox, target.runId, "crash", target.messageId)),
    unreadExists: existsSync(unreadMessagePath(sandbox, target.runId, "crash", target.messageId)),
    processedExists: existsSync(processedMessagePath(sandbox, target.runId, "crash", target.messageId)),
    eventCount: deliveredEventCount(sandbox, target.taskId, target.messageId),
    envelopeCount: sessionEnvelopeCount(sandbox, target.taskId, target.messageId),
  }
}

function readMemberTerminal(sandbox, target, processAlive) {
  const record = target.taskId === undefined ? undefined : taskRecord(sandbox, target.taskId)
  if (record !== undefined && ABNORMAL_MEMBER_STATES.has(record.status)) return { kind: "record", status: record.status }
  if (target.pid !== undefined && !processAlive(target.pid)) return { kind: "exit" }
  return { kind: undefined }
}

function ageCrashReservation(sandbox, target) {
  const path = reservedMessagePath(sandbox, target.runId, "crash", target.messageId)
  if (!existsSync(path)) return false
  const aged = (Date.now() - STALE_RESERVATION_AGE_MS) / 1000
  utimesSync(path, aged, aged)
  return true
}

function readCrashTarget(sandbox, markerPath) {
  const marker = readJsonIfPresent(markerPath)
  const messageId = typeof marker?.messageId === "string" ? marker.messageId : undefined
  const runId = discoverRunIds(sandbox)[0]
  const taskId = runId === undefined ? undefined : memberTaskId(sandbox, runId, "crash")
  const record = taskId === undefined ? undefined : taskRecord(sandbox, taskId)
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
