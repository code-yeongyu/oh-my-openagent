export type BeadsRuntimeErrorCode =
  | "beads_runtime_disabled"
  | "beads_runtime_capability_missing"
  | "beads_runtime_contract_violation"
  | "beads_runtime_attach_rejected"

export class BeadsRuntimeError extends Error {
  readonly code: BeadsRuntimeErrorCode
  readonly details?: Record<string, unknown>

  constructor(input: {
    code: BeadsRuntimeErrorCode
    message: string
    details?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = "BeadsRuntimeError"
    this.code = input.code
    this.details = input.details
  }
}

export function createBeadsRuntimeDisabledError(
  message: string,
  details?: Record<string, unknown>,
): BeadsRuntimeError {
  return new BeadsRuntimeError({
    code: "beads_runtime_disabled",
    message,
    details,
  })
}

export function createBeadsRuntimeCapabilityError(input: {
  message: string
  details?: Record<string, unknown>
}): BeadsRuntimeError {
  return new BeadsRuntimeError({
    code: "beads_runtime_capability_missing",
    message: input.message,
    details: input.details,
  })
}

export function createBeadsRuntimeContractError(input: {
  message: string
  details?: Record<string, unknown>
}): BeadsRuntimeError {
  return new BeadsRuntimeError({
    code: "beads_runtime_contract_violation",
    message: input.message,
    details: input.details,
  })
}

export function createBeadsRuntimeAttachError(input: {
  message: string
  details?: Record<string, unknown>
}): BeadsRuntimeError {
  return new BeadsRuntimeError({
    code: "beads_runtime_attach_rejected",
    message: input.message,
    details: input.details,
  })
}
