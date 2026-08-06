import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  createCrashOperations,
  emptyMailboxState,
  failedParentTermination,
  replacementMemberEnv,
  writeRunLogs,
} from "./team-e2e-crash-state.mjs"
import { parseEvents, processedMessagePath, unreadMessagePath } from "./team-e2e-support.mjs"
import { CRASH_SEED_SCRIPT, crashReplacementScript, NOOP_SCRIPT } from "./team-e2e-scripts.mjs"

const HOLD_TIMEOUT_MS = 30_000
const TEAM_LIVENESS_TYPE = "senpi-task.team-member-liveness"
const ABNORMAL_MEMBER_STATES = new Set(["error", "lost"])

export function hasCrashLivenessEvent(stdout) {
  for (const event of parseEvents(stdout)) {
    if (event?.type !== "message_start" && event?.type !== "message_end") continue
    const message = event?.message
    if (message === undefined || message === null || typeof message !== "object") continue
    if (message.customType === TEAM_LIVENESS_TYPE && isCrashLivenessDetails(message.details)) return true
    if (message.customType !== "omo-senpi:wake" || !Array.isArray(message.details)) continue
    for (const entry of message.details) {
      if (entry?.customType === TEAM_LIVENESS_TYPE && isCrashLivenessDetails(entry.details)) return true
    }
  }
  return false
}

function isCrashLivenessDetails(details) {
  return details !== null
    && typeof details === "object"
    && details.memberName === "crash"
    && ABNORMAL_MEMBER_STATES.has(details.lastKnownState)
}

