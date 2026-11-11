import { ERROR_CODES, type ErrorCode, STANDARD_RPC_ERRORS } from "@oh-my-opencode/senpi-desktop-protocol"
import type { Disposition, WindowSummary } from "./types"
import { isRecord, parseDisposition, type Tier } from "./validate"

/** The machine-readable side of a `ComputerError`: the engine's error data plus what the SDK adds. */
export interface ErrorData {
  /** Machine-readable cause, an open token set per code (`ambiguous`, `consumed`, `identity_changed`). */
  readonly reason: string | null
  readonly hint: string | null
  /** The matching windows when a selector named more than one. */
  readonly candidates?: readonly WindowSummary[]
  /** The engine's error data, verbatim, for fields this SDK version does not model. */
  readonly engine?: Readonly<Record<string, unknown>>
}

const NOT_DELIVERED: Disposition = { delivery: "not_delivered", retry: "safe" }
const UNKNOWN: Disposition = { delivery: "unknown", retry: "unknown" }

export interface ComputerErrorInit {
  readonly disposition?: Disposition
  readonly reason?: string | null
  readonly hint?: string | null
  readonly candidates?: readonly WindowSummary[]
  readonly engine?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

/**
 * Every facade failure. `nothingSent` is `true` exactly when `disposition.delivery` is `not_delivered`: the
 * request was refused or never left, so no input reached the target. The SDK never retries on its own.
 */
export class ComputerError extends Error {
  readonly code: ErrorCode
  readonly disposition: Disposition
  readonly data: ErrorData
  readonly nothingSent: boolean

  constructor(code: ErrorCode, message: string, init: ComputerErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = "ComputerError"
    this.code = code
    this.disposition = init.disposition ?? UNKNOWN
    this.nothingSent = this.disposition.delivery === "not_delivered"
    this.data = {
      reason: init.reason ?? null,
      hint: init.hint ?? null,
      ...(init.candidates === undefined ? {} : { candidates: init.candidates }),
      ...(init.engine === undefined ? {} : { engine: init.engine }),
    }
  }
}

const ERROR_CODE_SET: ReadonlySet<unknown> = new Set(ERROR_CODES)
const isErrorCode = (value: unknown): value is ErrorCode => ERROR_CODE_SET.has(value)
const text = (value: unknown): string | null => (typeof value === "string" ? value : null)

/** A refusal raised by the SDK itself before anything reached the port. */
export function refusal(
  code: ErrorCode,
  message: string,
  reason: string,
  extra: ComputerErrorInit = {},
): ComputerError {
  return new ComputerError(code, message, { ...extra, reason, disposition: extra.disposition ?? NOT_DELIVERED })
}

/** A reply that failed boundary validation: the request was sent, so an exec may have acted. */
export function malformed(method: string, tier: Tier, value: unknown): ComputerError {
  const shown = JSON.stringify(value)?.slice(0, 200) ?? String(value)
  return new ComputerError("Internal", `desktop engine sent a malformed ${method} result: ${shown}`, {
    reason: "malformed_result",
    disposition: tier === "read" ? NOT_DELIVERED : UNKNOWN,
  })
}

/**
 * Maps an `RpcPortFailure` to a `ComputerError`. The engine's own `data.disposition` wins; without one (an engine
 * that predates it), a read sent no input, and an exec's outcome is unknown unless the port proved nothing left.
 */
export function fromPortFailure(method: string, tier: Tier, failure: unknown): ComputerError {
  if (failure instanceof ComputerError) return failure
  const record = isRecord(failure) ? failure : {}
  const message = text(record.message) ?? `${method} failed: ${String(failure)}`
  const fallback = tier === "read" || record.nothingSent === true ? NOT_DELIVERED : UNKNOWN
  const data = isRecord(record.data) ? record.data : undefined
  if (data !== undefined && isErrorCode(data.code)) {
    return new ComputerError(data.code, message, {
      disposition: parseDisposition(data.disposition) ?? fallback,
      reason: text(data.reason),
      hint: text(data.hint),
      engine: data,
      cause: failure,
    })
  }
  if (record.rpcCode === STANDARD_RPC_ERRORS.methodNotFound) {
    const reason = data === undefined ? "unknown" : (text(data.reason) ?? "unknown")
    return new ComputerError("Internal", message, {
      disposition: NOT_DELIVERED,
      reason: `method_${reason}`,
      ...(data === undefined ? {} : { engine: data }),
      cause: failure,
    })
  }
  const code = isErrorCode(record.code) ? record.code : "Internal"
  return new ComputerError(code, message, { disposition: fallback, cause: failure })
}
