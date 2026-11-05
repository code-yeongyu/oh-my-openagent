import { log } from "@oh-my-opencode/utils"
import type { ResumeCredential } from "./admission-barrier"
import type { PauseParticipant, PauseRegistry } from "./registry"
import { REMOTE_DEADLINE_MS, remoteFailure, writeRemote } from "./remote-participants"
import type { ResumeFailure, RunPauseEffects } from "./run-controller"

export type Steps = { readonly registry: PauseRegistry; readonly effects: RunPauseEffects; now(): number }

// One remote participant's Resume: no observe and no missing-cutoff throw, and an effect failure
// never escapes resume(), so install/released always run and admission reopens (design 3.2).
export async function resumeRemote(steps: Steps, input: {
  readonly parentSessionId: string; readonly pauseSeq: number; readonly resumeId: string; readonly participant: PauseParticipant
  readonly credential: ResumeCredential | undefined; readonly current: () => boolean; readonly deadlineAt: number | undefined
}): Promise<ResumeFailure | "superseded" | undefined> {
  const { parentSessionId, pauseSeq, resumeId, participant, current } = input
  let result: Awaited<ReturnType<RunPauseEffects["resume"]>>
  try {
    result = await steps.effects.resume(participant, { parentSessionId, parentPauseSeq: pauseSeq, resumeId, runRef: participant.runRef },
      input.credential, input.deadlineAt ?? steps.now() + REMOTE_DEADLINE_MS)
  } catch (error) {
    log("[senpi-task] run resume of a remote participant failed", { parentSessionId, pauseSeq, key: participant.key, error: String(error) })
    return current() ? { key: participant.key, reason: `remote resume failed: ${error instanceof Error ? error.message : String(error)}` } : "superseded"
  }
  if (!current()) return "superseded"
  if (result.kind === "remote") {
    writeRemote(steps.registry, parentSessionId, pauseSeq, participant.key, result)
    return remoteFailure(participant.key, result)
  }
  if (result.kind === "settled") steps.registry.drop(parentSessionId, pauseSeq, participant.key)
  else if (result.kind === "held_by_user") steps.registry.update(parentSessionId, pauseSeq, participant.key, { state: "held_by_user", observedChildSeq: result.childSeq })
  else steps.registry.update(parentSessionId, pauseSeq, participant.key, {
    state: "resumed", lostReason: undefined, ownerPid: undefined, reason: undefined, guidance: undefined,
    ...(result.turnId === undefined ? {} : { resumeTurnId: result.turnId }),
  })
  return undefined
}

export async function pauseRemote(steps: Steps, parentSessionId: string, pauseSeq: number, participant: PauseParticipant, deadlineAt: number): Promise<void> {
  let result: Awaited<ReturnType<RunPauseEffects["pause"]>> | { readonly kind: "lost"; readonly reason: string }
  try {
    result = await steps.effects.pause(participant, { parentSessionId, parentPauseSeq: pauseSeq, runRef: participant.runRef }, deadlineAt)
  } catch (error) {
    result = { kind: "lost", reason: error instanceof Error ? error.message : String(error) }
  }
  if (steps.registry.load(parentSessionId)?.pauseSeq !== pauseSeq) return
  if (result.kind === "remote") writeRemote(steps.registry, parentSessionId, pauseSeq, participant.key, result)
  else if (result.kind === "settled") steps.registry.drop(parentSessionId, pauseSeq, participant.key)
  else if (result.kind === "held") steps.registry.update(parentSessionId, pauseSeq, participant.key, {
    state: "held", ackSeq: pauseSeq, observedChildSeq: result.childSeq, reason: undefined,
  })
  else if (result.kind === "lost") log("[senpi-task] remote pause attempt failed", { parentSessionId, pauseSeq, key: participant.key, reason: result.reason })
}
