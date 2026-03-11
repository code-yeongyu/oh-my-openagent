export const ATHENA_NON_INTERACTIVE_MODES = ["delegation", "solo"] as const

export type AthenaNonInteractiveMode = (typeof ATHENA_NON_INTERACTIVE_MODES)[number]
export type AthenaNonInteractiveMembers = "all" | "custom"

export interface AthenaNonInteractiveConfig {
  non_interactive_mode?: AthenaNonInteractiveMode
  non_interactive_members?: AthenaNonInteractiveMembers
  non_interactive_member_list?: string[]
}

type FailureType = "network_error" | "timeout_error" | "validation_error" | "quorum_error"

type FailureMetadata<TType extends FailureType> = {
  type: TType
  failure_type: TType
}

export type NetworkError = FailureMetadata<"network_error"> & {
  message: string
  retryable: boolean
}

export type TimeoutError = FailureMetadata<"timeout_error"> & {
  duration: number
  threshold: number
}

export type ValidationError = FailureMetadata<"validation_error"> & {
  field: string
  value: unknown
}

export type QuorumError = FailureMetadata<"quorum_error"> & {
  responses: number
  required: number
}

export type CouncilFailure =
  | NetworkError
  | TimeoutError
  | ValidationError
  | QuorumError

const COUNCIL_FAILURE_EXAMPLES: readonly CouncilFailure[] = [
  {
    type: "network_error",
    failure_type: "network_error",
    message: "Provider request failed",
    retryable: true,
  },
  {
    type: "timeout_error",
    failure_type: "timeout_error",
    duration: 1801,
    threshold: 1800,
  },
  {
    type: "validation_error",
    failure_type: "validation_error",
    field: "non_interactive_mode",
    value: "invalid",
  },
  {
    type: "quorum_error",
    failure_type: "quorum_error",
    responses: 1,
    required: 2,
  },
]

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`)
}

function formatModeValidation(mode: AthenaNonInteractiveMode): string {
  switch (mode) {
    case "delegation":
      return '- "delegation" -> mode: "delegation"'
    case "solo":
      return '- "solo" -> mode: "solo"'
    default:
      return assertNever(mode, "Unhandled Athena non-interactive mode")
  }
}

function formatFailureMetadataExample(failure: CouncilFailure): string {
  switch (failure.type) {
    case "network_error":
      return `- ${JSON.stringify(failure)}`
    case "timeout_error":
      return `- ${JSON.stringify(failure)}`
    case "validation_error":
      return `- ${JSON.stringify(failure)}`
    case "quorum_error":
      return `- ${JSON.stringify(failure)}`
    default:
      return assertNever(failure, "Unhandled Athena council failure metadata example")
  }
}

export function describeCouncilFailure(failure: CouncilFailure): string {
  switch (failure.type) {
    case "network_error":
      return `Network error: ${failure.message} (${failure.retryable ? "retryable" : "non-retryable"})`
    case "timeout_error":
      return `Timeout after ${failure.duration}s (threshold ${failure.threshold}s)`
    case "validation_error":
      return `Validation failed for ${failure.field}: ${JSON.stringify(failure.value)}`
    case "quorum_error":
      return `Council quorum failed: ${failure.responses}/${failure.required} valid responses`
    default:
      return assertNever(failure, "Unhandled Athena council failure")
  }
}

export function validateAthenaNonInteractiveMode(mode: string): AthenaNonInteractiveMode {
  switch (mode) {
    case "delegation":
      return mode
    case "solo":
      return mode
    default:
      throw new Error(`Invalid mode: ${mode}`)
  }
}

export function resolveAthenaNonInteractiveMode(mode: string | undefined): AthenaNonInteractiveMode {
  return validateAthenaNonInteractiveMode(mode ?? "delegation")
}

export function buildNonInteractiveModeValidationLines(): string {
  return ATHENA_NON_INTERACTIVE_MODES.map((candidateMode) => formatModeValidation(candidateMode)).join("\n")
}

export function buildCouncilFailureMetadataContract(): string {
  return COUNCIL_FAILURE_EXAMPLES.map((failure) => formatFailureMetadataExample(failure)).join("\n")
}
