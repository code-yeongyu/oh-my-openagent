import type { RunnerFailure } from "./child-handle"

export class RunnerError extends Error {
  readonly #brand = true
  readonly failure: RunnerFailure

  constructor(failure: RunnerFailure) {
    super(failure.message, failure.cause === undefined ? undefined : { cause: failure.cause })
    this.name = "RunnerError"
    this.failure = failure
  }

  static is(value: unknown): value is RunnerError {
    try {
      return typeof value === "object" && value !== null && #brand in value
    } catch {
      return false
    }
  }
}
