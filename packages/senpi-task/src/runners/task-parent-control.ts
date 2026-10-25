import type { EngineHoldInputResult, EngineResumeReceipt, ObservedHold, RunPauseOwner } from "../pause/ports"

export type TaskParentCommand =
  | { readonly type: "set_client_info"; readonly width: number; readonly capabilities: readonly ["task_parent"] }
  | ({ readonly type: "pause_for_run" } & RunPauseOwner)
  | {
    readonly type: "resume_for_run"; readonly parentSessionId: string; readonly parentPauseSeq: number
    readonly resumeId: string; readonly childSeqCutoff: number
  }
  | {
    readonly type: "hold_input"; readonly inputId: string; readonly revision: number; readonly text: string
    readonly parentSessionId: string; readonly origin: "human"
  }
  | { readonly type: "get_state" }

export type HeldGuidanceInput = { readonly inputId: string; readonly revision: number; readonly text: string }

export type TaskParentWire = {
  readonly width: number
  send(command: TaskParentCommand): Promise<
    { readonly success: true; readonly data?: unknown } | { readonly success: false; readonly error: string }>
}

export class TaskParentControlError extends Error {
  constructor(readonly code: "task_parent_required" | "wrong_parent" | "unsupported" | "request_rejected" | "protocol_error") {
    super(code)
  }
}

const identified = new WeakMap<TaskParentWire, Promise<void>>()

export function createTaskParentControl(wire: TaskParentWire) {
  function identify(): Promise<void> {
    let ready = identified.get(wire)
    if (ready === undefined) {
      ready = wire.send({ type: "set_client_info", width: wire.width, capabilities: ["task_parent"] }).then(response => {
        if (!response.success) throw rejection(response.error)
      })
      identified.set(wire, ready)
    }
    return ready
  }

  return {
    async pauseForRun(owner: RunPauseOwner): Promise<{ readonly childSeq: number } | { readonly refused: "wrong_parent" }> {
      await identify()
      const response = await wire.send({ type: "pause_for_run", ...owner })
      if (!response.success) {
        if (response.error.startsWith("wrong_parent:")) return { refused: "wrong_parent" }
        throw rejection(response.error)
      }
      const data = response.data
      if (!isRecord(data) || data.held !== true || typeof data.childSeq !== "number"
        || !Number.isSafeInteger(data.childSeq) || data.childSeq < 0) throw new TaskParentControlError("protocol_error")
      return { childSeq: data.childSeq }
    },
    async resumeForRun(request: {
      readonly parentSessionId: string; readonly parentPauseSeq: number; readonly resumeId: string; readonly childSeqCutoff: number
    }): Promise<EngineResumeReceipt> {
      await identify()
      const response = await wire.send({
        type: "resume_for_run", parentSessionId: request.parentSessionId, parentPauseSeq: request.parentPauseSeq,
        resumeId: request.resumeId, childSeqCutoff: request.childSeqCutoff,
      })
      if (!response.success) {
        if (response.error.startsWith("wrong_parent:")) return { released: false, reason: "wrong_parent" }
        throw rejection(response.error)
      }
      const data = response.data
      if (!isRecord(data)) throw new TaskParentControlError("protocol_error")
      if (data.released === false && (data.reason === "stale" || data.reason === "not_held")) {
        return { released: false, reason: data.reason }
      }
      if (data.released !== true || (data.otherHoldLive !== undefined && typeof data.otherHoldLive !== "boolean")
        || (data.turnId !== undefined && typeof data.turnId !== "string")) throw new TaskParentControlError("protocol_error")
      return {
        released: true,
        ...(data.otherHoldLive === undefined ? {} : { otherHoldLive: data.otherHoldLive }),
        ...(data.turnId === undefined ? {} : { turnId: data.turnId }),
      }
    },
    // Relays a person's run guidance into the child this parent paused; never an interactive escalation.
    async holdInput(parentSessionId: string, input: HeldGuidanceInput): Promise<EngineHoldInputResult> {
      await identify()
      const response = await wire.send({
        type: "hold_input", inputId: input.inputId, revision: input.revision, text: input.text,
        parentSessionId, origin: "human",
      })
      if (!response.success) {
        const conflict = /^input_id_conflict:.* at revision (\d+)$/.exec(response.error)
        if (conflict?.[1] !== undefined) return { kind: "input_id_conflict", heldRevision: Number(conflict[1]) }
        if (response.error.startsWith("wrong_parent:")) throw new TaskParentControlError("wrong_parent")
        throw rejection(response.error)
      }
      const data = response.data
      if (!isRecord(data)) throw new TaskParentControlError("protocol_error")
      if (data.alreadyDelivered === true) return { kind: "already_delivered", revision: input.revision }
      if (typeof data.entryId !== "string" || typeof data.duplicate !== "boolean") throw new TaskParentControlError("protocol_error")
      return { kind: "held", entryId: data.entryId, duplicate: data.duplicate }
    },
    // The child's live hold records (`get_state.pause`); undefined when its engine reports none.
    async observeHold(parentSessionId: string): Promise<ObservedHold | undefined> {
      const response = await wire.send({ type: "get_state" })
      if (!response.success || !isRecord(response.data)) return undefined
      const pause = response.data["pause"]
      if (!isRecord(pause) || typeof pause["pauseSeq"] !== "number" || !Array.isArray(pause["records"])) return undefined
      return {
        held: pause["records"].some(record => isRecord(record) && record["kind"] === "inherited_hold" && record["parentSessionId"] === parentSessionId),
        childSeq: pause["pauseSeq"],
      }
    },
  }
}

function rejection(message: string): TaskParentControlError {
  if (message.startsWith("task_parent_required:")) return new TaskParentControlError("task_parent_required")
  // A child engine that predates the run hold (senpi#3811) does not know the command at all.
  if (message.startsWith("Unknown command:")) return new TaskParentControlError("unsupported")
  return new TaskParentControlError("request_rejected")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
