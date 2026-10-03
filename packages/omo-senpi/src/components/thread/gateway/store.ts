import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"

import type { BindingRecord, CompletionOutcome, OutboxRow, RelayOutcome } from "./bindings"
import { GATEWAY_BUSY_TIMEOUT_MS, GATEWAY_LOCK_WAIT_MAX_MS } from "./constants"
import type { GatewayResolve } from "./engine"
import type { StoreExtensionApi, StoreExtensionRefusal, StoreExtensionRegistration, StoreExtensionResult } from "./store-extensions"
export type { StoreExtensionApi, StoreExtensionOperation, StoreExtensionRefusal, StoreExtensionRefusalCode, StoreExtensionRegistration, StoreExtensionResult, StoreExtensionTransaction } from "./store-extensions"
import type {
  AnswerClaim,
  AnswerClaimRef,
  AnswerDelivered,
  BindOpRequest,
  PriorAnswer,
  BindingsFilter,
  CasRequest,
  ReportOpRequest,
  ReportOpResult,
  ToolReceiptBegin,
} from "./store-relay-ops"
import type { DeliveryReceipt } from "./store-ops"
import type { ClearEndpointRequest, RegisterIncarnationRequest, SessionOwner } from "./store-ownership"
import type {
  ClaimOutcome,
  ClaimRequest,
  DeliveryRow,
  EnqueueOutcome,
  EnqueueRequest,
  ExternalAuthor,
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
  /** The module location the worker sidecar is resolved from when the facade does not run inside `omo.js` (the thread SDK runtime). */
  readonly workerModuleUrl?: string | URL
  /** Resolves extension enqueue targets through the caller's live-and-disk address book. */
  readonly resolveTarget?: GatewayResolve
  /** Test seams only: a shorter busy timeout and lock-wait bound, commit-boundary hooks, and the module location the worker is resolved from. */
  readonly _test?: GatewayStoreTestHooks & { readonly busyTimeoutMs?: number; readonly lockWaitMaxMs?: number; readonly moduleUrl?: string | URL; readonly onWorkerStarted?: (worker: Worker) => void }
}

/** The store worker's file name beside the built extension bundle (`plugin/extensions/`). */
export const GATEWAY_STORE_WORKER_BUNDLE_NAME = "gateway-store-worker.mjs"

/**
 * Where the worker thread's module is, seen from the module the store facade runs in: inside the
 * built extension that is the `gateway-store-worker.mjs` sidecar the build emits beside `omo.js`
 * (a bundler cannot inline a Worker's entry); from source it is `store-worker.ts` next to this file.
 */
export function gatewayStoreWorkerUrl(moduleUrl: string | URL = import.meta.url): URL {
  const bundled = new URL(`./${GATEWAY_STORE_WORKER_BUNDLE_NAME}`, moduleUrl)
  return existsSync(fileURLToPath(bundled)) ? bundled : new URL("./store-worker.ts", moduleUrl)
}

export type DeliveryView = { readonly row: DeliveryRow; readonly queue_position: number }

export type ReceiptScope = { readonly principal: string; readonly operation: string; readonly idempotency_key: string }

export type OutboxPage = { readonly binding_id: string; readonly revision: number; readonly status: BindingRecord["status"]; readonly rows: readonly OutboxRow[]; readonly next_cursor: number; readonly acked_cursor: number }

/** Relay results carry `deduplicated`: true when an idempotency key replayed an earlier success. */
export type Deduplicated = { readonly deduplicated?: boolean }

