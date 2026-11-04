import type { RunRef } from "../pause/ports"

export const GUIDANCE_MAX_ENTRIES = 8
const GUIDANCE_MAX_BYTES = 1024
const CANCEL_REASON_MAX_BYTES = 1024

export type ControlPhase = "paused" | "resumed" | "cancelled"
export type ControlGuidance = { readonly inputId: string; readonly revision: number; readonly text: string }

export type ControlRegister = {
  readonly version: 1
  readonly taskId: string
  readonly runEpoch: number
  readonly parentSessionId: string
  readonly pauseSeq: number
  readonly runRef: RunRef
  readonly phase: ControlPhase
  readonly resumeId?: string
  readonly cancel?: { readonly requestedAt: string; readonly reason?: string }
  readonly guidance?: readonly ControlGuidance[]
  readonly requester: { readonly pid: number; readonly managerInstance: string }
  readonly writtenAt: string
}

// Closed set; an ack never carries free text.
const ACK_REASONS = [
  "not_in_ancestry", "epoch_moved", "stale", "handle_gone", "owner_held", "owner_failed", "native_pause_unavailable", "settled",
] as const
export type AckReason = (typeof ACK_REASONS)[number]
export type AckState = "held" | "resumed" | "held_by_user" | "refused" | "settled" | "cancelled"
export type GuidanceOutcome = "delivered" | "duplicate" | "already_delivered" | "undelivered"

export type ControlAck = {
  readonly version: 1
  readonly taskId: string
  readonly runEpoch: number
  readonly parentSessionId: string
  readonly pauseSeq: number
  readonly phase: ControlPhase
  readonly resumeId?: string
  readonly state: AckState
  readonly childSeq?: number
  readonly turnId?: string
  readonly guidance?: readonly { readonly inputId: string; readonly outcome: GuidanceOutcome }[]
  readonly reason?: AckReason
  readonly owner: { readonly pid: number; readonly managerInstance: string; readonly processStartTime?: number }
  readonly at: string
}

export type OwnerAdvertisement = {
  readonly version: 1
  readonly pid: number
  readonly processStartTime?: number
  readonly managerInstance: string
  readonly sessionId: string
  readonly renewedAt: string
}

type Shape = Record<string, unknown>

class SchemaError extends Error {}

function object(value: unknown, allowed: readonly string[]): Shape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SchemaError("not an object")
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SchemaError(`unknown key ${key}`)
  return value as Shape
}
const str = (value: unknown): string => { if (typeof value !== "string" || value.length === 0) throw new SchemaError("string"); return value }
const int = (value: unknown): number => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new SchemaError("int"); return value }
const opt = <T>(value: unknown, read: (value: unknown) => T): T | undefined => value === undefined ? undefined : read(value)
const bytes = (text: string): number => Buffer.byteLength(text, "utf8")
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new SchemaError("enum")
  return value as T
}

function runRef(value: unknown): RunRef {
  const shape = object(value, ["kind", "id"])
  return { kind: oneOf(shape.kind, ["dag", "task", "workpool", "team"] as const), id: str(shape.id) }
}

function readGuidance(value: unknown): readonly ControlGuidance[] {
  if (!Array.isArray(value) || value.length > GUIDANCE_MAX_ENTRIES) throw new SchemaError("guidance")
  return value.map(entry => {
    const shape = object(entry, ["inputId", "revision", "text"])
    if (typeof shape.text !== "string") throw new SchemaError("guidance text")
    const text = shape.text
    if (bytes(text) > GUIDANCE_MAX_BYTES) throw new SchemaError("guidance entry too large")
    return { inputId: str(shape.inputId), revision: int(shape.revision), text }
  })
}

const REGISTER_KEYS = ["version", "taskId", "runEpoch", "parentSessionId", "pauseSeq", "runRef", "phase", "resumeId", "cancel", "guidance", "requester", "writtenAt"]

