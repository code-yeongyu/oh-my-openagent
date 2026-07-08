export type IdleInjectionSource = "task-completion" | "team-message" | "ulw-continuation"

export interface IdleInjection {
  // Dedupe/order key. Task completions key on their task id; the ulw continuation keys on its source
  // so repeated continuation enqueues on one idle edge collapse to a single injection.
  readonly key: string
  readonly source: IdleInjectionSource
  readonly content: string
}

export type IdleInjectionDelivery = (content: string, options: { deliverAs: "steer" | "followUp" }) => void

// Defers a single flush to the next idle tick. Injectable so unit tests drive it deterministically;
// production defaults to queueMicrotask so a deferred continuation flush runs after any synchronous
// wake on the same idle edge has already drained the queue.
export type FlushScheduler = (flush: () => void) => void

export interface IdleInjectionCoordinatorOptions {
  readonly scheduleFlush?: FlushScheduler
}

// Deterministic order: task completions are announced before the ulw-loop continuation nudge so the
// parent sees "what finished" before "keep going".
const SOURCE_RANK: Readonly<Record<IdleInjectionSource, number>> = {
  "task-completion": 0,
  "team-message": 1,
  "ulw-continuation": 2,
}

/**
 * The single injection queue for one idle edge. Task completion wakes and the ulw-loop continuation
 * both enqueue here; flushOnIdle collapses everything pending into exactly ONE sendUserMessage so the
 * parent never receives two competing wakes on the same idle edge (the Oracle arbitration blocker).
 * comment-checker's tool_result transform is intentionally NOT routed here.
 */
export class IdleInjectionCoordinator {
  readonly #deliver: IdleInjectionDelivery
  readonly #pending = new Map<string, IdleInjection>()
  readonly #scheduleFlush: FlushScheduler
  #flushScheduled = false

  constructor(deliver: IdleInjectionDelivery, options: IdleInjectionCoordinatorOptions = {}) {
    this.#deliver = deliver
    this.#scheduleFlush = options.scheduleFlush ?? ((flush) => queueMicrotask(flush))
  }

  enqueue(injection: IdleInjection): void {
    this.#pending.set(injection.key, injection)
  }

  // Producers that do not need synchronous delivery (the ulw-loop continuation) enqueue then request a
  // deferred flush. A synchronous wake flushOnIdle on the same tick drains the queue first, so the
  // deferred pass finds it empty and no-ops - collapsing wake+continuation into one injection. Repeated
  // requests before the deferred pass runs coalesce to a single flush.
  scheduleFlush(): void {
    if (this.#flushScheduled) return
    this.#flushScheduled = true
    this.#scheduleFlush(() => {
      this.#flushScheduled = false
      this.flushOnIdle()
    })
  }

  pendingCount(): number {
    return this.#pending.size
  }

  // Flush the whole queue as one injection. Returns how many queued items were collapsed (0 = no-op).
  flushOnIdle(): number {
    if (this.#pending.size === 0) return 0
    const ordered = [...this.#pending.values()].sort(
      (left, right) => SOURCE_RANK[left.source] - SOURCE_RANK[right.source],
    )
    const collapsed = ordered.length
    this.#pending.clear()
    this.#deliver(ordered.map((injection) => injection.content).join("\n\n"), { deliverAs: "followUp" })
    return collapsed
  }
}