export type GatewayStore = StoreExtensionApi & {
  /** The store's busy timeout: the delay before a caller re-arms an operation that failed with a lock-wait error. */
  readonly busyTimeoutMs: number
  /** The clock this store's rows are stamped and expired against; drains, engines and relays built on the store default to it. */
  readonly now: () => number
  readonly identity: () => Promise<ProcessIdentity>
  readonly enqueue: (request: EnqueueRequest) => Promise<EnqueueOutcome>
  readonly reconcile: (request: ReconcileRequest) => Promise<ReconcileOutcome>
  readonly claim: (request: ClaimRequest) => Promise<ClaimOutcome>
  readonly recordOutcome: (request: RecordOutcomeRequest) => Promise<ClaimOutcome>
  readonly refuseQueued: (request: { readonly now: number; readonly delivery_id: string; readonly reason: RefusalReason }) => Promise<boolean>
  readonly completeReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly result: unknown }) => Promise<boolean>
  readonly abandonReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly error_note: string }) => Promise<boolean>
  readonly deliveryView: (deliveryId: string) => Promise<DeliveryView | null>
  /** A completed delivery receipt's stored result and the row facts its arguments were hashed with; a plain read. */
  readonly deliveryReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string }) => Promise<DeliveryReceipt | null>
  readonly recoverDelivery: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly args_hash: string }) => Promise<EnqueueOutcome | null>
  readonly list: (filter?: { readonly target_durable_id?: string; readonly root_id?: string }) => Promise<readonly DeliveryRow[]>
  readonly isReferenced: (durableId: string) => Promise<boolean>
  readonly journalMode: () => Promise<string>
  readonly stats: () => Promise<GatewayStoreStats>
  readonly legacyMigrated: () => Promise<number>
  readonly toolReceiptBegin: (request: ReceiptScope & { readonly now: number; readonly args_hash: string }) => Promise<ToolReceiptBegin>
  readonly toolReceiptSettle: (request: ReceiptScope & { readonly now: number } & ({ readonly result: unknown } | { readonly error_note: string })) => Promise<boolean>
  readonly bind: (request: BindOpRequest) => Promise<RelayOutcome<{ readonly binding: BindingRecord } & Deduplicated>>
  readonly unbind: (request: CasRequest) => Promise<RelayOutcome<{ readonly binding: BindingRecord; readonly already_closed: boolean; readonly in_flight: readonly string[] } & Deduplicated>>
  readonly rebind: (request: CasRequest & { readonly session_durable_id: string }) => Promise<RelayOutcome<{ readonly binding: BindingRecord; readonly closed: readonly string[] } & Deduplicated>>
  readonly listBindings: (request: { readonly now: number; readonly filter: BindingsFilter; readonly cursor?: string; readonly limit?: number }) => Promise<RelayOutcome<{ readonly bindings: readonly BindingRecord[]; readonly next_cursor: string | null }>>
  readonly bindingView: (request: { readonly now: number; readonly binding_id: string }) => Promise<BindingRecord | null>
  readonly registerIncarnation: (request: RegisterIncarnationRequest) => Promise<void>
  readonly clearEndpoint: (request: ClearEndpointRequest) => Promise<void>
  readonly sessionOwner: (durableId: string) => Promise<SessionOwner | null>
  readonly report: (request: ReportOpRequest) => Promise<RelayOutcome<ReportOpResult & Deduplicated>>
  readonly emitCompletions: (request: { readonly now: number; readonly session_durable_id: string; readonly outcome: CompletionOutcome; readonly through_arm_seq?: number }) => Promise<readonly { readonly binding_id: string; readonly cursor: number }[]>
  /** Completion arms waiting for the session's settle; a plain read that takes no write lock. */
  readonly pendingCompletionArms: (durableId: string) => Promise<number>
  /** The sequence number of the newest completion arm waiting for the session's settle, null when none waits; a plain read that takes no write lock. */
  readonly latestCompletionArm: (durableId: string) => Promise<number | null>
  readonly readOutbox: (request: { readonly now: number; readonly binding_id: string; readonly after_cursor?: number; readonly limit?: number }) => Promise<RelayOutcome<OutboxPage>>
  readonly ackOutbox: (request: { readonly now: number; readonly binding_id: string; readonly cursor: number; readonly provider_message_id?: string }) => Promise<RelayOutcome<{ readonly binding_id: string; readonly acked_cursor: number; readonly changed: boolean }>>
  readonly claimAnswer: (request: { readonly now: number; readonly binding_id: string; readonly reply_token: string; readonly answer: string; readonly answered_by?: ExternalAuthor | null }) => Promise<RelayOutcome<AnswerClaim>>
  readonly releaseAnswer: (request: AnswerClaimRef) => Promise<boolean>
  readonly confirmAnswer: (request: AnswerDelivered) => Promise<boolean>
  readonly markPriorDelivered: (request: AnswerClaimRef & { readonly prior: PriorAnswer }) => Promise<boolean>
  /** The session closed a relayed question itself (answered locally, timed out, cancelled); the questions closed. */
  readonly closeQuestion: (request: { readonly now: number; readonly session_durable_id: string; readonly ui_request_id: string }) => Promise<number>
  readonly onEvent: (listener: (event: GatewayStoreEvent) => void) => () => void
  /** Releases a `pause` test hook. */
  readonly resume: (hook: "beforeDbCommit" | "afterDbCommit") => void
  readonly dispose: () => Promise<void>
}

