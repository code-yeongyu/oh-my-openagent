export type IdleInjectionSource = "task-completion" | "team-message" | "team-liveness" | "boulder-continuation" | "ulw-continuation" | "dag-run" | "kibitzer"

export interface IdleInjection {
  // Dedupe/order key. Task completions key on their task id; the ulw continuation keys on its source
  // so repeated continuation enqueues on one idle edge collapse to a single injection.
  readonly key: string
  readonly source: IdleInjectionSource
  readonly customType?: string
  readonly content: string
  readonly display?: boolean
  /** Rides a flush that carries at least one non-passive entry; never causes a flush by itself. */
  readonly passive?: boolean
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
// wake on the same idle edge has already drained the queue. Returning a canceller lets retire() drop
// the armed batch-window timer instead of leaving a live handle behind (every sibling scheduler in
// this codebase - lead-poller-lifecycle, senpi-task's completion retry - does the same). The
// queueMicrotask default returns nothing, which is safe: retire() empties the queue, so a microtask
// that still fires has nothing left to deliver.
export type FlushScheduler = (flush: () => void) => (() => void) | void

export interface IdleInjectionCoordinatorOptions {
  readonly scheduleFlush?: FlushScheduler
}

/**
 * Handed to `onDeliveryFailed` for every injection still queued when the coordinator retires, and
 * thrown by producers whose `enqueue` was refused after retirement. It means the notification was
 * NOT delivered and the parent session that owned this queue is gone, so the producer must route it
 * to its own durable failure path (senpi-task rolls `notified_epoch` back and the post-reload
 * `session_start` reconcile redelivers).
 */
export class IdleInjectionRetiredError extends Error {
  constructor(message = "idle-injection coordinator retired on session shutdown; injection not delivered") {
    super(message)
    this.name = "IdleInjectionRetiredError"
  }
}

// Deterministic order: task completions are announced first and DAG run summaries last, so a mixed
// flush leads with the most immediate child completion context.
const SOURCE_RANK: Readonly<Record<IdleInjectionSource, number>> = {
  "task-completion": 0,
  "team-message": 1,
  "team-liveness": 2,
  "boulder-continuation": 3,
  "ulw-continuation": 4,
  "dag-run": 5,
  kibitzer: 6,
}

/**
 * The single injection queue for the parent session. EVERY delivered notification (task completions,
 * team lead-messages, DAG run summaries, the ulw-loop continuation) enqueues here; a deferred flush collapses everything
 * that became ready within the batch window into exactly ONE injection, steered into the running turn
 * at the next tool-call boundary (unconditional batched-steer contract: N ready notifications never
 * produce N separate injections). comment-checker's tool_result transform is intentionally NOT routed
 * here.
 *
 * Receipts are a contract, not a courtesy. An ACCEPTED injection (`enqueue` returned true) always
 * gets exactly one receipt: `onFlushed` once delivery succeeded, or `onDeliveryFailed` when the
 * delivery throws/rejects OR when `retire()` drops the batch window. A REFUSED injection (`enqueue`
 * returned false, i.e. the coordinator is already retired) gets NO receipt, because ownership never
 * transferred - the producer sees the refusal synchronously and handles it there. Nothing is ever
 * dropped silently: a completion that is not delivered is always reported back to its producer.
 */
export class IdleInjectionCoordinator {
  readonly #deliver: IdleInjectionDelivery
  readonly #pending = new Map<string, IdleInjection>()
  readonly #scheduleFlush: FlushScheduler
  #flushScheduled = false
  #soonScheduled = false
  #retired = false
  #cancelScheduledFlush: (() => void) | undefined

  constructor(deliver: IdleInjectionDelivery, options: IdleInjectionCoordinatorOptions = {}) {
    this.#deliver = deliver
    this.#scheduleFlush = options.scheduleFlush ?? ((flush) => queueMicrotask(flush))
  }

  /**
   * Accept an injection into the batch window. Returns false when the coordinator is retired: the
   * queue is gone, the injection is NOT queued and gets no receipt, so the caller still owns the
   * notification and must fail it durably (a silent success is what makes senpi-task persist
   * `notified_epoch` and makes the post-reload reconcile skip the record forever).
   */
  enqueue(injection: IdleInjection): boolean {
    if (this.#retired) return false
    this.#pending.set(injection.key, injection)
    return true
  }

  // Streaming-safe producers enqueue then request a batched steer at the next tool-call boundary.
  // Repeated requests before the deferred pass runs coalesce to a single flush. Retired: arming a new
  // batch-window timer for a dead session would only leave a live handle behind.
  scheduleFlush(): void {
    if (this.#retired || this.#flushScheduled) return
    this.#flushScheduled = true
    this.#cancelScheduledFlush = this.#scheduleFlush(() => {
      this.#flushScheduled = false
      this.#cancelScheduledFlush = undefined
      this.#flush("steer")
    }) ?? undefined
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

  /**
   * Called from session_shutdown, which senpi emits on the OLD extension runner before invalidating
   * its generation. Retirement is the SINGLE mechanism that makes every armed callback harmless: the
   * armed batch-window timer is cancelled, the queue is emptied, and `enqueue` refuses from here on,
   * so no flush can ever reach the stale generation's `pi.sendMessage` (issue #7932) - the flush path
   * itself needs no retirement guard, because it can only ever see an empty queue.
   *
   * The queue is a batching window, not a durable store, so its entries cannot be carried over. They
   * are handed BACK instead of dropped: every accepted injection gets its `onDeliveryFailed` receipt,
   * which is what routes a background-task completion to senpi-task's failure bookkeeping (and from
   * there to the post-reload `session_start` reconcile) rather than losing it forever.
   */
  retire(): void {
    this.#retired = true
    const cancelScheduledFlush = this.#cancelScheduledFlush
    this.#cancelScheduledFlush = undefined
    cancelScheduledFlush?.()
    const dropped = [...this.#pending.values()]
    this.#pending.clear()
    for (const injection of dropped) injection.onDeliveryFailed?.(new IdleInjectionRetiredError())
  }

  // Flush the whole queue as one idle-edge steer. Returns how many queued items were collapsed (0 = no-op).
  flushOnIdle(): number {
    return this.#flush("steer")
  }

  #flush(deliverAs: "steer" | "followUp"): number {
    if (this.#pending.size === 0) return 0
    if ([...this.#pending.values()].every((injection) => injection.passive === true)) return 0
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
