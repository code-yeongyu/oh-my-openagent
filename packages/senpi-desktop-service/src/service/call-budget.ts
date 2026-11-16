/**
 * Desktop requests one `DesktopService` (one per agent session) may send through `call` unless the host sets its own;
 * only the user's `/computer off` resets the count, never the model's `close`.
 */
export const DEFAULT_CALL_BUDGET = 20_000

/** The typed refusal of a request past the session's call budget; nothing was sent to the engine. */
export class DesktopCallBudgetError extends Error {
  readonly reason = "CallBudgetExceeded"
  readonly limit: number

  constructor(limit: number) {
    super(`this session has used its budget of ${limit} desktop requests; no further request was sent`)
    this.name = "DesktopCallBudgetError"
    this.limit = limit
  }
}

export class CallBudget {
  readonly #limit: number
  #used = 0

  constructor(limit: number) {
    this.#limit = limit
  }

  reset(): void {
    this.#used = 0
  }

  admit(): void {
    if (this.#used >= this.#limit) throw new DesktopCallBudgetError(this.#limit)
    this.#used += 1
  }
}
