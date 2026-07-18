import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  deliveredEventCount,
  discoverRunIds,
  inboxCounts,
  memberInboxDir,
  memberTaskId,
  processedMessagePath,
  readJsonIfPresent,
  sessionEnvelopeCount,
  taskRecord,
} from "./team-e2e-support.mjs"
import { killProcess, killProcessGroup, pollUntil } from "./team-e2e-runtime.mjs"
import { CRASH_SEED_SCRIPT, NOOP_SCRIPT } from "./team-e2e-scripts.mjs"

const HOLD_TIMEOUT_MS = 30_000
const RECOVERY_TIMEOUT_MS = 30_000

export async function runCrashRestartScenario(input) {
  const sandbox = input.createSandbox()
  input.seedProject(sandbox)
  const markerPath = join(input.outDir, "crash-after-inject.json")
  const initial = input.startRun({
    senpiBin: input.senpiBin,
    sandbox,
    prompt: "seed a member delivery and hold after injection",
    script: CRASH_SEED_SCRIPT,
    extraEnv: { SENPI_TASK_QA_HOLD_AFTER_INJECT: markerPath },
  })
  const target = await pollUntil(
    () => Promise.resolve(readCrashTarget(sandbox.cwd, markerPath)),
    (value) => value.ready,
    HOLD_TIMEOUT_MS,
  )
  const before = readRecoveryState(sandbox.cwd, target)
  const memberKilled = target.pid === undefined ? false : killProcess(target.pid)
  const parentKilled = initial.pid === undefined ? false : killProcessGroup(initial.pid)
  const initialResult = await initial.completion
  writeFileSync(join(input.outDir, "crash-initial-stdout.json.log"), initialResult.stdout)
  writeFileSync(join(input.outDir, "crash-initial-stderr.log"), initialResult.stderr)

  let restartStatus = null
  let recovery = readRecoveryState(sandbox.cwd, target)
  if (target.ready) {
    const restartResult = await input.startRun({
      senpiBin: input.senpiBin,
      sandbox,
      prompt: "restart the same sandbox and reconcile the crashed member",
      script: NOOP_SCRIPT,
    }).completion
    restartStatus = restartResult.status
    writeFileSync(join(input.outDir, "crash-restart-stdout.json.log"), restartResult.stdout)
    writeFileSync(join(input.outDir, "crash-restart-stderr.log"), restartResult.stderr)
    recovery = await pollUntil(
      () => Promise.resolve(readRecoveryState(sandbox.cwd, target)),
      isRecoveredExactlyOnce,
      RECOVERY_TIMEOUT_MS,
    )
  }

  const evidence = {
    target,
    before,
    memberKilled,
    parentKilled,
    initialStatus: initialResult.status,
    restartStatus,
    recovery,
  }
  writeFileSync(join(input.outDir, "crash-recovery.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  return evaluateCrashRecovery(evidence)
}

export function evaluateCrashRecovery(evidence) {
  return {
    crashHoldReached: evidence.target.ready,
    crashKilledMemberAtHold: evidence.memberKilled && evidence.parentKilled,
    crashReservationUncommittedAtKill:
      evidence.before.processedExists === false && evidence.before.eventCount === 0,
    crashRestartExitClean: evidence.restartStatus === 0,
    crashProcessedLedgerExactlyOnce:
      evidence.recovery.processedExists && evidence.recovery.processedCount === 1,
    crashDeliveredEventExactlyOnce: evidence.recovery.eventCount === 1,
    crashSessionEnvelopeExactlyOnce: evidence.recovery.envelopeCount === 1,
  }
}

function readCrashTarget(cwd, markerPath) {
  const marker = readJsonIfPresent(markerPath)
  const messageId = typeof marker?.messageId === "string" ? marker.messageId : undefined
  const runId = discoverRunIds(cwd)[0]
  const taskId = runId === undefined ? undefined : memberTaskId(cwd, runId, "crash")
  const record = taskId === undefined ? undefined : taskRecord(cwd, taskId)
  const pid = typeof record?.pid === "number" ? record.pid : undefined
  return {
    ready: messageId !== undefined && runId !== undefined && taskId !== undefined && pid !== undefined,
    markerPath,
    messageId,
    runId,
    taskId,
    pid,
  }
}

function readRecoveryState(cwd, target) {
  if (!target.ready) return emptyRecoveryState()
  const inbox = memberInboxDir(cwd, target.runId, "crash")
  return {
    processedExists: existsSync(processedMessagePath(cwd, target.runId, "crash", target.messageId)),
    processedCount: inboxCounts(inbox).processed,
    eventCount: deliveredEventCount(cwd, target.taskId, target.messageId),
    envelopeCount: sessionEnvelopeCount(cwd, target.taskId, target.messageId),
  }
}

function emptyRecoveryState() {
  return { processedExists: false, processedCount: 0, eventCount: 0, envelopeCount: 0 }
}

function isRecoveredExactlyOnce(value) {
  return value.processedExists && value.processedCount === 1 && value.eventCount === 1 && value.envelopeCount === 1
}
