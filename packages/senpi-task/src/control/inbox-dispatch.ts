import { log } from "@oh-my-opencode/utils"
import type { TaskRecordStore } from "../store"
import { parentKey, parseControlFileName } from "./control-paths"
import type { ControlAck, ControlRegister } from "./control-schema"
import { deleteRegisterIfUnchanged, readRegister, writeAck, type ControlStore } from "./control-store"
import type { ControlOwnerPort, ReconcileAnswer, ReconcileResult } from "./owner-port"
import { reconcileRegister, resumeRecord } from "./owner-reconcile"

export const MAX_FILES_PER_TICK = 64
const MAX_ATTEMPTS = 10
const BACKOFF_FLOOR_MS = 1_000
const BACKOFF_CEILING_MS = 60_000

type Failure = { readonly text: string; readonly failures: number; readonly nextAt: number }

export type DispatchState = {
  readonly answered: Map<string, string>
  readonly failures: Map<string, Failure>
  readonly logged: Set<string>
}

export function createDispatchState(): DispatchState {
  return { answered: new Map(), failures: new Map(), logged: new Set() }
}

export type DispatchContext = {
  readonly control: ControlStore
  readonly store: TaskRecordStore
  readonly state: DispatchState
  readonly now: number
  readonly owner: { readonly pid: number; readonly managerInstance: string; readonly processStartTime?: number }
  holder(taskId: string): ControlOwnerPort | undefined
  hostPid: number
}

export type ValidRegister = { readonly name: string; readonly register: ControlRegister; readonly text: string }

function logOnce(context: DispatchContext, name: string, reason: string): void {
  const key = `${name}\0${reason}`
  if (context.state.logged.has(key)) return
  context.state.logged.add(key)
  log("[senpi-task] control register ignored", { name, reason })
}

// Validation steps 1-2 (design 3.3): the file rule, then the strict schema and the name binding.
export function validRegister(context: DispatchContext, name: string): ValidRegister | undefined {
  const parsedName = parseControlFileName(name)
  if (parsedName?.kind !== "want") return undefined
  const read = readRegister(context.control, name)
  if (read.kind === "absent") return undefined
  if (read.kind === "refused") { logOnce(context, name, read.reason); return undefined }
  if (read.register.taskId !== parsedName.taskId || parentKey(read.register.parentSessionId) !== parsedName.parentKey) {
    logOnce(context, name, "name_mismatch")
    return undefined
  }
  return { name, register: read.register, text: read.text }
}

function ackFor(context: DispatchContext, register: ControlRegister, answer: ReconcileAnswer): ControlAck {
  return {
    version: 1, taskId: register.taskId, runEpoch: register.runEpoch, parentSessionId: register.parentSessionId,
    pauseSeq: register.pauseSeq, phase: register.phase, ...(register.resumeId === undefined ? {} : { resumeId: register.resumeId }),
    state: answer.state, ...(answer.reason === undefined ? {} : { reason: answer.reason }),
    ...(answer.childSeq === undefined ? {} : { childSeq: answer.childSeq }), ...(answer.turnId === undefined ? {} : { turnId: answer.turnId }),
    ...(answer.guidance === undefined || answer.guidance.length === 0 ? {} : { guidance: answer.guidance }),
    owner: context.owner, at: new Date(context.now).toISOString(),
  }
}

function answerRegister(context: DispatchContext, entry: ValidRegister, answer: ReconcileAnswer): void {
  if (!writeAck(context.control, ackFor(context, entry.register, answer))) {
    logOnce(context, entry.name, "ack_write_failed")
    return
  }
  context.state.answered.set(entry.name, entry.text)
  context.state.failures.delete(entry.name)
  if (answer.final) deleteRegisterIfUnchanged(context.store, context.control, entry.register, entry.text)
}

function backoffDue(context: DispatchContext, entry: ValidRegister): boolean {
  const failure = context.state.failures.get(entry.name)
  return failure === undefined || failure.text !== entry.text || failure.nextAt <= context.now
}

function recordFailure(context: DispatchContext, entry: ValidRegister, error: unknown, capped: boolean): void {
  const prior = context.state.failures.get(entry.name)
  const failures = (prior?.text === entry.text ? prior.failures : 0) + 1
  const delay = Math.min(BACKOFF_CEILING_MS, BACKOFF_FLOOR_MS * 2 ** (failures - 1))
  context.state.failures.set(entry.name, { text: entry.text, failures, nextAt: context.now + delay })
  log("[senpi-task] control reconcile failed", { name: entry.name, failures, error: error instanceof Error ? error.message : String(error) })
  if (capped && failures >= MAX_ATTEMPTS) answerRegister(context, entry, { state: "refused", reason: "owner_failed", final: false })
}

export type Dispatched = ReconcileResult | { readonly kind: "skipped" }

// One register, once per content: an answered content is not acted on again until the requester
// rewrites it; a failing one backs off 1 s .. 60 s and stops at owner_failed after 10 attempts,
// except a cancel-final record, which is never parked.
export async function dispatchRegister(context: DispatchContext, entry: ValidRegister): Promise<Dispatched> {
  if (context.state.answered.get(entry.name) === entry.text || !backoffDue(context, entry)) return { kind: "skipped" }
  const port = context.holder(entry.register.taskId)
  if (port === undefined) {
    const record = context.store.load(entry.register.taskId)
    if (record?.host_pid === context.hostPid) answerRegister(context, entry, { state: "refused", reason: "handle_gone", final: false })
    return { kind: "unaddressed" }
  }
  try {
    const result = await reconcileRegister(port, entry.register)
    if (result.kind === "answer") answerRegister(context, entry, result.answer)
    return result
  } catch (error) {
    recordFailure(context, entry, error, port.load(entry.register.taskId)?.cancel_requested === undefined)
    return { kind: "retry" }
  }
}

// One child inside the owner's own-Stop release transaction: same failure handling, the run's credential.
export async function dispatchTransactionChild(context: DispatchContext, entry: ValidRegister,
  credential: import("../pause/admission-barrier").ResumeCredential): Promise<void> {
  const port = context.holder(entry.register.taskId)
  const record = port?.load(entry.register.taskId)
  if (port === undefined || record === undefined || record.cancel_requested !== undefined || record.status !== "paused") return
  try {
    const result = await resumeRecord(port, record, entry.register, credential)
    if (result.kind === "answer") answerRegister(context, entry, result.answer)
  } catch (error) {
    recordFailure(context, entry, error, true)
  }
}
