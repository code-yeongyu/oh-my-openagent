import { randomUUID } from "node:crypto"
import type { RunRef } from "../../../senpi-task/src/pause/ports"
import { admissionBatches, failItems, settleItemReceipts, withSuperseded, type AdmissionItem, type ItemReceipt, type QueuedInjection } from "./idle-injection-items"
import { NO_RECEIPT_ERRORS, type ReceiptErrors } from "./idle-injection-receipts"

export type IdleInjectionSource = "task-completion" | "workpool-aggregate" | "team-message" | "team-liveness" | "boulder-continuation" | "ulw-continuation" | "dag-run" | "kibitzer"

export interface IdleInjection {
  // Cancellation/order key; every enqueue retains its independent custody identity.
  readonly key: string
  readonly itemId?: string
  readonly runRef?: RunRef
  readonly source: IdleInjectionSource
  readonly customType?: string
  readonly content: string
  readonly display?: boolean
  /** Rides a flush that carries at least one non-passive entry; never causes a flush by itself. */
  readonly passive?: boolean
  readonly details?: unknown
  /** Preserve this segment's boundary for model-specific context transforms. */
  readonly contextScoped?: boolean
  readonly onFlushed?: () => void
  readonly onHeld?: (receipt: ItemReceipt) => void
  readonly onDeliveryFailed?: (error: unknown) => void
}

export interface IdleInjectionMessage extends Record<string, unknown> {
  readonly customType: "omo-senpi:wake"
  readonly content: string
  readonly display: false
  readonly details: ReadonlyArray<{ readonly customType: string; readonly details: unknown; readonly contentRange?: readonly [number, number] }>
}

export type IdleInjectionDelivery = (
  message: IdleInjectionMessage,
  options: { deliverAs: "steer" | "followUp"; readonly items: readonly AdmissionItem[] },
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
  /** Called with each new count of child results queued or still in delivery (#10782). */
  readonly onChildWorkChange?: (count: number) => void
  /** Receives every producer receipt error that is not rethrown to the caller. */
  readonly onReceiptError?: (error: unknown) => void
}

