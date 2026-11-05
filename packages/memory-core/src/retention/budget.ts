// One retention pass per identity is bounded by `pass_budget_ms` and by the abort signal (design 6,
// N3). Stores are walked in a fixed order and each in sorted name order, so the last item a pass
// finished is a complete resume point: the next pass skips every earlier store and every name up to
// and including `lastName` in the cursor's store. An item in flight always finishes.

export const RETENTION_STORES = ["runs", "completions", "reflection-sessions", "journals", "sidecars", "ledgers", "recall-runs"] as const
export type RetentionStore = (typeof RETENTION_STORES)[number]

export interface RetentionCursor {
  readonly store: string
  readonly lastName?: string
}

export class PassBudget {
  private readonly startedAt: number
  private last: RetentionCursor | undefined
  stopped: RetentionCursor | undefined
  aborted = false

  constructor(
    private readonly now: () => number,
    private readonly budgetMs: number,
    private readonly signal: AbortSignal | undefined,
    private readonly resume: RetentionCursor | undefined,
  ) {
    this.startedAt = now()
  }

  /** True when an earlier pass already finished this item (or its whole store). */
  skip(store: RetentionStore, name: string): boolean {
    if (this.resume === undefined) return false
    const resumeAt = RETENTION_STORES.indexOf(this.resume.store as RetentionStore)
    const here = RETENTION_STORES.indexOf(store)
    if (resumeAt < 0 || here > resumeAt) return false
    if (here < resumeAt) return true
    return this.resume.lastName !== undefined && name <= this.resume.lastName
  }

  /** False once the budget is spent or the pass was aborted; the cursor then points at the last finished item. */
  admit(store: RetentionStore): boolean {
    if (this.stopped !== undefined) return false
    const exhausted = this.signal?.aborted === true || this.now() - this.startedAt >= this.budgetMs
    if (!exhausted) return true
    this.aborted = this.signal?.aborted === true
    this.stopped = this.last ?? { store }
    return false
  }

  done(store: RetentionStore, name: string): void {
    this.last = { store, lastName: name }
  }
}
