import type { ManagedChildHandle } from "./child-handle"

/**
 * A revival whose respawn delivered the continuation of an interrupted turn hands back a child whose record reads
 * `interrupted` once its reconcile notice lands, while the continued run is about to reopen it
 * (`reopenSelfResumedTurn`, under the next run_epoch). The revival is finished only when that is
 * decided: the continued run reopened the record, the turn ended without starting a run (a failed
 * delivery, a closed session), or this manager stopped following the handle. Until then, a reader
 * ordered after the revival - DAG recovery at session start - would fold a child that is about to
 * run as interrupted (#15125). Every wait ends on one of those signals; none is a timer.
 */
export class ContinuedRuns {
  readonly #reopening = new WeakSet<ManagedChildHandle>()
  readonly #decide = new Map<ManagedChildHandle, () => void>()
  readonly #following = new Map<string, Promise<void>>()

  follower(taskId: string, handle: ManagedChildHandle): (() => Promise<void>) | undefined {
    if (handle.continuationDelivered?.() !== true) return undefined
    return () => this.#follow(taskId, handle)
  }

  /** Settles when the revival that attached this task's live handle has decided its continued run. */
  settled(taskId: string): Promise<void> {
    return this.#following.get(taskId) ?? Promise.resolve()
  }

  reopening(handle: ManagedChildHandle, reopen: Promise<void>): Promise<void> {
    this.#reopening.add(handle)
    const decide = (): void => this.#decide.get(handle)?.()
    void reopen.then(decide, decide)
    return reopen
  }

  released(handle: ManagedChildHandle): void {
    this.#decide.get(handle)?.()
  }

  async #follow(taskId: string, handle: ManagedChildHandle): Promise<void> {
    const decided = Promise.withResolvers<void>()
    this.#decide.set(handle, decided.resolve)
    this.#following.set(taskId, decided.promise)
    // A run that starts always starts its reopen before its turn can end, so an outcome that lands
    // with no reopen in flight is a continuation that never ran.
    const ended = (): void => {
      if (!this.#reopening.has(handle)) decided.resolve()
    }
    void handle.waitForOutcome().then(ended, ended)
    try {
      await decided.promise
    } finally {
      this.#decide.delete(handle)
      if (this.#following.get(taskId) === decided.promise) this.#following.delete(taskId)
    }
  }
}
