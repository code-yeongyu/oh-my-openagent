// One retention pass per identity is bounded by `pass_budget_ms` and by the abort signal (design 6,
// N3). Stores are walked in a fixed order and each in sorted name order, so the last item a pass
// finished is a complete resume point: the next pass skips every earlier store and every name up to
// and including `lastName` in the cursor's store. An item in flight always finishes, and the first
// removal item a pass reaches always runs, so a store whose classification alone outlasts the budget
// still moves forward. Classification (`proceed`) is a metadata read: only the abort signal stops it.

// The size cap, which runs after these, keeps its own resume point beside this cursor (stamp.ts).
const RETENTION_STORES = ["runs", "completions", "reflection-sessions", "journals", "sidecars", "ledgers", "recall-runs"] as const
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
  private admittedAny = false

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
    if (!this.proceed(store)) return false
    if (this.admittedAny && this.now() - this.startedAt >= this.budgetMs) {
      this.stop(store)
      return false
    }
    this.admittedAny = true
    return true
  }

  /** False once the pass was aborted (or already stopped); the time budget never stops a classification read. */
  proceed(store: RetentionStore): boolean {
    if (this.stopped !== undefined) return false
    if (this.signal?.aborted !== true) return true
    this.aborted = true
    this.stop(store)
    return false
  }

  private stop(store: RetentionStore): void {
    // Nothing finished this pass: the resume point stands unless this store lies past it, so a stop
    // never moves the cursor back to an earlier store.
    if (this.last !== undefined) this.stopped = this.last
    else if (this.resume !== undefined && RETENTION_STORES.indexOf(this.resume.store as RetentionStore) >= RETENTION_STORES.indexOf(store)) this.stopped = this.resume
    else this.stopped = { store }
  }

  /** What is left of the budget; the size cap, which runs last, spends only this. */
  remainingMs(): number {
    return Math.max(0, this.budgetMs - (this.now() - this.startedAt))
  }

  done(store: RetentionStore, name: string): void {
    this.last = { store, lastName: name }
  }
}
