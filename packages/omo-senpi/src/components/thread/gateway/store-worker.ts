/**
 * The gateway store's worker thread. It alone opens `<agentDir>/gateway/gateway.sqlite` and runs
 * every statement, lock wait, busy retry and inbox-marker write, so a contended store never blocks
 * the session loop that owns the store facade. Requests run strictly one at a time.
 */
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { parentPort } from "node:worker_threads"

import { lockWaitExceeded } from "./lock-wait"
import { gatewayDatabasePath, gatewayRootDirectory } from "./paths"
import { processStartTime } from "./process-identity"
import { isBusyError, Sql, type SqliteConnection } from "./sql"
import * as ops from "./store-ops"
import * as models from "./store-model-ops"
import * as relay from "./store-relay-ops"
import * as ownership from "./store-ownership"
import { StoreExtensions } from "./store-extension-ops"
import * as sessions from "./store-extension-session-ops"
import { listSessionOps } from "./extension-registrations"
import { ExtensionTransactionEndedError } from "./extension-transaction"
import type { GatewayResolution, GatewayResolve } from "./engine"
import type { StoreExtensionRegistration } from "./store-extensions"
import type { GatewayStoreConfig, GatewayStoreEvent } from "./types"

type WorkerRequest = { readonly type: "request"; readonly id: number; readonly op: string; readonly args: unknown }
type WorkerControl = { readonly type: "resume"; readonly hook: string }
type ResolutionReply = { readonly type: "resolution"; readonly id: number } & (
  | { readonly ok: true; readonly value: GatewayResolution }
  | { readonly ok: false; readonly error: string }
)

const port = parentPort
if (port === null) throw new Error("the gateway store worker must run as a worker thread")

const WAL_SWITCH_RETRY_MS = 10

const queue: WorkerRequest[] = []
const barriers = new Map<string, () => void>()
let running = false
let context: ops.StoreContext | undefined
let connection: SqliteConnection | undefined
let extensions: StoreExtensions | undefined
/** The extension whose registration or call ran most recently; a late error is attributed to it. */
let lastExtensionActivity: string | undefined
let nextResolution = 1
const resolutions = new Map<number, { readonly resolve: (value: GatewayResolution) => void; readonly reject: (error: Error) => void }>()
const resolveTarget: GatewayResolve = (address, request) => new Promise((resolve, reject) => {
  const id = nextResolution++
  resolutions.set(id, { resolve, reject })
  port.postMessage({ type: "resolve", id, address, request })
})

function lateTransactionError(error: unknown): void {
  if (error instanceof ExtensionTransactionEndedError) {
    emit({ kind: "extension_error", extension: error.extension, phase: "stale_transaction", error: error.message })
    return
  }
  // A late asynchronous error fires after its operation returned: report it as a store event,
  // attributed to the most recent extension activity on a best effort, and keep the worker (and
  // with it the store) serving instead of letting the process default take the worker down.
  emit({ kind: "extension_error", extension: lastExtensionActivity ?? "worker", phase: "async", error: error instanceof Error ? error.message : String(error) })
}

process.on("uncaughtException", lateTransactionError)
process.on("unhandledRejection", lateTransactionError)

port.on("message", (message: WorkerRequest | WorkerControl | ResolutionReply) => {
  if (message.type === "resolution") {
    const pending = resolutions.get(message.id)
    resolutions.delete(message.id)
    if (message.ok) pending?.resolve(message.value)
    else pending?.reject(new Error(message.error))
    return
  }
  if (message.type === "resume") {
    barriers.get(message.hook)?.()
    barriers.delete(message.hook)
    return
  }
  queue.push(message)
  void pump()
})

async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    for (let request = queue.shift(); request !== undefined; request = queue.shift()) {
      try {
        const value = await dispatch(request.op, request.args)
        port?.postMessage({ type: "response", id: request.id, ok: true, value })
      } catch (error) {
        port?.postMessage({
          type: "response",
          id: request.id,
          ok: false,
          error: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            code: typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : undefined,
          },
        })
      }
    }
  } finally {
    running = false
  }
}

function emit(event: GatewayStoreEvent): void {
  port?.postMessage({ type: "event", event })
}

function requireContext(): ops.StoreContext {
  if (context === undefined) throw new Error("the gateway store is not open")
  return context
}