function readRegister(value: unknown): ControlRegister {
  const shape = object(value, REGISTER_KEYS)
  if (shape.version !== 1) throw new SchemaError("version")
  const phase = oneOf(shape.phase, ["paused", "resumed", "cancelled"] as const)
  const resumeId = opt(shape.resumeId, str)
  if (phase === "resumed" && resumeId === undefined) throw new SchemaError("resumeId")
  const cancel = opt(shape.cancel, raw => {
    const entry = object(raw, ["requestedAt", "reason"])
    const reason = opt(entry.reason, str)
    if (reason !== undefined && bytes(reason) > CANCEL_REASON_MAX_BYTES) throw new SchemaError("cancel reason")
    return { requestedAt: str(entry.requestedAt), ...(reason === undefined ? {} : { reason }) }
  })
  if (phase === "cancelled" && cancel === undefined) throw new SchemaError("cancel")
  const guidance = opt(shape.guidance, readGuidance)
  const requester = object(shape.requester, ["pid", "managerInstance"])
  return {
    version: 1, taskId: str(shape.taskId), runEpoch: int(shape.runEpoch), parentSessionId: str(shape.parentSessionId),
    pauseSeq: int(shape.pauseSeq), runRef: runRef(shape.runRef), phase,
    ...(resumeId === undefined ? {} : { resumeId }), ...(cancel === undefined ? {} : { cancel }),
    ...(guidance === undefined || guidance.length === 0 ? {} : { guidance }),
    requester: { pid: int(requester.pid), managerInstance: str(requester.managerInstance) }, writtenAt: str(shape.writtenAt),
  }
}

const ACK_KEYS = ["version", "taskId", "runEpoch", "parentSessionId", "pauseSeq", "phase", "resumeId", "state", "childSeq", "turnId", "guidance", "reason", "owner", "at"]

function readAck(value: unknown): ControlAck {
  const shape = object(value, ACK_KEYS)
  if (shape.version !== 1) throw new SchemaError("version")
  const owner = object(shape.owner, ["pid", "managerInstance", "processStartTime"])
  const guidance = opt(shape.guidance, raw => {
    if (!Array.isArray(raw) || raw.length > GUIDANCE_MAX_ENTRIES) throw new SchemaError("guidance")
    return raw.map(entry => {
      const item = object(entry, ["inputId", "outcome"])
      return { inputId: str(item.inputId), outcome: oneOf(item.outcome, ["delivered", "duplicate", "already_delivered", "undelivered"] as const) }
    })
  })
  const resumeId = opt(shape.resumeId, str)
  const childSeq = opt(shape.childSeq, int)
  const turnId = opt(shape.turnId, str)
  const reason = opt(shape.reason, raw => oneOf(raw, ACK_REASONS))
  const processStartTime = opt(owner.processStartTime, int)
  return {
    version: 1, taskId: str(shape.taskId), runEpoch: int(shape.runEpoch), parentSessionId: str(shape.parentSessionId),
    pauseSeq: int(shape.pauseSeq), phase: oneOf(shape.phase, ["paused", "resumed", "cancelled"] as const),
    state: oneOf(shape.state, ["held", "resumed", "held_by_user", "refused", "settled", "cancelled"] as const),
    ...(resumeId === undefined ? {} : { resumeId }), ...(childSeq === undefined ? {} : { childSeq }),
    ...(turnId === undefined ? {} : { turnId }), ...(guidance === undefined ? {} : { guidance }),
    ...(reason === undefined ? {} : { reason }),
    owner: { pid: int(owner.pid), managerInstance: str(owner.managerInstance), ...(processStartTime === undefined ? {} : { processStartTime }) },
    at: str(shape.at),
  }
}

function readAdvertisement(value: unknown): OwnerAdvertisement {
  const shape = object(value, ["version", "pid", "processStartTime", "managerInstance", "sessionId", "renewedAt"])
  if (shape.version !== 1) throw new SchemaError("version")
  const processStartTime = opt(shape.processStartTime, int)
  return {
    version: 1, pid: int(shape.pid), managerInstance: str(shape.managerInstance), sessionId: str(shape.sessionId),
    renewedAt: str(shape.renewedAt), ...(processStartTime === undefined ? {} : { processStartTime }),
  }
}

function parse<T>(text: string, read: (value: unknown) => T): T | undefined {
  try { return read(JSON.parse(text)) } catch { return undefined }
}

export const parseRegister = (text: string): ControlRegister | undefined => parse(text, readRegister)
export const parseAck = (text: string): ControlAck | undefined => parse(text, readAck)
export const parseAdvertisement = (text: string): OwnerAdvertisement | undefined => parse(text, readAdvertisement)
