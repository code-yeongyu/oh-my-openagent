import type { ManagedChildHandle, RunnerOutcome } from "../manager/child-handle"
import type { ManagedRunner, ManagedStartSpec } from "../manager/types"
import type { AdmissionTicket } from "./admission-barrier"

export type RunRef = { readonly kind: "dag" | "task" | "workpool" | "team"; readonly id: string }

export type RunPauseOwner = {
  readonly parentSessionId: string
  readonly parentPauseSeq: number
  readonly runRef: RunRef
}

export type EnginePauseState = {
  readonly pauseSeq: number
  readonly holds: readonly { readonly kind: string; readonly key: string; readonly data?: unknown }[]
}

export type EngineHoldInputResult =
  | { readonly kind: "held"; readonly entryId: string; readonly duplicate: boolean }
  | { readonly kind: "already_delivered"; readonly revision: number }
  | { readonly kind: "input_id_conflict"; readonly heldRevision: number }

export type EngineResumeReceipt =
  | { readonly released: false; readonly reason: "stale" | "not_held" | "wrong_parent" }
  | { readonly released: true; readonly otherHoldLive?: boolean; readonly turnId?: string }

export type EngineInheritReceipt = { readonly childSeq: number } | { readonly refused: "wrong_parent" }

// The engine's extension-context method that releases a run's fence when the run is cancelled
// (senpi#3871, releaseFences("run_cancelled", [runRef])). The ONE place its name is spelled.
export const RELEASE_RUN_FENCE = "releaseRunFence"

export type EngineRunHoldContext = {
  getPauseState?(): EnginePauseState
  fenceRun?(runRef: RunRef): void
  readonly [RELEASE_RUN_FENCE]?: (runRef: RunRef) => void
}

export type EngineHoldChangedEvent = EnginePauseState & {
  readonly type: "session_hold_changed"
  readonly change: "paused" | "resumed"
}

export type ResumedChildTurn = {
  readonly turnId: string
  readonly outcome: Promise<RunnerOutcome>
}

// What a child's engine reports about this parent's run hold right now.
export type ObservedHold = { readonly held: boolean; readonly childSeq: number }

export type ChildPausePort = {
  pauseForRun(child: ManagedChildHandle, owner: RunPauseOwner): Promise<EngineInheritReceipt>
  // Undefined when the child's engine reports no pause view.
  observeHold?(child: ManagedChildHandle, parentSessionId: string): Promise<ObservedHold | undefined>
  resumeTurn(child: ManagedChildHandle, request: RunPauseOwner & {
    readonly resumeId: string
    readonly childSeqCutoff: number
  }): Promise<ResumedChildTurn | { readonly otherHoldLive: true; readonly childSeq?: number }>
  holdInput(child: ManagedChildHandle, input: {
    readonly inputId: string
    readonly revision: number
    readonly text: string
  }, owner: { readonly parentSessionId: string }): Promise<EngineHoldInputResult>
}

export type GuardedChild = {
  readonly child: ManagedChildHandle
  // Initialization is staged: no session-start producer or first prompt may execute before
  // this final admission check. A closed ticket installs inherited custody before binding.
  activate(): Promise<ResumedChildTurn | {
    readonly kind: "paused"
    readonly childSeq: number
    readonly owner: RunPauseOwner
  }>
}

export type ChildCreationPort = {
  // The engine implementation owns the pre-bind seam for both in-process and RPC children.
  // Return an unstarted child, never a handle whose initial prompt is already running.
  startPaused(spec: ManagedStartSpec, runner: ManagedRunner, ticket: AdmissionTicket): Promise<GuardedChild>
}
