import { randomUUID } from "node:crypto"
import { Worker } from "node:worker_threads"

import { GATEWAY_BUSY_TIMEOUT_MS } from "./constants"
import type {
  ClaimOutcome,
  ClaimRequest,
  DeliveryRow,
  EnqueueOutcome,
  EnqueueRequest,
  GatewayStoreConfig,
  GatewayStoreEvent,
  GatewayStoreStats,
  GatewayStoreTestHooks,
  ProcessIdentity,
  ReconcileOutcome,
  ReconcileRequest,
  RecordOutcomeRequest,
  RefusalReason,
} from "./types"

export type GatewayStoreOptions = {
  readonly agentDir: string
  readonly instanceId?: string
  /** The senpi host generation this process's sessions run in (`pi.sessionContext.host_instance`); omitted in a terminal. */
  readonly runtimeInstance?: string
  readonly legacyMailboxDirectories?: readonly string[]
  readonly now?: () => number
  /** Test seams only: a shorter busy timeout and commit-boundary hooks. */
  readonly _test?: GatewayStoreTestHooks & { readonly busyTimeoutMs?: number }
}

export type DeliveryView = { readonly row: DeliveryRow; readonly queue_position: number }

export type GatewayStore = {
  readonly identity: () => Promise<ProcessIdentity>
  readonly enqueue: (request: EnqueueRequest) => Promise<EnqueueOutcome>
  readonly reconcile: (request: ReconcileRequest) => Promise<ReconcileOutcome>
  readonly claim: (request: ClaimRequest) => Promise<ClaimOutcome>
  readonly recordOutcome: (request: RecordOutcomeRequest) => Promise<ClaimOutcome>
  readonly refuseQueued: (request: { readonly now: number; readonly delivery_id: string; readonly reason: RefusalReason }) => Promise<boolean>
  readonly requeueReleased: (request: { readonly now: number; readonly target_durable_id: string; readonly delivery_ids: readonly string[] }) => Promise<readonly string[]>
  readonly completeReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly result: unknown }) => Promise<boolean>
  readonly abandonReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly error_note: string }) => Promise<boolean>
  readonly deliveryView: (deliveryId: string) => Promise<DeliveryView | null>
  readonly list: (filter?: { readonly target_durable_id?: string; readonly root_id?: string }) => Promise<readonly DeliveryRow[]>
  readonly isReferenced: (durableId: string) => Promise<boolean>
  readonly journalMode: () => Promise<string>
  readonly stats: () => Promise<GatewayStoreStats>
  readonly legacyMigrated: () => Promise<number>
  readonly onEvent: (listener: (event: GatewayStoreEvent) => void) => () => void
  /** Releases a `pause` test hook. */
  readonly resume: (hook: "beforeDbCommit" | "afterDbCommit") => void
  readonly dispose: () => Promise<void>
}

type Pending = { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }

type WorkerMessage =
  | { readonly type: "response"; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly type: "response"; readonly id: number; readonly ok: false; readonly error: { readonly message: string; readonly stack?: string } }
  | { readonly type: "event"; readonly event: GatewayStoreEvent }

/**
 * The async facade every session loop talks to. One worker per store, started on first use and
 * terminated on `dispose`; every method only posts a message and awaits the reply, so no store
 * call ever blocks the caller's event loop. The worker is unref'd while nothing is in flight, so
 * an idle store never keeps a process alive.
 */
export function createGatewayStore(options: GatewayStoreOptions): GatewayStore {
  const config: GatewayStoreConfig = {
    agent_dir: options.agentDir,
    busy_timeout_ms: options._test?.busyTimeoutMs ?? GATEWAY_BUSY_TIMEOUT_MS,
    instance_id: options.instanceId ?? randomUUID(),
    runtime_instance: options.runtimeInstance ?? null,
    legacy_mailbox_directories: options.legacyMailboxDirectories ?? [],
    test_hooks: {
      ...(options._test?.beforeDbCommit === undefined ? {} : { beforeDbCommit: options._test.beforeDbCommit }),
      ...(options._test?.afterDbCommit === undefined ? {} : { afterDbCommit: options._test.afterDbCommit }),
      ...(options._test?.announceBarrier === undefined ? {} : { announceBarrier: options._test.announceBarrier }),
    },
  }
  const now = options.now ?? Date.now
  const pending = new Map<number, Pending>()
  const listeners = new Set<(event: GatewayStoreEvent) => void>()
  let worker: Worker | undefined
  let opened: Promise<{ readonly self: ProcessIdentity; readonly legacy_migrated: number }> | undefined
  let nextId = 1
  let disposed = false

  function failAll(error: Error): void {
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }

  function post(op: string, args: unknown): Promise<unknown> {
    const active = worker
    if (active === undefined) return Promise.reject(new Error("the gateway store is closed"))
    const id = nextId++
    const reply = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
    active.ref()
    active.postMessage({ type: "request", id, op, args })
    return reply
  }

  function start(): Promise<{ readonly self: ProcessIdentity; readonly legacy_migrated: number }> {
    if (disposed) return Promise.reject(new Error("the gateway store is disposed"))
    if (opened !== undefined) return opened
    const spawned = new Worker(new URL("./store-worker.ts", import.meta.url))
    worker = spawned
    spawned.unref()
    spawned.on("message", (message: WorkerMessage) => {
      if (message.type === "event") {
        for (const listener of listeners) listener(message.event)
        return
      }
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (pending.size === 0) spawned.unref()
      if (message.ok) entry.resolve(message.value)
      else entry.reject(Object.assign(new Error(message.error.message), { workerStack: message.error.stack }))
    })
    spawned.on("error", (error: unknown) => failAll(error instanceof Error ? error : new Error(String(error))))
    spawned.on("exit", (code) => {
      if (worker === spawned) worker = undefined
      failAll(new Error(`the gateway store worker exited (${code})`))
    })
    opened = post("init", { config, now: now() }) as Promise<{ readonly self: ProcessIdentity; readonly legacy_migrated: number }>
    return opened
  }

  async function call<T>(op: string, args?: unknown): Promise<T> {
    await start()
    return (await post(op, args)) as T
  }

  return {
    identity: async () => (await start()).self,
    enqueue: (request) => call("enqueue", request),
    reconcile: (request) => call("reconcile", request),
    claim: (request) => call("claim", request),
    recordOutcome: (request) => call("record_outcome", request),
    refuseQueued: (request) => call("refuse_queued", request),
    requeueReleased: (request) => call("requeue_released", request),
    completeReceipt: (request) => call("complete_receipt", request),
    abandonReceipt: (request) => call("abandon_receipt", request),
    deliveryView: (deliveryId) => call("delivery_view", deliveryId),
    list: (filter = {}) => call("list", filter),
    isReferenced: (durableId) => call("is_referenced", durableId),
    journalMode: () => call("journal_mode"),
    stats: () => call("stats"),
    legacyMigrated: async () => (await start()).legacy_migrated,
    onEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    resume: (hook) => worker?.postMessage({ type: "resume", hook }),
    dispose: async () => {
      if (disposed) return
      disposed = true
      const active = worker
      if (active === undefined) return
      await post("close", null).catch(() => undefined)
      worker = undefined
      await active.terminate()
    },
  }
}
