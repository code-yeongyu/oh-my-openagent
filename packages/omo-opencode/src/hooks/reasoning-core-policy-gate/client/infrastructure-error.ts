export type InfrastructureErrorKind =
  | "spawn"
  | "timeout"
  | "init"
  | "rpc"
  | "empty"
  | "invalid_json"
  | "network"
  | "unknown"

export class ReasoningCoreInfrastructureError extends Error {
  readonly kind: InfrastructureErrorKind
  readonly cause?: unknown

  constructor(kind: InfrastructureErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = "ReasoningCoreInfrastructureError"
    this.kind = kind
    this.cause = cause
  }
}

const INFRASTRUCTURE_MESSAGE_PATTERNS = [
  "ENOENT",
  "not found",
  "timed out",
  "initialize failed",
  "call failed",
  "exited before responding",
  "invalid json",
  "empty response",
  "non-json response",
]

export function isReasoningCoreInfrastructureError(reason: string | undefined): boolean {
  if (reason == null) return false
  const normalized = reason.toLowerCase()
  return INFRASTRUCTURE_MESSAGE_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()))
}
