import { log } from "@oh-my-opencode/utils"
import type { ObservedHold } from "./ports"
import type { PauseParticipant } from "./registry"
import { inRemoteClass, REMOTE_DEADLINE_MS, writeRemote } from "./remote-participants"
import { pauseRemote, type Steps } from "./remote-steps"
import type { RunPauseEffects } from "./run-controller"

function remoteNow(steps: Steps, participant: PauseParticipant): boolean {
  return participant.kind !== "held_admission" && (inRemoteClass(participant) || steps.effects.isRemote?.(participant) === true)
}

// The Stop's propagation: every remote participant's register is written at once against ONE
// deadline, then the local participants are paused in order (design 3.2 two-pass).
export async function propagate(steps: Steps, parentSessionId: string, pauseSeq: number): Promise<boolean> {
  const pending = Object.values(steps.registry.require(parentSessionId).participants)
    .filter(participant => participant.state === "pending" && remoteNow(steps, participant))
  const deadlineAt = steps.now() + REMOTE_DEADLINE_MS
  await Promise.all(pending.map(participant => pauseRemote(steps, parentSessionId, pauseSeq, participant, deadlineAt)))
  for (const key of Object.keys(steps.registry.require(parentSessionId).participants)) {
    const record = steps.registry.require(parentSessionId)
    if (record.pauseSeq !== pauseSeq) return false
    const participant = record.participants[key]
    if (participant === undefined || participant.state === "held" || participant.state === "restorable" || participant.state === "lost" || inRemoteClass(participant)) continue
    if (participant.kind === "held_admission") {
      steps.registry.update(parentSessionId, pauseSeq, key, { state: "held", ackSeq: pauseSeq })
      continue
    }
    let result: Awaited<ReturnType<RunPauseEffects["pause"]>> | { readonly kind: "lost"; readonly reason: string }
    try {
      result = await steps.effects.pause(participant, { parentSessionId, parentPauseSeq: pauseSeq, runRef: participant.runRef })
    } catch (error) {
      result = { kind: "lost", reason: error instanceof Error ? error.message : String(error) }
    }
    if (steps.registry.require(parentSessionId).pauseSeq !== pauseSeq) return false
    if (result.kind === "lost") await holdOrLose(steps, parentSessionId, pauseSeq, participant, result.reason)
    else if (result.kind === "remote") writeRemote(steps.registry, parentSessionId, pauseSeq, key, result)
    else if (result.kind === "settled") steps.registry.drop(parentSessionId, pauseSeq, key)
    else if (result.kind === "held") steps.registry.update(parentSessionId, pauseSeq, key, {
      state: "held", ackSeq: pauseSeq, observedChildSeq: result.childSeq,
    })
  }
  return true
}

export function observe(steps: Steps, parentSessionId: string, participant: PauseParticipant): Promise<ObservedHold | undefined> {
  return steps.effects.observeHold?.(participant, parentSessionId).catch((error: unknown) => {
    log("[senpi-task] run hold observation failed", { parentSessionId, key: participant.key, error: error instanceof Error ? error.message : String(error) })
    return undefined
  }) ?? Promise.resolve(undefined)
}

// Only a child its engine does not hold is lost: a failed pause request can land after the hold.
export async function holdOrLose(steps: Steps, parentSessionId: string, pauseSeq: number, participant: PauseParticipant, reason: string): Promise<void> {
  const observed = await observe(steps, parentSessionId, participant)
  if (steps.registry.require(parentSessionId).pauseSeq !== pauseSeq) return
  if (observed?.held === true) {
    steps.registry.update(parentSessionId, pauseSeq, participant.key, { state: "held", ackSeq: pauseSeq, observedChildSeq: observed.childSeq })
    return
  }
  log("[senpi-task] run pause lost a participant", { parentSessionId, pauseSeq, key: participant.key, reason })
  steps.registry.update(parentSessionId, pauseSeq, participant.key, { state: "lost", lostReason: reason })
}