async function dispatch(op: string, args: unknown): Promise<unknown> {
  if (op === "init") return await open(args as { readonly config: GatewayStoreConfig; readonly now: number })
  if (op === "close") {
    connection?.close()
    connection = undefined
    context = undefined
    extensions = undefined
    return null
  }
  const ctx = requireContext()
  switch (op) {
    case "extension_register": {
      const request = args as { readonly extension: StoreExtensionRegistration; readonly now: number; readonly restored_at?: number }
      lastExtensionActivity = request.extension.name
      const result = await extensions?.register(request.extension, request.now, request.restored_at)
      return { result, retained: extensions?.holds(request.extension) === true }
    }
    case "extension_call":
    case "extension_session_call": {
      const request = args as { readonly name: string; readonly op: string; readonly args: unknown; readonly now: number }
      lastExtensionActivity = request.name
      try {
        if (extensions === undefined) return undefined
        return op === "extension_call" ? await extensions.call(request.name, request.op, request.args, request.now) : await sessions.sessionCall(ctx, extensions, args as sessions.SessionCallRequest)
      } finally {
        for (const pending of resolutions.values()) pending.reject(new ExtensionTransactionEndedError(request.name))
        resolutions.clear()
      }
    }
    case "session_callable_ops": return listSessionOps(ctx)
    case "record_thread_creation": return await sessions.recordThreadCreation(ctx, args as Parameters<typeof sessions.recordThreadCreation>[1])
    case "enqueue": return await ops.enqueue(ctx, args as Parameters<typeof ops.enqueue>[1])
    case "reconcile": return await ops.reconcile(ctx, args as Parameters<typeof ops.reconcile>[1])
    case "claim": return await ops.claim(ctx, args as Parameters<typeof ops.claim>[1])
    case "record_outcome": return await ops.recordOutcome(ctx, args as Parameters<typeof ops.recordOutcome>[1])
    case "refuse_queued": return await ops.refuseQueued(ctx, args as Parameters<typeof ops.refuseQueued>[1])
    case "complete_receipt": return await ops.completeReceipt(ctx, args as Parameters<typeof ops.completeReceipt>[1])
    case "abandon_receipt": return await ops.abandonReceipt(ctx, args as Parameters<typeof ops.abandonReceipt>[1])
    case "delivery_view": return ops.deliveryView(ctx, args as string)
    case "delivery_receipt": return ops.deliveryReceipt(ctx, args as Parameters<typeof ops.deliveryReceipt>[1])
    case "recover_delivery": return await ops.recoverDelivery(ctx, args as Parameters<typeof ops.recoverDelivery>[1])
    case "list": return ops.listDeliveries(ctx, args as Parameters<typeof ops.listDeliveries>[1])
    case "is_referenced": return ops.isReferenced(ctx, args as string)
    case "journal_mode": return ops.journalMode(ctx)
    case "stats": return ops.stats(ctx)
    case "tool_receipt_begin": return await relay.toolReceiptBegin(ctx, args as Parameters<typeof relay.toolReceiptBegin>[1])
    case "tool_receipt_settle": return await relay.toolReceiptSettle(ctx, args as Parameters<typeof relay.toolReceiptSettle>[1])
    case "bind": return await relay.bindThread(ctx, args as Parameters<typeof relay.bindThread>[1])
    case "unbind": return await relay.unbindThread(ctx, args as Parameters<typeof relay.unbindThread>[1])
    case "rebind": return await relay.rebindThread(ctx, args as Parameters<typeof relay.rebindThread>[1])
    case "list_bindings": return await relay.listBindings(ctx, args as Parameters<typeof relay.listBindings>[1])
    case "binding_view": return await relay.bindingView(ctx, args as Parameters<typeof relay.bindingView>[1])
    case "register_incarnation": return await ownership.registerIncarnation(ctx, args as Parameters<typeof ownership.registerIncarnation>[1])
    case "clear_endpoint": return await ownership.clearEndpoint(ctx, args as Parameters<typeof ownership.clearEndpoint>[1])
    case "session_owner": return ownership.sessionOwner(ctx, args as string)
    case "report": return await relay.reportEvent(ctx, args as Parameters<typeof relay.reportEvent>[1])
    case "mirror_question": return await relay.mirrorQuestion(ctx, args as Parameters<typeof relay.mirrorQuestion>[1])
    case "emit_completions": return await relay.emitCompletions(ctx, args as Parameters<typeof relay.emitCompletions>[1])
    case "pending_completion_arms": return relay.pendingCompletionArms(ctx, args as string)
    case "latest_completion_arm": return relay.latestCompletionArm(ctx, args as string)
    case "read_outbox": return await relay.readOutbox(ctx, args as Parameters<typeof relay.readOutbox>[1])
    case "ack_outbox": return await relay.ackOutbox(ctx, args as Parameters<typeof relay.ackOutbox>[1])
    case "claim_answer": return await relay.claimAnswer(ctx, args as Parameters<typeof relay.claimAnswer>[1])
    case "release_answer": return await relay.releaseAnswer(ctx, args as Parameters<typeof relay.releaseAnswer>[1])
    case "confirm_answer": return await relay.confirmAnswer(ctx, args as Parameters<typeof relay.confirmAnswer>[1])
    case "mark_prior_delivered": return await relay.markPriorDelivered(ctx, args as Parameters<typeof relay.markPriorDelivered>[1])
    case "record_session_model": return await models.recordSessionModel(ctx, args as Parameters<typeof models.recordSessionModel>[1])
    case "record_session_model_if_current": return await models.recordSessionModelIfCurrent(ctx, args as Parameters<typeof models.recordSessionModelIfCurrent>[1])
    case "update_session_thinking": return await models.updateSessionThinking(ctx, args as Parameters<typeof models.updateSessionThinking>[1])
    case "record_pending_session_model": return await models.recordPendingSessionModel(ctx, args as Parameters<typeof models.recordPendingSessionModel>[1])
    case "replace_pending_session_model": return await models.replacePendingSessionModel(ctx, args as Parameters<typeof models.replacePendingSessionModel>[1])
    case "observe_model_select": return await models.observeModelSelect(ctx, args as Parameters<typeof models.observeModelSelect>[1])
    case "session_models": return models.sessionModels(ctx, args as readonly string[])
    case "session_model_record": return models.sessionModelRecord(ctx, args as string)
    case "close_question": return await relay.closeQuestion(ctx, args as Parameters<typeof relay.closeQuestion>[1])
    default: throw new Error(`unknown gateway store op: ${op}`)
  }
}

