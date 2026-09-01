import { dagEventLane, dagStreamOverflowEvent } from "./events"
import type { DagFileStore } from "./store"
import {
  DAG_SETTINGS_DEFAULTS,
  type DagRunEvent,
  type DagRunEventPayload,
  type DagRunId,
} from "./types"

const REPLAY_PAGE_SIZE = 1000
const commitSubscribers = new WeakMap<DagFileStore, Map<DagRunId, Set<CommitSubscriber>>>()

export interface DagJournalCheckpoint {
  readonly schemaVersion: 1
  readonly checkpointSeq: number
}

export type DagJournalListener = (event: DagRunEvent) => void | Promise<void>

export type DagJournalOptions<TCheckpoint extends DagJournalCheckpoint> = {
  readonly store: DagFileStore
  readonly runId: DagRunId
  readonly initialCheckpoint: TCheckpoint
  readonly applyEvent: (checkpoint: TCheckpoint, event: DagRunEvent) => TCheckpoint
  readonly subscriberRing?: number
  readonly now?: () => number
  /** Evaluated against the freshly recovered checkpoint inside the run lock: returning true drops
   * the append as an idempotent duplicate - nothing is journaled and no subscriber is notified
   * (the dag_923ad20e completed->completed WAL class, #7412). */
  readonly skipDuplicate?: (checkpoint: TCheckpoint, payload: DagRunEventPayload) => boolean
}

export type DagJournal<TCheckpoint extends DagJournalCheckpoint> = {
  readonly append: (payload: DagRunEventPayload) => DagRunEvent | undefined
  readonly snapshot: () => TCheckpoint
  /** Re-recovers the durable checkpoint under the run lock, replacing this instance's cache: the
   * read path for state another journal instance committed (#7412). */
  readonly refresh: () => TCheckpoint
  readonly subscribe: (listener: DagJournalListener) => () => void
  readonly whenIdle: () => Promise<void>
}

type OverflowState = {
  droppedCount: number
  recoverAfterSeq: number
}

type Subscriber = {
  readonly listener: DagJournalListener
  readonly queue: DagRunEvent[]
  active: boolean
  running: boolean
  lastDeliveredSeq: number
  overflow?: OverflowState
  readonly commitOverflow: (overflow: OverflowState) => DagRunEvent | undefined
  drainPromise: Promise<void>
}

type CommitSubscriber = {
  readonly listener: DagJournalListener
  active: boolean
}

/** Process-local notification for durable commits, independent of a particular journal instance. */
export function subscribeDagJournal(
  store: DagFileStore,
  runId: DagRunId,
  listener: DagJournalListener,
): () => void {
  const storeSubscribers = commitSubscribers.get(store) ?? new Map<DagRunId, Set<CommitSubscriber>>()
  const runSubscribers = storeSubscribers.get(runId) ?? new Set<CommitSubscriber>()
  const subscriber: CommitSubscriber = { listener, active: true }
  runSubscribers.add(subscriber)
  storeSubscribers.set(runId, runSubscribers)
  commitSubscribers.set(store, storeSubscribers)
  return () => {
    subscriber.active = false
    runSubscribers.delete(subscriber)
    if (runSubscribers.size === 0) storeSubscribers.delete(runId)
    if (storeSubscribers.size === 0) commitSubscribers.delete(store)
  }
}