// Sources that carry a child's result to its parent: until they are delivered, the parent still owes
// that work, so the engine must not read it as done. Continuations and nudges are the parent's own.
const CHILD_WORK_SOURCES: ReadonlySet<IdleInjectionSource> = new Set(["task-completion", "workpool-aggregate", "team-message", "dag-run"])

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
  "workpool-aggregate": 0,
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
  readonly #pending = new Map<string, QueuedInjection>()
  readonly #scheduleFlush: FlushScheduler
  #flushScheduled = false
  #soonScheduled = false
  #retired = false
  #cancelScheduledFlush: (() => void) | undefined
  readonly #onChildWorkChange: ((count: number) => void) | undefined
  readonly #onReceiptError: ((error: unknown) => void) | undefined
  #childrenInDelivery = 0
  #reportedChildWork = 0

  constructor(deliver: IdleInjectionDelivery, options: IdleInjectionCoordinatorOptions = {}) {
    this.#deliver = deliver
    this.#scheduleFlush = options.scheduleFlush ?? ((flush) => queueMicrotask(flush))
    this.#onChildWorkChange = options.onChildWorkChange
    this.#onReceiptError = options.onReceiptError
  }

  #reportChildWork(): void {
    let count = this.#childrenInDelivery
    for (const injection of this.#pending.values()) if (CHILD_WORK_SOURCES.has(injection.source)) count++
    if (count === this.#reportedChildWork) return
    this.#reportedChildWork = count
    this.#onChildWorkChange?.(count)
  }

  /**
   * Accept an injection into the batch window. Returns false when the coordinator is retired: the
   * queue is gone, the injection is NOT queued and gets no receipt, so the caller still owns the
   * notification and must fail it durably (a silent success is what makes senpi-task persist
   * `notified_epoch` and makes the post-reload reconcile skip the record forever).
   */
  enqueue(injection: IdleInjection): boolean {
    if (this.#retired) return false
    const itemId = injection.itemId ?? randomUUID()
    const prior = this.#pending.get(injection.key)
    const superseded = prior === undefined ? [] : withSuperseded(prior)
    this.#pending.set(injection.key, { ...injection, itemId, superseded, get content() { return injection.content } })
    this.#reportChildWork()
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

  /** The child work count last reported (queued plus in delivery). */
  childWorkCount(): number {
    return this.#reportedChildWork
  }

  pendingCount(): number {
    return this.#pending.size
  }

  remove(key: string): boolean {
    const removed = this.#pending.delete(key)
    this.#reportChildWork()
    return removed
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
    this.#reportChildWork()
    const errors = failItems(dropped, new IdleInjectionRetiredError())
    this.#reportReceiptErrors(errors.rest)
    if (errors.threw) throw errors.first
  }

  // Each report is isolated: a reporter that throws must not drop the errors after it, replace a delivery error the
  // caller needs, or become an unhandled rejection on the async path. Its own failure goes to the console.
  #reportReceiptErrors(errors: readonly unknown[]): void {
    for (const error of errors) {
      try {
        this.#onReceiptError?.(error)
      } catch (reporterError) {
        console.error("[omo-senpi] onReceiptError threw while reporting a receipt error", { receiptError: error, reporterError })
      }
    }
  }

  #reportAllReceiptErrors(errors: ReceiptErrors): void {
    if (errors.threw) this.#reportReceiptErrors([errors.first, ...errors.rest])
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
    for (const batch of admissionBatches(ordered)) this.#deliverBatch(batch, deliverAs)
    return collapsed
  }

  #deliverBatch(batch: ReturnType<typeof admissionBatches>[number], deliverAs: "steer" | "followUp"): void {
    const children = batch.injections.filter((injection) => CHILD_WORK_SOURCES.has(injection.source)).length
    // Every producer gets its receipt even when an earlier one throws, and the count settles after all of them.
    // It happens once per batch: a thenable that calls back and then throws, or calls both callbacks, must not
    // hand out a second set of receipts or settle the count twice.
    let settled = false
    const receiptsThenSettle = (receipts: () => ReceiptErrors): ReceiptErrors => {
      if (settled) return NO_RECEIPT_ERRORS
      settled = true
      try {
        return receipts()
      } finally {
        this.#childrenInDelivery -= children
        this.#reportChildWork()
      }
    }
    this.#childrenInDelivery += children
    let delivery: unknown
    try {
      delivery = this.#deliver(batch.message, { deliverAs, items: batch.items })
    } catch (error) {
      // Receipts first: the count is a report, and nothing about reporting may cost a producer its receipt.
      // The delivery error is the one the caller needs, so a receipt that throws does not replace it.
      this.#reportAllReceiptErrors(receiptsThenSettle(() => failItems(batch.injections, error)))
      throw error
    }
    if (!isPromiseLike(delivery)) {
      const errors = receiptsThenSettle(() => settleItemReceipts(batch.injections, delivery))
      this.#reportReceiptErrors(errors.rest)
      if (errors.threw) throw errors.first
      return
    }
    // Nothing awaits this chain, so every receipt error here goes to onReceiptError instead of becoming an
    // unhandled rejection.
    try {
      void delivery.then(
        (result) => this.#reportAllReceiptErrors(receiptsThenSettle(() => settleItemReceipts(batch.injections, result))),
        (error: unknown) => this.#reportAllReceiptErrors(receiptsThenSettle(() => failItems(batch.injections, error))),
      )
    } catch (error) {
      // A thenable whose then() throws never settles: treat it as a failed delivery so receipts and the count
      // still settle.
      this.#reportAllReceiptErrors(receiptsThenSettle(() => failItems(batch.injections, error)))
      throw error
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function"
}
