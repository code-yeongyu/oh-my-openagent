import { log } from "@oh-my-opencode/utils"

import { sessionTailReconciliation } from "../../manager/interrupted-turn"
import type { TaskRecord } from "../../state"
import type { RunnerOutcome } from "../in-process/child-handle"
import { reattachContinuationPrompt } from "./reattach"
import type { HostSessionLiveness } from "./handle-port"

/** Structural input seam for S1. Todo 25 supplies the capability-gated ledger receipt. */
export type InputEffectStatus = {
  readonly state: "accepted" | "applied" | "done" | "failed"
  readonly outcome?: {
    readonly kind: "completed" | "aborted" | "interrupted_by_reopen" | "deadline" | "error"
    readonly deadline?: Readonly<Record<string, unknown>>
    readonly reason?: string
    readonly detail?: string
    readonly action?: string
  }
}

export type HostTurnReconciliation = "streaming" | "adopted" | "continued" | "idle_queued" | "idle_empty" | "interrupted" | "stopped_deadline" | "failed"

export type ReconciledTurnNotice =
  | { readonly kind: "adopted"; readonly entryId: string }
  | { readonly kind: "interrupted"; readonly reason: string; readonly action?: string; readonly deadline?: Readonly<Record<string, unknown>> }
  | { readonly kind: "idle_queued"; readonly reason: string }

export interface ReconcileTurnPort {
  getState(): Promise<HostSessionLiveness>
  readonly lastInputEffect?: InputEffectStatus
  readonly interruptedWithoutTranscript?: boolean
  /** The host reopened the session from its file, so no turn can be running there. */
  readonly reopened?: boolean
  readonly adoptedEntryId?: string
  settle(outcome: RunnerOutcome): void
  notify(notice: ReconciledTurnNotice): void
}

const INTERRUPTED_REASON = "The child's previous turn was interrupted; its continuation is being delivered."
export const DEADLINE_REASON = "The child stopped because its turn deadline expired. Action: inspect task_output, then use task_send to continue it."
const QUEUED_REASON = "The child is idle with queued input. Action: use task_send to start its next turn."
export const HOST_RESPAWN_CONTINUATION =
  "Your previous turn was interrupted by a host process restart. Resume your task from its current state and finish it - do not restart from scratch, and do not repeat work already recorded in this session."

/** Execution truth outranks the receipt, which outranks transcript inference. Never sends input. */
export async function reconcileHostTurn(
  port: ReconcileTurnPort,
  record: Pick<TaskRecord, "host_session" | "final_response">,
  sessionPath: string,
): Promise<HostTurnReconciliation> {
  // A session the host just reopened from its file has no running turn, so its state is not asked for:
  // reconciliation goes straight to the receipt and the transcript.
  if (port.reopened !== true) {
    let state: HostSessionLiveness
    try {
      state = await port.getState()
    } catch (error) {
      log("senpi-task host turn state read failed", {
        sessionPath,
        reason: error instanceof Error ? error.message : String(error),
        action: "Keep the child tracked as streaming and wait for its next outcome without sending input.",
      })
      return "streaming"
    }
    if (state.isStreaming === true || state.isCompacting === true) return "streaming"
  }
  const receipt = port.lastInputEffect
  if (receipt?.state === "accepted") {
    port.notify({ kind: "idle_queued", reason: QUEUED_REASON })
    port.settle({ status: "cancelled" })
    return "idle_queued"
  }
  const tail = await sessionTailReconciliation(sessionPath, [reattachContinuationPrompt(), HOST_RESPAWN_CONTINUATION])
  const outcome = receipt?.state === "done" ? receipt.outcome : undefined
  const deadline = outcome?.kind === "deadline"
    ? outcome.deadline ?? {}
    : outcome === undefined ? tail?.endEvent?.deadline : undefined
  if (outcome?.kind === "deadline" || (deadline !== undefined && typeof deadline === "object" && deadline !== null)) {
    port.notify({ kind: "interrupted", reason: DEADLINE_REASON, deadline: typeof deadline === "object" && deadline !== null ? { ...deadline } : {} })
    port.settle({ status: "cancelled" })
    return "stopped_deadline"
  }
  if (outcome === undefined && tail?.endEvent?.aborted === true) {
    port.notify({ kind: "interrupted", reason: INTERRUPTED_REASON })
    return "continued"
  }
  const outcomeKind = outcome?.kind ?? (tail?.lastMessage.stopReason === "error" ? "error" : undefined)
  switch (outcomeKind) {
    case "aborted":
    case "interrupted_by_reopen":
      port.notify({ kind: "interrupted", reason: INTERRUPTED_REASON })
      return "continued"
    case "error": {
      const reason = outcome?.detail ?? outcome?.reason ?? tail?.lastMessage.errorMessage ?? "The child turn failed."
      const action = outcome?.action ?? "Inspect task_output, then use task_send to continue the child."
      port.settle({ status: "error", failure: { kind: "child-turn-failed", message: `${reason} Action: ${action}` } })
      return "failed"
    }
    case "completed":
    case undefined:
      break
    default: {
      const exhaustive: never = outcomeKind
      throw new Error(`Unexpected input outcome: ${exhaustive}`)
    }
  }
  const finished = tail?.finishedText
  if (finished !== undefined || outcome?.kind === "completed") {
    // Pre-S1 test transcripts need not carry ids; real message entries always do.
    const entryId = tail?.entryId
    if (entryId !== undefined && (entryId === port.adoptedEntryId ||
      (entryId === record.host_session?.adopted_entry_id && record.final_response !== undefined))) return "adopted"
    if (entryId !== undefined && entryId !== record.host_session?.adopted_entry_id) port.notify({ kind: "adopted", entryId })
    port.settle({ status: "completed", finalResponse: finished ?? "" })
    return "adopted"
  }
  if (outcome === undefined && tail?.endsAtIgnoredUserPrompt === true) {
    port.notify({
      kind: "interrupted",
      reason: "The child's delivered continuation was interrupted before it produced a response.",
      action: "Inspect task_output, then use task_send to continue the child.",
    })
    port.settle({ status: "cancelled" })
    return "interrupted"
  }
  if (receipt?.state === "applied" || (tail === undefined && port.interruptedWithoutTranscript === true) ||
    tail?.needsContinuation === true) {
    if (tail?.lastMessage.stopReason === "aborted") port.notify({ kind: "interrupted", reason: INTERRUPTED_REASON })
    return "continued"
  }
  port.settle({ status: "completed", finalResponse: "" })
  return "idle_empty"
}