export function createDagJournal<TCheckpoint extends DagJournalCheckpoint>(
  options: DagJournalOptions<TCheckpoint>,
): DagJournal<TCheckpoint> {
  const ringSize = options.subscriberRing ?? DAG_SETTINGS_DEFAULTS.subscriber_ring
  if (!Number.isInteger(ringSize) || ringSize <= 0) {
    throw new Error("subscriber ring must be a positive integer")
  }
  const now = options.now ?? Date.now
  const subscribers = new Set<Subscriber>()
  let checkpoint = options.store.withRunLock(options.runId, () => recoverCheckpoint(options))

  const appendPayload = (payload: DagRunEventPayload, directSubscriber?: Subscriber): DagRunEvent | undefined => {
    let durableEvent: DagRunEvent | undefined
    let skipped = false
    checkpoint = options.store.withRunLock(options.runId, () => {
      const recovered = recoverCheckpoint(options)
      if (options.skipDuplicate?.(recovered, payload) === true) {
        skipped = true
        return recovered
      }
      const tailSeq = eventLogTailSeq(options.store, options.runId, recovered.checkpointSeq)
      const seq = Math.max(recovered.checkpointSeq, tailSeq) + 1
      const event: DagRunEvent = {
        ...payload,
        schemaVersion: 1,
        runId: options.runId,
        seq,
        at: new Date(now()).toISOString(),
        lane: dagEventLane(payload.type),
      }
      // Completed-node reducers synchronously stage result artifacts. Stage them before the WAL so
      // replay can rebuild metadata even if the process dies before checkpoint replacement.
      const prepared = event.type === "dag.node.transitioned" && event.to === "completed"
        ? options.applyEvent(recovered, event)
        : undefined
      options.store.appendEvent(event)
      const applied = prepared ?? options.applyEvent(recovered, event)
      const next = { ...applied, schemaVersion: 1, checkpointSeq: seq }
      options.store.writeCheckpoint(options.runId, next)
      durableEvent = event
      return next
    })
    const event = durableEvent
    if (event === undefined) {
      if (skipped) return undefined
      throw new Error("DAG journal mutation completed without an event")
    }
    for (const subscriber of subscribers) {
      if (subscriber !== directSubscriber) enqueue(subscriber, event, ringSize)
    }
    publishCommit(options.store, options.runId, event)
    return event
  }

  return {
    append: appendPayload,
    snapshot: () => checkpoint,
    refresh: () => {
      checkpoint = options.store.withRunLock(options.runId, () => recoverCheckpoint(options))
      return checkpoint
    },
    subscribe(listener) {
      const subscriber: Subscriber = {
        listener,
        queue: [],
        active: true,
        running: false,
        lastDeliveredSeq: checkpoint.checkpointSeq,
        commitOverflow: (overflow) => appendPayload(dagStreamOverflowEvent(overflow), subscriber),
        drainPromise: Promise.resolve(),
      }
      subscribers.add(subscriber)
      return () => {
        subscriber.active = false
        subscriber.queue.length = 0
        subscriber.overflow = undefined
        subscribers.delete(subscriber)
      }
    },
    whenIdle: async () => {
      await Promise.all([...subscribers].map((subscriber) => subscriber.drainPromise))
    },
  }
}

function publishCommit(store: DagFileStore, runId: DagRunId, event: DagRunEvent): void {
  for (const subscriber of commitSubscribers.get(store)?.get(runId) ?? []) {
    queueMicrotask(() => {
      if (subscriber.active) void deliver(subscriber.listener, event)
    })
  }
}

function recoverCheckpoint<TCheckpoint extends DagJournalCheckpoint>(
  options: DagJournalOptions<TCheckpoint>,
): TCheckpoint {
  let checkpoint = options.store.readCheckpoint<TCheckpoint>(options.runId) ?? options.initialCheckpoint
  let sinceSeq = checkpoint.checkpointSeq
  let replayed = false
  for (;;) {
    const page = options.store.readEvents(options.runId, sinceSeq, { limit: REPLAY_PAGE_SIZE })
    for (const event of page.events) {
      const applied = options.applyEvent(checkpoint, event)
      checkpoint = { ...applied, schemaVersion: 1, checkpointSeq: event.seq }
      replayed = true
    }
    if (!page.hasMore) break
    sinceSeq = page.nextSinceSeq
  }
  if (replayed) options.store.writeCheckpoint(options.runId, checkpoint)
  return checkpoint
}

function eventLogTailSeq(store: DagFileStore, runId: DagRunId, sinceSeq: number): number {
  return store.readEvents(runId, sinceSeq, { limit: 1 }).headSeq
}

function enqueue(
  subscriber: Subscriber,
  event: DagRunEvent,
  ringSize: number,
): void {
  if (!subscriber.active) return
  if (subscriber.queue.length >= ringSize) {
    const dropped = subscriber.queue.shift()
    if (dropped !== undefined) {
      if (subscriber.overflow === undefined) {
        subscriber.overflow = {
          droppedCount: 1,
          recoverAfterSeq: subscriber.lastDeliveredSeq,
        }
      } else {
        subscriber.overflow.droppedCount += 1
      }
    }
  }
  subscriber.queue.push(event)
  if (!subscriber.running) scheduleDrain(subscriber)
}

function scheduleDrain(subscriber: Subscriber): void {
  subscriber.running = true
  subscriber.drainPromise = new Promise<void>((resolve) => {
    queueMicrotask(() => {
      void drain(subscriber).finally(resolve)
    })
  })
}

async function drain(subscriber: Subscriber): Promise<void> {
  try {
    while (subscriber.active) {
      const overflow = subscriber.overflow
      if (overflow !== undefined) {
        subscriber.overflow = undefined
        const overflowEvent = subscriber.commitOverflow(overflow)
        if (overflowEvent !== undefined) await deliver(subscriber.listener, overflowEvent)
        continue
      }
      const event = subscriber.queue.shift()
      if (event === undefined) break
      subscriber.lastDeliveredSeq = event.seq
      await deliver(subscriber.listener, event)
    }
  } finally {
    subscriber.running = false
    if (subscriber.active && (subscriber.overflow !== undefined || subscriber.queue.length > 0)) {
      scheduleDrain(subscriber)
    }
  }
}

async function deliver(listener: DagJournalListener, event: DagRunEvent): Promise<void> {
  try {
    await listener(event)
  } catch (error) {
    console.error("DAG journal subscriber failed", error)
  }
}
