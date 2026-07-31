export type IdleInjectionSource = "task-completion" | "team-message" | "team-liveness" | "boulder-continuation" | "ulw-continuation"

export interface IdleInjection {
  // Dedupe/order key. Task completions key on their task id; the ulw continuation keys on its source
  // so repeated continuation enqueues on one idle edge collapse to a single injection.
  readonly key: string
  readonly source: IdleInjectionSource
  readonly customType?: string
  readonly content: string
  readonly display?: boolean
  readonly details?: unknown
  readonly onFlushed?: () => void
  readonly onDeliveryFailed?: (error: unknown) => void
}

export interface IdleInjectionMessage extends Record<string, unknown> {
  readonly customType: "omo-senpi:wake"
  readonly content: string
  readonly display: false
  readonly details: ReadonlyArray<{ readonly customType: string; readonly details: unknown }>
}

export type IdleInjectionDelivery = (
  message: IdleInjectionMessage,
  options: { deliverAs: "steer" | "followUp" },
) => unknown

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
  "team-liveness": 2,
  "boulder-continuation": 3,
  "ulw-continuation": 4,
}

/**
 * The single injection queue for the parent session. EVERY delivered notification (task completions,
 * team lead-messages, the ulw-loop continuation) enqueues here; a deferred flush collapses everything
 * that became ready within the batch window into exactly ONE injection, steered into the running turn
 * at the next tool-call boundary (unconditional batched-steer contract: N ready notifications never
 * produce N separate injections). comment-checker's tool_result transform is intentionally NOT routed
 * here.
 */
export class IdleInjectionCoordinator {
  readonly #deliver: IdleInjectionDelivery
  readonly #pending = new Map<string, IdleInjection>()
  readonly #scheduleFlush: FlushScheduler
  #flushScheduled = false
  #soonScheduled = false

  constructor(deliver: IdleInjectionDelivery, options: IdleInjectionCoordinatorOptions = {}) {
    this.#deliver = deliver
    this.#scheduleFlush = options.scheduleFlush ?? ((flush) => queueMicrotask(flush))
  }

  enqueue(injection: IdleInjection): void {
    this.#pending.set(injection.key, injection)
  }

  // Streaming-safe producers enqueue then request a batched steer at the next tool-call boundary.
  // Repeated requests before the deferred pass runs coalesce to a single flush.
  scheduleFlush(): void {
    if (this.#flushScheduled) return
    this.#flushScheduled = true
    this.#scheduleFlush(() => {
      this.#flushScheduled = false
      this.#flush("steer")
    })
  }

  // Immediate coalesced flush for an IDLE parent. A microtask is soon enough to land the steer before
  // senpi's print mode can decide the session is over (the windowed timer is not - live-driver proven),
  // while still batching every notification that becomes ready in the same tick into one injection.
  flushSoon(): void {
    if (this.#soonScheduled) return
    this.#soonScheduled = true
    queueMicrotask(() => {
      this.#soonScheduled = false
      this.flushOnIdle()
    })
  }

  pendingCount(): number {
    return this.#pending.size
  }

  remove(key: string): boolean {
    return this.#pending.delete(key)
  }

  // Flush the whole queue as one idle-edge steer. Returns how many queued items were collapsed (0 = no-op).
  flushOnIdle(): number {
    return this.#flush("steer")
  }

  #flush(deliverAs: "steer" | "followUp"): number {
    if (this.#pending.size === 0) return 0
    const ordered = [...this.#pending.values()].sort(
      (left, right) => SOURCE_RANK[left.source] - SOURCE_RANK[right.source],
    )
    const collapsed = ordered.length
    this.#pending.clear()
    let delivery: unknown
    try {
      delivery = this.#deliver(
        {
          customType: "omo-senpi:wake",
          content: ordered.map((injection) => injection.content).join("\n\n"),
          display: false,
          details: ordered.flatMap((injection) =>
            injection.customType === undefined
              ? []
              : [{ customType: injection.customType, details: injection.details }],
          ),
        },
        { deliverAs },
      )
    } catch (error) {
      for (const injection of ordered) injection.onDeliveryFailed?.(error)
      throw error
    }
    if (!isPromiseLike(delivery)) {
      for (const injection of ordered) injection.onFlushed?.()
    } else {
      void delivery.then(
        () => {
          for (const injection of ordered) injection.onFlushed?.()
        },
        (error: unknown) => {
          for (const injection of ordered) injection.onDeliveryFailed?.(error)
        },
      )
    }
    return collapsed
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function"
}
