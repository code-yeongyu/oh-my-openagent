import type { NativeRunPause } from "../../pause/native-child-pause"
import type { EngineHoldInputResult, EngineInheritReceipt, RunPauseOwner } from "../../pause/ports"
import { TaskParentControlError } from "../task-parent-control"
import type { RunnerOutcome } from "./child-handle"

/**
 * The run-hold members of senpi's AgentSession (senpi#3811). Every member is optional because the
 * pinned engine may predate them; the in-process runner exposes native pause only when all exist.
 */
export type RunHoldSession = {
  pauseForRun?(owner: RunPauseOwner): Promise<EngineInheritReceipt>
  resumeForRun?(request: {
    parentSessionId: string; parentPauseSeq: number; childSeqCutoff: number
  }): Promise<({ readonly released: true; readonly otherHoldLive: boolean }
    | { readonly released: false; readonly reason: "stale" | "wrong_parent" | "not_held" }) & { turnId?: string }>
  holdInput?(input: { inputId: string; revision: number; text: string }): EngineHoldInputResult
  readonly pauseView?: {
    readonly pauseSeq?: number
    readonly records: readonly { readonly kind: string; readonly parentSessionId?: string }[]
  }
}

/** A turn the engine itself starts on Resume; armed before the call so its agent_start is never missed. */
export type EngineTurnWatch = { readonly outcome: Promise<RunnerOutcome>; cancel(): void }

export function createInProcessRunPause(session: RunHoldSession, watchEngineTurn: () => EngineTurnWatch): NativeRunPause | undefined {
  const { pauseForRun, resumeForRun, holdInput, pauseView } = session
  if (pauseForRun === undefined || resumeForRun === undefined || holdInput === undefined || pauseView === undefined) return undefined
  return {
    pauseForRun: owner => pauseForRun.call(session, owner),
    async resumeForRun(request) {
      const watch = watchEngineTurn()
      try {
        const result = await resumeForRun.call(session, {
          parentSessionId: request.parentSessionId, parentPauseSeq: request.parentPauseSeq, childSeqCutoff: request.childSeqCutoff,
        })
        if (!result.released) {
          watch.cancel()
          return { released: false, reason: result.reason }
        }
        if (result.turnId === undefined) {
          watch.cancel()
          return { released: true, otherHoldLive: true }
        }
        return { released: true, turnId: result.turnId, outcome: watch.outcome }
      } catch (error) {
        watch.cancel()
        throw error
      }
    },
    async holdInput(parentSessionId, input) {
      // An RPC child refuses another parent at its connection; in-process the parent is checked here.
      const owned = session.pauseView?.records.some(record =>
        record.kind === "inherited_hold" && record.parentSessionId === parentSessionId) === true
      if (!owned) throw new TaskParentControlError("wrong_parent")
      return holdInput.call(session, { inputId: input.inputId, revision: input.revision, text: input.text })
    },
    async observeHold(parentSessionId) {
      // Without the engine's sequence there is no cutoff to resume with, so the hold is unknown.
      const view = session.pauseView
      if (view?.pauseSeq === undefined) return undefined
      return {
        held: view.records.some(record => record.kind === "inherited_hold" && record.parentSessionId === parentSessionId),
        childSeq: view.pauseSeq,
      }
    },
  }
}
