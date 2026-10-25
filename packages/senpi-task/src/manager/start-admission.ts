import { AdmissionBarrier, type AdmissionTicket, type ResumeCredential } from "../pause/admission-barrier"
import type { RunRef } from "../pause/ports"
import { createTaskId } from "../state/id"
import type { ManagerStartSpec } from "./types"

export type HeldStart = {
  readonly kind: "held"
  readonly pauseSeq: number
  readonly root_session_id: string
  readonly task_id: string
}

const heldErrors = new WeakSet<object>()

export class AdmissionHeld extends Error {
  constructor(readonly result: HeldStart) {
    super("run admission is held")
    heldErrors.add(this)
  }
}

export function isAdmissionHeld(value: unknown): value is AdmissionHeld {
  return ((typeof value === "object" && value !== null) || typeof value === "function") && heldErrors.has(value)
}

export type StartAdmission = AdmissionTicket & {
  readonly taskId: string
  readonly rootSessionId: string
  readonly runRef: RunRef
  assertOpen(): void
  transfer(): void
  hold(): HeldStart
  bind(taskId: string): void
}

export function enterStartAdmission(input: {
  readonly barrier: AdmissionBarrier
  readonly spec: ManagerStartSpec
  readonly taskId: string
  readonly runRef?: RunRef
  readonly credential?: ResumeCredential
  readonly held?: (result: HeldStart, spec: ManagerStartSpec) => void
}) {
  const { barrier, spec, runRef, credential, held } = input
  let taskId = input.taskId
  const rootSessionId = spec.root_session_id ?? spec.parent_session_id
  const participant = { key: taskId, runRef: runRef ?? { kind: "task" as const, id: taskId } }
  const entered = barrier.enter(rootSessionId, participant, credential)
  const result = (pauseSeq: number): HeldStart => ({ kind: "held", pauseSeq, task_id: taskId, root_session_id: rootSessionId })
  if (entered.kind === "held") {
    const custody = result(entered.pauseSeq)
    held?.(custody, spec)
    return { kind: "held" as const, result: custody }
  }
  let transferred = false
  const scope: StartAdmission = {
    ...entered.ticket, get taskId() { return taskId }, rootSessionId,
    creating: () => entered.ticket.creating(taskId),
    get runRef() { return participant.runRef },
    bind: id => {
      taskId = id
      if (participant.runRef.kind === "task") participant.runRef = { kind: "task", id }
      entered.ticket.update({ key: id, runRef: participant.runRef })
    },
    transfer: () => { transferred = true },
    hold: () => {
      const check = entered.ticket.check()
      if (check.kind !== "held") throw new Error("open admission cannot enter held custody")
      const custody = result(check.pauseSeq)
      held?.(custody, spec)
      return custody
    },
    assertOpen: () => {
      const check = entered.ticket.check()
      if (check.kind === "held") throw new AdmissionHeld(result(check.pauseSeq))
    },
  }
  return { kind: "entered" as const, scope, spec: { ...spec, admission: scope }, transferred: () => transferred }
}

export function createStartAdmissions(barrier: AdmissionBarrier, held?: (result: HeldStart, spec: ManagerStartSpec) => void, now = Date.now) {
  async function run<T>(
    spec: ManagerStartSpec,
    runRef: RunRef | undefined,
    body: (admitted: ManagerStartSpec) => Promise<T>,
    credential?: ResumeCredential,
  ): Promise<T | HeldStart> {
    const entered = enterStartAdmission({ barrier, spec, taskId: createTaskId(now()), runRef, credential, held })
    if (entered.kind === "held") return entered.result
    try { return await body(entered.spec) }
    catch (error) {
      if (!isAdmissionHeld(error)) throw error
      held?.(error.result, spec)
      return error.result
    } finally {
      if (!entered.transferred()) entered.scope.leave()
    }
  }
  return { run }
}
