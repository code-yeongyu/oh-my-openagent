import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import * as z from "zod"

/**
 * The wire boundary of one host session: what arrives on the connection is parsed into typed
 * records here, and what the host refuses an `open_session` with is parsed into typed errors.
 * Nothing downstream of this module inspects a raw frame.
 */

/** The session path is held by another owner (typically a draining generation after a handoff). */
export class SessionHeldElsewhereError extends Error {
  override readonly name = "SessionHeldElsewhereError"
  readonly code = "session_path_in_use"
  readonly sessionPath: string
  readonly owner: string | undefined
  readonly retryAfterMs: number | undefined

  constructor(sessionPath: string, hold: { readonly owner?: string; readonly retryAfterMs?: number }, detail: string) {
    super(`session ${sessionPath} is held by ${hold.owner ?? "another owner"}: ${detail}`)
    this.sessionPath = sessionPath
    this.owner = hold.owner
    this.retryAfterMs = hold.retryAfterMs
  }
}

/** Any other typed refusal of `open_session` (`invalid_launch_profile`, `open_failed`, ...). */
export class HostSessionOpenError extends Error {
  override readonly name = "HostSessionOpenError"
  readonly code: string
  readonly sessionPath: string
  /** The host's retry hint (`errorData.retry_after_ms`) when the refusal is temporary. */
  readonly retryAfterMs: number | undefined

  constructor(code: string, sessionPath: string, detail: string, retryAfterMs?: number) {
    super(`open_session for ${sessionPath} was refused (${code}): ${detail}`)
    this.code = code
    this.sessionPath = sessionPath
    this.retryAfterMs = retryAfterMs
  }
}

/** A session command was issued with no live transport (detached, parked, closed or lost). */
export class HostSessionDetachedError extends Error {
  override readonly name = "HostSessionDetachedError"
  readonly code = "session_detached"

  constructor(operation: string) {
    super(`the host session holds no connection (${operation})`)
  }
}

const uiRequestSchema = z.object({
  type: z.literal("extension_ui_request"),
  id: z.string().min(1),
  method: z.string().min(1),
})

const parkedSchema = z.object({
  type: z.literal("session_parked"),
  sessionId: z.string().min(1),
  sessionPath: z.string().min(1),
})

const closedSchema = z.object({
  type: z.literal("session_closed"),
  sessionId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
})

const controlRecordSchema = z.discriminatedUnion("type", [uiRequestSchema, parkedSchema, closedSchema])

/** A frame the session client itself acts on, as opposed to an agent event it fans out. */
export type HostControlRecord = z.infer<typeof controlRecordSchema>

export function parseControlRecord(record: unknown): HostControlRecord | undefined {
  const parsed = controlRecordSchema.safeParse(record)
  return parsed.success ? parsed.data : undefined
}

/**
 * Routing filter for one session's connection: a frame tagged with another routing handle belongs
 * to a different child and is dropped. Untagged frames (connection-level records) always pass.
 */
export function isRoutedTo(record: unknown, sessionId: string | undefined): boolean {
  if (typeof record !== "object" || record === null || !("sessionId" in record)) return true
  const tag = record.sessionId
  return typeof tag !== "string" || tag === sessionId
}

/**
 * Every non-control frame the host tags for this session is an agent session event; the engine owns
 * that union and the host is its only producer, so the tag check IS the boundary parse.
 */
export function isAgentSessionEvent(record: unknown): record is AgentSessionEvent {
  return typeof record === "object" && record !== null && "type" in record && typeof record.type === "string"
}

/**
 * Convert an `open_session` rejection into omo's typed refusals. Codes ride the response `error`
 * field by contract (`<code>: <detail>`) and the typed `errorCode`/`errorData` fields when the host
 * is new enough; anything that carries no code (a transport loss, a write failure) is handed back
 * untouched so the caller sees the original failure.
 */
export function toOpenFailure(error: unknown, sessionPath: string): unknown {
  if (!(error instanceof Error)) return error
  const code = readErrorCode(error)
  if (code === undefined) return error
  if (code === "session_path_in_use") return new SessionHeldElsewhereError(sessionPath, readHold(error), error.message)
  return new HostSessionOpenError(code, sessionPath, error.message, readHold(error).retryAfterMs)
}

const ERROR_CODE = /^[a-z][a-z0-9_]*$/

function readErrorCode(error: Error): string | undefined {
  if ("errorCode" in error && typeof error.errorCode === "string" && ERROR_CODE.test(error.errorCode)) {
    return error.errorCode
  }
  const token = error.message.split(":")[0]?.trim() ?? ""
  return ERROR_CODE.test(token) ? token : undefined
}

function readHold(error: Error): { readonly owner?: string; readonly retryAfterMs?: number } {
  if (!("errorData" in error)) return {}
  const data = error.errorData
  if (typeof data !== "object" || data === null) return {}
  const owner = "owner" in data && typeof data.owner === "string" ? data.owner : undefined
  const retryAfterMs = "retry_after_ms" in data && typeof data.retry_after_ms === "number" ? data.retry_after_ms : undefined
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }
}