export async function runCrashRestartScenario(input) {
  const sandbox = input.createSandbox()
  const ops = createCrashOperations(input.operations)
  try {
    input.seedProject(sandbox)
    const markerPath = join(input.outDir, "crash-after-inject.json")
    // The marker is a per-run rendezvous living in the PERSISTENT outDir: a stale marker from a
    // previous run satisfies readCrashTarget with a foreign message id before the current member's
    // afterInject overwrites it, so every id-keyed assertion then fails against a message that
    // never existed in this sandbox. Clear it (and any stale release) before the run starts.
    rmSync(markerPath, { force: true })
    rmSync(`${markerPath}.release`, { force: true })
    const initial = input.startRun({
      senpiBin: input.senpiBin,
      sandbox,
      prompt: "seed a member delivery and hold after injection",
      script: CRASH_SEED_SCRIPT,
      extraEnv: { SENPI_TASK_QA_HOLD_AFTER_INJECT: markerPath },
    })
    const target = await ops.pollUntil(
      () => Promise.resolve(ops.readCrashTarget(sandbox.cwd, markerPath)),
      (value) => value.ready,
      HOLD_TIMEOUT_MS,
    )
    const before = ops.readCrashReservationState(sandbox.cwd, target)
    const parentAliveAtHold = initial.pid !== undefined && ops.isProcessAlive(initial.pid)
    const memberAliveAtHold = target.pid !== undefined && ops.isProcessAlive(target.pid)
    const memberKilled = parentAliveAtHold && memberAliveAtHold && target.pid !== undefined
      ? ops.killProcess(target.pid)
      : false
    const memberTerminal = memberKilled
      ? await ops.pollUntil(
        () => Promise.resolve(ops.readMemberTerminal(sandbox.cwd, target)),
        (value) => value.kind !== undefined,
        HOLD_TIMEOUT_MS,
      )
      : { kind: undefined }
    const parentAliveBeforeTermination = initial.pid !== undefined && ops.isProcessAlive(initial.pid)
    const parentTermination = parentAliveBeforeTermination && memberTerminal.kind !== undefined && initial.pid !== undefined
      ? await ops.terminateProcessTree(initial.pid)
      : failedParentTermination(initial.pid, "parent was not live after the member terminal transition")
    const reservationAged = target.ready ? ops.ageCrashReservation(sandbox.cwd, target) : false
    const initialResult = await initial.completion
    const afterKillRecord = target.taskId === undefined ? undefined : ops.taskRecord(sandbox.cwd, target.taskId)
    writeRunLogs(input.outDir, "crash-initial", initialResult)

    let restartStatus = null
    let livenessInjected = false
    let afterRestartRecord
    let afterReclaim = emptyMailboxState(target)
    let afterReplacement = emptyMailboxState(target)
    if (target.ready && parentTermination.kind === "terminated") {
      const restartResult = await input.startRun({
        senpiBin: input.senpiBin,
        sandbox,
        prompt: "restart the same sandbox and reconcile the crashed member",
        script: NOOP_SCRIPT,
        sessionId: target.leadSessionId,
      }).completion
      restartStatus = restartResult.status
      writeRunLogs(input.outDir, "crash-restart", restartResult)
      livenessInjected = hasCrashLivenessEvent(restartResult.stdout)
      afterRestartRecord = target.taskId === undefined ? undefined : ops.taskRecord(sandbox.cwd, target.taskId)
      afterReclaim = ops.readPostCrashMailbox(sandbox.cwd, target)
      afterReplacement = await runReplacementMember(input, sandbox, target, ops)
    }

    const evidence = {
      target,
      before,
      parentAliveAtHold,
      memberAliveAtHold,
      memberKilled,
      memberTerminal,
      parentAliveBeforeTermination,
      parentTermination,
      reservationAged,
      afterKillRecord,
      afterRestartRecord,
      afterReclaim,
      afterReplacement,
      initialStatus: initialResult.status,
      restartStatus,
      livenessInjected,
    }
    writeFileSync(join(input.outDir, "crash-recovery.json"), `${JSON.stringify(evidence, null, 2)}\n`)
    return evaluateCrashRecovery(evidence)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

export function evaluateCrashRecovery(evidence) {
  const runEpoch = evidence.afterRestartRecord?.notification?.run_epoch
  const livenessNotifiedEpoch = evidence.afterRestartRecord?.notification?.liveness_notified_epoch
  return {
    crashHoldReached: evidence.target.ready && evidence.parentAliveAtHold === true && evidence.memberAliveAtHold === true,
    crashKilledMemberAtHold:
      evidence.memberKilled === true
      && evidence.memberTerminal?.kind !== undefined
      && evidence.parentAliveBeforeTermination === true
      && evidence.parentTermination?.kind === "terminated"
      && evidence.initialStatus !== 0,
    crashReservationUncommittedAtKill:
      evidence.before.reservedExists === true
      && evidence.before.processedExists === false
      && evidence.before.eventCount === 0,
    crashReservationRestoredUnread:
      evidence.reservationAged === true
      && evidence.afterReclaim.reservedExists === false
      && evidence.afterReclaim.unreadExists === true,
    crashReservationNoResidue: evidence.afterReplacement.reservedExists === false,
    crashReservedMessageDeliveredExactlyOnce:
      evidence.afterReplacement.unreadExists === false
      && evidence.afterReplacement.processedExists === true
      && evidence.afterReplacement.eventCount === 1
      && evidence.afterReplacement.envelopeCount === 1,
    crashRestartExitClean: evidence.restartStatus === 0,
    crashLivenessInjectedToLead: evidence.livenessInjected === true,
    crashLivenessAcknowledged:
      typeof runEpoch === "number"
      && typeof livenessNotifiedEpoch === "number"
      && livenessNotifiedEpoch >= runEpoch,
  }
}

async function runReplacementMember(input, sandbox, target, ops) {
  if (input.memberExtensionEntry === undefined) return emptyMailboxState(target)
  const memberEnv = replacementMemberEnv(sandbox.cwd, target)
  const replacement = input.startRun({
    senpiBin: input.senpiBin,
    sandbox,
    prompt: "MOCKROLE=quick recover the exact stranded crash message",
    script: crashReplacementScript(
      unreadMessagePath(sandbox.cwd, target.runId, "crash", target.messageId),
      processedMessagePath(sandbox.cwd, target.runId, "crash", target.messageId),
    ),
    noExtensions: true,
    extensionEntries: [input.memberExtensionEntry],
    sessionDir: memberEnv.SENPI_CODING_AGENT_SESSION_DIR,
    extraEnv: memberEnv,
  })
  try {
    return await ops.pollUntil(
      () => Promise.resolve(ops.readPostCrashMailbox(sandbox.cwd, target)),
      (value) => value.processedExists && value.eventCount === 1 && value.envelopeCount === 1,
      HOLD_TIMEOUT_MS,
    )
  } finally {
    await replacement.kill()
    const result = await replacement.completion
    writeRunLogs(input.outDir, "crash-replacement", result)
  }
}