/** The worker's registration reply: the caller's result, and whether calls for that name now use this registration. */
type ExtensionRegisterReply = { readonly result: StoreExtensionResult<{ readonly version: number }>; readonly retained: boolean }

type Pending = { readonly worker: Worker; readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }

type WorkerMessage =
  | { readonly type: "resolve"; readonly id: number; readonly address: string; readonly request: Parameters<GatewayResolve>[1] }
  | { readonly type: "response"; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly type: "response"; readonly id: number; readonly ok: false; readonly error: { readonly message: string; readonly stack?: string; readonly code?: string } }
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
    lock_wait_max_ms: options._test?.lockWaitMaxMs ?? GATEWAY_LOCK_WAIT_MAX_MS,
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
  let resolveTarget = options.resolveTarget
  /** The registrations the current worker holds, restored on the next worker after one exits. */
  const registrations = new Map<string, StoreExtensionRegistration>()

  const resolveExtensionTarget: GatewayResolve = async (address, request) => {
    if (resolveTarget === undefined) {
      const { createExtensionResolver } = await import("./extension-resolver")
      resolveTarget = createExtensionResolver(options.agentDir)
    }
    return await resolveTarget(address, request)
  }

  /** Fails the requests posted to one worker; a successor's requests are not its to fail. */
  function failAll(owner: Worker, error: Error): void {
    for (const [id, entry] of pending) {
      if (entry.worker !== owner) continue
      pending.delete(id)
      entry.reject(error)
    }
  }

  function post(op: string, args: unknown): Promise<unknown> {
    const active = worker
    if (active === undefined) return Promise.reject(new Error("the gateway store is closed"))
    const id = nextId++
    const reply = new Promise<unknown>((resolve, reject) => pending.set(id, { worker: active, resolve, reject }))
    active.ref()
    try {
      active.postMessage({ type: "request", id, op, args })
    } catch (error) {
      const entry = pending.get(id)
      pending.delete(id)
      if (pending.size === 0) active.unref()
      entry?.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return reply
  }

  function start(): Promise<{ readonly self: ProcessIdentity; readonly legacy_migrated: number }> {
    if (disposed) return Promise.reject(new Error("the gateway store is disposed"))
    if (opened !== undefined) return opened
    // A worker inherits the parent's execArgv, and node refuses `--input-type` for a file entry: a
    // script run as `node --input-type=module -e` would otherwise never open the store.
    const execArgv = process.execArgv.filter((argument) => !argument.startsWith("--input-type"))
    const spawned = new Worker(gatewayStoreWorkerUrl(options._test?.moduleUrl ?? options.workerModuleUrl), { execArgv })
    worker = spawned
    spawned.unref()
    spawned.on("message", (message: WorkerMessage) => {
      if (message.type === "resolve") {
        void resolveExtensionTarget(message.address, message.request).then(
          (value) => { if (worker === spawned) spawned.postMessage({ type: "resolution", id: message.id, ok: true, value }) },
          (error: unknown) => { if (worker === spawned) spawned.postMessage({ type: "resolution", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }) },
        )
        return
      }
      if (message.type === "event") {
        for (const listener of listeners) listener(message.event)
        return
      }
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (pending.size === 0) spawned.unref()
      if (message.ok) entry.resolve(message.value)
      else entry.reject(Object.assign(new Error(message.error.message), { workerStack: message.error.stack, ...(message.error.code === undefined ? {} : { code: message.error.code }) }))
    })
    spawned.on("error", (error: unknown) => failAll(spawned, error instanceof Error ? error : new Error(String(error))))
    // A worker that exits (a crash, or the termination after a failed open) takes its open with it:
    // the next call starts a fresh worker. Requests in flight fail and are never replayed.
    spawned.on("exit", (code) => {
      if (worker === spawned) {
        worker = undefined
        opened = undefined
      }
      failAll(spawned, new Error(`the gateway store worker exited (${code})`))
    })
    options._test?.onWorkerStarted?.(spawned)
    const attempt = (post("init", { config, now: now() }) as Promise<{ readonly self: ProcessIdentity; readonly legacy_migrated: number }>).then(async (value) => {
      // A fresh worker holds no extension registrations: restore the ones its predecessor held
      // before any call reaches it, keeping only those the new worker holds in turn.
      for (const [name, extension] of registrations) {
        const reply = (await post("extension_register", { extension, now: now() })) as ExtensionRegisterReply
        if (!reply.retained) registrations.delete(name)
      }
      return value
    })
    opened = attempt
    // A failed open is not cached: every caller of this attempt sees its error, and the next call
    // opens again (a lock held during the first open, a migration that hit the lock-wait bound).
    attempt.catch(() => {
      if (opened !== attempt) return
      opened = undefined
      if (worker === spawned) worker = undefined
      void spawned.terminate()
    })
    return attempt
  }

  async function call<T>(op: string, args?: unknown): Promise<T> {
    await start()
    return (await post(op, args)) as T
  }

  /** A newer core schema refuses extension requests as data; anything else stays an error. */
  function schemaTooNew(error: unknown): StoreExtensionRefusal {
    if (error instanceof Error && "code" in error && error.code === "gateway_schema_too_new") {
      return { kind: "refused", code: "gateway_schema_too_new", message: error.message }
    }
    throw error
  }

  async function extensionRequest<T>(op: string, args: unknown): Promise<StoreExtensionResult<T>> {
    try {
      return await call(op, args)
    } catch (error) {
      return schemaTooNew(error)
    }
  }

  async function registerExtension(extension: StoreExtensionRegistration): Promise<StoreExtensionResult<{ readonly version: number }>> {
    let reply: ExtensionRegisterReply
    try {
      reply = await call("extension_register", { extension, now: now() })
    } catch (error) {
      return schemaTooNew(error)
    }
    if (reply.retained) registrations.set(extension.name, structuredClone(extension))
    return reply.result
  }

  return {
    registerStoreExtension: registerExtension,
    extensionCall: async (name, op, args) => {
      let cloned: unknown
      try {
        cloned = structuredClone(args)
      } catch (error) {
        return { kind: "refused", code: "invalid_arguments", message: `Extension arguments are not cloneable: ${error instanceof Error ? error.message : String(error)}` }
      }
      return await extensionRequest("extension_call", { name, op, args: cloned, now: now() })
    },
    busyTimeoutMs: config.busy_timeout_ms,
    now,
    identity: async () => (await start()).self,
    enqueue: (request) => call("enqueue", request),
    reconcile: (request) => call("reconcile", request),
    claim: (request) => call("claim", request),
    recordOutcome: (request) => call("record_outcome", request),
    refuseQueued: (request) => call("refuse_queued", request),
    completeReceipt: (request) => call("complete_receipt", request),
    abandonReceipt: (request) => call("abandon_receipt", request),
    deliveryView: (deliveryId) => call("delivery_view", deliveryId),
    deliveryReceipt: (request) => call("delivery_receipt", request),
    recoverDelivery: (request) => call("recover_delivery", request),
    list: (filter = {}) => call("list", filter),
    isReferenced: (durableId) => call("is_referenced", durableId),
    journalMode: () => call("journal_mode"),
    stats: () => call("stats"),
    legacyMigrated: async () => (await start()).legacy_migrated,
    toolReceiptBegin: (request) => call("tool_receipt_begin", request),
    toolReceiptSettle: (request) => call("tool_receipt_settle", request),
    bind: (request) => call("bind", request),
    unbind: (request) => call("unbind", request),
    rebind: (request) => call("rebind", request),
    listBindings: (request) => call("list_bindings", request),
    bindingView: (request) => call("binding_view", request),
    registerIncarnation: (request) => call("register_incarnation", request),
    clearEndpoint: (request) => call("clear_endpoint", request),
    sessionOwner: (durableId) => call("session_owner", durableId),
    report: (request) => call("report", request),
    emitCompletions: (request) => call("emit_completions", request),
    pendingCompletionArms: (durableId) => call("pending_completion_arms", durableId),
    latestCompletionArm: (durableId) => call("latest_completion_arm", durableId),
    readOutbox: (request) => call("read_outbox", request),
    ackOutbox: (request) => call("ack_outbox", request),
    claimAnswer: (request) => call("claim_answer", request),
    releaseAnswer: (request) => call("release_answer", request),
    confirmAnswer: (request) => call("confirm_answer", request),
    markPriorDelivered: (request) => call("mark_prior_delivered", request),
    closeQuestion: (request) => call("close_question", request),
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
