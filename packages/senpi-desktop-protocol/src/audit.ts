import type { EngineMethod, ErrorCode } from "./engine-schema.generated"
import type { UnknownAuditValue } from "./wire"

/** Outcome of one audited desktop action. */
export type AuditStatus = "success" | "error" | "suspended"

/** The first failure of an audited action, as reported to the model. */
export interface AuditPrimaryError {
  readonly code: ErrorCode
  readonly message: string
}

/**
 * The host's record of one audited desktop action, returned with the tool result (`details.audit`): the engine
 * `AuditEvent` plus the session and the tool call it belongs to. The engine writes its own audit file line.
 */
export interface AuditRecord {
  /** ISO-8601 UTC timestamp. */
  readonly timestamp: string
  readonly sessionId: string
  /** The `computer` (or `computer_actions`) tool call whose request produced this record. */
  readonly toolCallId: string
  readonly action: EngineMethod | UnknownAuditValue
  readonly target: string
  /** `background`, `foreground`, or `control` (a `control.*` method's own record). */
  readonly delivery: string
  readonly frameId: string | null
  /** `null` when the action succeeded. */
  readonly code: ErrorCode | UnknownAuditValue | null
  readonly status: AuditStatus
  readonly primaryError?: AuditPrimaryError
  readonly durationMs: number
  readonly focusRestored?: boolean
  readonly screenshotPath?: string
  readonly screenshotWidth?: number
  readonly screenshotHeight?: number
  readonly textLength?: number
  /** First 16 hex digits of the typed text's SHA-256; the text itself is never audited. */
  readonly textSha256?: string
  readonly keys?: readonly string[]
  readonly message?: string
}
