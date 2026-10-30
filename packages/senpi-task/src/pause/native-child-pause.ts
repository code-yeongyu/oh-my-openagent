import type { ManagedChildHandle, RunnerOutcome } from "../manager/child-handle"
import type { ChildPausePort, EngineHoldInputResult, EngineInheritReceipt, ObservedHold, RunPauseOwner } from "./ports"

export type NativeResumeResult =
  | { readonly released: false; readonly reason: "stale" | "not_held" | "wrong_parent" }
  // Released, but the child stays held (a newer child Stop or another hold): no turn started.
  | { readonly released: true; readonly otherHoldLive: true }
  // The engine started the resumed turn; `outcome` settles with that turn's result only.
  | { readonly released: true; readonly turnId: string; readonly outcome: Promise<RunnerOutcome> }

/**
 * A child's own engine pause controls. Present only when the child's engine implements the
 * task-parent run hold (senpi#3811); a child on an older engine exposes none of it.
 */
export type NativeRunPause = {
  pauseForRun(owner: RunPauseOwner): Promise<EngineInheritReceipt>
  resumeForRun(request: {
    readonly parentSessionId: string; readonly parentPauseSeq: number
    readonly resumeId: string; readonly childSeqCutoff: number
  }): Promise<NativeResumeResult>
  holdInput(parentSessionId: string, input: {
    readonly inputId: string; readonly revision: number; readonly text: string
  }): Promise<EngineHoldInputResult>
  observeHold?(parentSessionId: string): Promise<ObservedHold | undefined>
}

export class NativePauseUnavailableError extends Error {
  readonly code = "native_pause_unavailable"
  constructor(readonly taskId: string) {
    super(`child ${taskId} runs on an engine without native run pause`)
  }
}

export class NativeResumeRefusedError extends Error {
  readonly code = "native_resume_refused"
  constructor(readonly taskId: string, readonly reason: "stale" | "not_held" | "wrong_parent") {
    super(`child ${taskId} refused the run Resume: ${reason}`)
  }
}

function native(child: ManagedChildHandle): NativeRunPause {
  if (child.runPause === undefined) throw new NativePauseUnavailableError(child.task_id)
  return child.runPause
}

/** The production ChildPausePort: every call goes to the child's own engine, never a local stand-in. */
export const nativeChildPausePort: ChildPausePort = {
  pauseForRun: async (child, owner) => native(child).pauseForRun(owner),
  async resumeTurn(child, request) {
    const result = await native(child).resumeForRun({
      parentSessionId: request.parentSessionId, parentPauseSeq: request.parentPauseSeq,
      resumeId: request.resumeId, childSeqCutoff: request.childSeqCutoff,
    })
    if (!result.released) throw new NativeResumeRefusedError(child.task_id, result.reason)
    if ("otherHoldLive" in result) return { otherHoldLive: true }
    return { turnId: result.turnId, outcome: result.outcome }
  },
  holdInput: async (child, input, owner) => native(child).holdInput(owner.parentSessionId, input),
  observeHold: async (child, parentSessionId) => child.runPause?.observeHold?.(parentSessionId),
}
