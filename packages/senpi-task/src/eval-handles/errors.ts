import type { EvalHandleErrorCode } from "@code-yeongyu/senpi"

// Mirrors senpi's EvalHandleError shape (code + "code: message"); a runtime import of senpi's class
// would put the engine barrel into every task child's boot graph (senpi-static-import-guard).
export class EvalHandleHostError extends Error {
  readonly name = "EvalHandleError"
  readonly code: EvalHandleErrorCode | "eval_handle_send_refused"
  readonly details?: unknown

  constructor(code: EvalHandleErrorCode | "eval_handle_send_refused", message: string, details?: unknown) {
    super(`${code}: ${message}`)
    this.code = code
    if (details !== undefined) this.details = details
  }
}
