export const FORMALIZATION_ERROR_CODES = [
  "provider_failure",
  "timeout",
  "schema_invalid",
  "theory_invalid",
  "missing_theory",
  "malformed_theory",
  "confirmation_required",
] as const

export type FormalizationErrorCode = typeof FORMALIZATION_ERROR_CODES[number]

export class FormalizationError extends Error {
  readonly code: FormalizationErrorCode
  readonly details?: unknown

  constructor(params: { code: FormalizationErrorCode; message?: string; details?: unknown }) {
    super(params.message ?? params.code)
    this.name = "FormalizationError"
    this.code = params.code
    this.details = params.details
  }
}