async function open(request: { readonly config: GatewayStoreConfig; readonly now: number }): Promise<unknown> {
  const { config } = request
  const root = gatewayRootDirectory(config.agent_dir)
  mkdirSync(join(root, "inbox"), { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  const path = gatewayDatabasePath(config.agent_dir)
  closeSync(openSync(path, "a", 0o600))
  chmodSync(path, 0o600)
  const sqlite = await import("node:sqlite")
  connection = new sqlite.DatabaseSync(path, { timeout: config.busy_timeout_ms }) as unknown as SqliteConnection
  const sql = new Sql(connection)
  sql.exec(`PRAGMA busy_timeout = ${Math.trunc(config.busy_timeout_ms)}`)
  // Two processes opening a brand-new store race for the WAL switch, which does not wait on
  // busy_timeout; the loser retries until the winner's switch is published, for at most the
  // store's lock-wait bound.
  const walStarted = Date.now()
  for (;;) {
    try {
      sql.exec("PRAGMA journal_mode = WAL")
      break
    } catch (error) {
      if (!isBusyError(error)) throw error
      const waited = Date.now() - walStarted
      if (waited + WAL_SWITCH_RETRY_MS > config.lock_wait_max_ms) {
        emit({ kind: "lock_wait_exceeded", op: "open", waited_ms: waited })
        throw lockWaitExceeded("open", waited, config.lock_wait_max_ms)
      }
      await delay(WAL_SWITCH_RETRY_MS)
    }
  }
  sql.exec("PRAGMA synchronous = FULL")
  for (const suffix of ["-wal", "-shm"]) if (existsSync(`${path}${suffix}`)) chmodSync(`${path}${suffix}`, 0o600)
  const self = { pid: process.pid, process_start_time: await processStartTime(process.pid), instance_id: config.instance_id, runtime_instance: config.runtime_instance }
  context = {
    sql,
    config,
    self,
    stats: { writes: 0, marker_unlinks: 0, transactions: 0 },
    emit,
    hook: runHook,
    delay: (ms) => delay(ms),
  }
  await ops.migrate(context)
  extensions = new StoreExtensions(context, resolveTarget)
  const legacy = await ops.migrateLegacyMailboxes(context, request.now)
  context.stats.writes = 0
  context.stats.transactions = 0
  context.stats.marker_unlinks = 0
  return { self, legacy_migrated: legacy }
}

async function runHook(name: "beforeDbCommit" | "afterDbCommit"): Promise<void> {
  const action = context?.config.test_hooks[name]
  if (action === undefined) return
  if (action === "throw") throw new Error(`gateway test hook ${name}`)
  if (action === "sigkill") {
    process.kill(process.pid, "SIGKILL")
    await new Promise<never>(() => undefined)
  }
  const released = new Promise<void>((resolve) => barriers.set(name, resolve))
  emit({ kind: "paused", hook: name })
  await released
}
