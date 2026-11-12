/**
 * The gateway store's worker thread. It alone opens `<agentDir>/gateway/gateway.sqlite` and runs
 * every statement, lock wait, busy retry and inbox-marker write, so a contended store never blocks
 * the session loop that owns the store facade. Requests run strictly one at a time.
 */
import { createHash, randomUUID } from "node:crypto"
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { parentPort } from "node:worker_threads"

import { WAKE_LEASE_MS, WOKEN_SESSION_CAP } from "./constants"
import { lockWaitExceeded } from "./lock-wait"
import { gatewayDatabasePath, gatewayRootDirectory, gatewayWakeMarkerPath } from "./paths"
import { isClaimantDead, processStartTime } from "./process-identity"
import { isBusyError, Sql, type SqliteConnection, type SqlRow } from "./sql"
import * as ops from "./store-ops"
import * as relay from "./store-relay-ops"
import * as ownership from "./store-ownership"
import { StoreExtensions } from "./store-extension-ops"
import * as sessions from "./store-extension-session-ops"
import { listSessionOps } from "./extension-registrations"
import { ExtensionTransactionEndedError } from "./extension-transaction"
import type { GatewayResolution, GatewayResolve } from "./engine"
import type { StoreExtensionRegistration } from "./store-extensions"
import type {
  GatewayStoreConfig,
  GatewayStoreEvent,
  IntakeOutcome,
  IntakeRequest,
  ProcessIdentity,
  Provenance,
  StoreRefusal,
} from "./types"
import type {
  LostLease,
  WakeRequestOutcome,
  WakeRetryOutcome,
  WakeStartOutcome,
  WakeTakeOverOutcome,
  WokenSessionFence,
  WokenSessionKey,
  WokenSessionRow,
  WokenSessionStore,
  WokenStateRequest,
} from "./woken-types"

type WorkerRequest = { readonly type: "request"; readonly id: number; readonly op: string; readonly args: unknown }
type WorkerControl = { readonly type: "resume"; readonly hook: string }
type ResolutionReply = { readonly type: "resolution"; readonly id: number } & (
  { readonly ok: true; readonly value: GatewayResolution } | { readonly ok: false; readonly error: string }
)
type ProvenanceReply = { readonly type: "provenance_resolved"; readonly id: number } & (
  { readonly ok: true; readonly value: Provenance } | { readonly ok: false; readonly error: string }
)

const port = parentPort
if (port === null) throw new Error("the gateway store worker must run as a worker thread")

const WAL_SWITCH_RETRY_MS = 10

/** A wake whose open failed for a transient reason is tried again this long after, and given up after this many attempts (A3.1.5). */
const WAKE_RETRY_DELAY_MS = 10_000
const WAKE_MAX_ATTEMPTS = 3

// Must match the durable id rule the enqueue applies (store-ops.ts DURABLE_ID_PATTERN).
const INTAKE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

function refusal(
  code: StoreRefusal["code"],
  message: string,
  details?: Readonly<Record<string, unknown>>,
): StoreRefusal {
  return { kind: "refused", code, message, ...(details === undefined ? {} : { details }) }
}

function argsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/**
 * Takes in a record another device's service attested, for a session on this device that is not running (#13037, design
 * 5.5). Every refusal here happens before the commit; an accepted record is the enqueue transaction's row, receipt, budgets
 * and inbox marker in one commit, its receipt completed with the answer so a repeat from the same device replays it.
 */
async function intake(ctx: ops.StoreContext, request: IntakeRequest): Promise<IntakeOutcome> {
  const record = request.record
  const device = request.attested_device
  if (
    !INTAKE_ID_PATTERN.test(device) ||
    !INTAKE_ID_PATTERN.test(record.deliveryId) ||
    !INTAKE_ID_PATTERN.test(record.sessionId) ||
    typeof record.text !== "string" ||
    typeof record.displayText !== "string" ||
    !Number.isSafeInteger(record.chainCount) ||
    record.chainCount < 1
  ) {
    return refusal("invalid_arguments", "The intake record is malformed.")
  }
  const senderSession = record.sender.kind === "agent" ? record.sender.session_id : undefined
  if (senderSession === undefined || !INTAKE_ID_PATTERN.test(senderSession)) {
    return refusal("unsupported", "Only an agent sender can reach a session that is not running.", {
      reason: "sender_not_allowed",
    })
  }
  if (record.deliverAs !== "followUp") {
    return refusal("turn_conflict", "A session that is not running has no turn to steer.", {
      target: record.sessionId,
    })
  }
  if (request.target_session_kind !== "interactive") {
    return refusal("not_resumable", "A child or worker session is not started for a delivery.", {
      reason: "not_wakeable",
    })
  }
  if (request.chain_count_limit !== undefined && record.chainCount > request.chain_count_limit) {
    return refusal("unsupported", "The delivery's chain is over this machine's chain limit.", {
      reason: "chain_count_limit",
      chain_count: record.chainCount,
      limit: request.chain_count_limit,
    })
  }
  const ledgerId = `device:${device}/${record.deliveryId}`
  // The receipt is keyed by the attested device alone, like the ledger id: the session a record claims cannot turn a
  // repeated delivery id into a second delivery.
  const principal = `device:${device}`
  const name = record.sender.name?.trim()
  const outcome = await ops.enqueue(
    ctx,
    {
      provenance: { ...request.provenance, device },
      now: request.now,
      delivery_id: randomUUID(),
      target_durable_id: record.sessionId,
      sender_principal: principal,
      rate_principal: `device:${device}`,
      sender_node: `${principal}#session:${senderSession}`,
      sender_turn: null,
      cause_delivery_id: null,
      inbound_hop: record.chainCount - 1,
      claimed_root_id: null,
      origin: { session: senderSession },
      actor: name === undefined || name === "" ? senderSession : name,
      body: record.text,
      mode: "follow_up",
      expected_turn_id: null,
      binding: null,
      receipt: {
        idempotency_key: record.deliveryId,
        args_hash: argsHash({
          target: record.sessionId,
          text: record.text,
          display_text: record.displayText,
          deliver_as: record.deliverAs,
          chain_count: record.chainCount,
        }),
      },
      endpoint_kind: null,
    },
    {
      ledger_id: ledgerId,
      verbatim_text: record.text,
      verbatim_display_text: record.displayText,
      answer: (row, position) => ({
        kind: "queued",
        delivery_id: record.deliveryId,
        row_id: row.delivery_id,
        ledger_id: ledgerId,
        queue_position: position,
      }),
    },
  )
  if (outcome.kind === "inserted") {
    return {
      kind: "queued",
      delivery_id: record.deliveryId,
      row_id: outcome.row.delivery_id,
      ledger_id: ledgerId,
      queue_position: outcome.queue_position,
      deduplicated: false,
    }
  }
  if (outcome.kind === "replay")
    return { ...(outcome.result as Extract<IntakeOutcome, { kind: "queued" }>), deduplicated: true }
  return outcome
}

const queue: WorkerRequest[] = []
const barriers = new Map<string, () => void>()
let running = false
let context: ops.StoreContext | undefined
let connection: SqliteConnection | undefined
let extensions: StoreExtensions | undefined
/** The extension whose registration or call ran most recently; a late error is attributed to it. */
let lastExtensionActivity: string | undefined
let nextResolution = 1
const resolutions = new Map<
  number,
  { readonly resolve: (value: GatewayResolution) => void; readonly reject: (error: Error) => void }
>()
const resolveTarget: GatewayResolve = (address, request) =>
  new Promise((resolve, reject) => {
    const id = nextResolution++
    resolutions.set(id, { resolve, reject })
    port.postMessage({ type: "resolve", id, address, request })
  })
const provenanceRequests = new Map<
  number,
  { readonly resolve: (value: Provenance) => void; readonly reject: (error: Error) => void }
>()
const senderProvenance = (): Promise<Provenance> =>
  new Promise((resolve, reject) => {
    const id = nextResolution++
    provenanceRequests.set(id, { resolve, reject })
    port.postMessage({ type: "provenance", id })
  })

function lateTransactionError(error: unknown): void {
  if (error instanceof ExtensionTransactionEndedError) {
    emit({ kind: "extension_error", extension: error.extension, phase: "stale_transaction", error: error.message })
    return
  }
  // A late asynchronous error fires after its operation returned: report it as a store event,
  // attributed to the most recent extension activity on a best effort, and keep the worker (and
  // with it the store) serving instead of letting the process default take the worker down.
  emit({
    kind: "extension_error",
    extension: lastExtensionActivity ?? "worker",
    phase: "async",
    error: error instanceof Error ? error.message : String(error),
  })
}

process.on("uncaughtException", lateTransactionError)
process.on("unhandledRejection", lateTransactionError)

port.on("message", (message: WorkerRequest | WorkerControl | ResolutionReply | ProvenanceReply) => {
  if (message.type === "provenance_resolved") {
    const pending = provenanceRequests.get(message.id)
    provenanceRequests.delete(message.id)
    if (message.ok) pending?.resolve(message.value)
    else pending?.reject(new Error(message.error))
    return
  }
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
            code:
              typeof (error as { code?: unknown } | null)?.code === "string"
                ? (error as { code: string }).code
                : undefined,
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

// The record of woken sessions (#13037 A3.1). Every write is one `BEGIN IMMEDIATE` transaction: a row leaves `requested`
// in the transaction that counts the cap, so two processes cannot both pass at the cap, and every later write is a
// compare-and-set on the generation a takeover raises, so a carrier that lost its lease writes nothing.
const WOKEN_COLUMNS = [
  "durable_id",
  "session_file",
  "host_instance",
  "state",
  "requested_at",
  "opened_at",
  "first_waiting_at",
  "lease_owner",
  "lease_expires_at",
  "generation",
  "attempts",
  "next_attempt_at",
] as const

const LOST_LEASE: LostLease = { kind: "lost_lease" }

type Timed<T> = T & { readonly now: number }

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function wokenRowFrom(record: SqlRow): WokenSessionRow {
  return {
    durable_id: String(record.durable_id),
    session_file: String(record.session_file),
    host_instance: record.host_instance === null ? null : String(record.host_instance),
    state: record.state as WokenSessionRow["state"],
    requested_at: Number(record.requested_at),
    opened_at: nullableNumber(record.opened_at),
    first_waiting_at: nullableNumber(record.first_waiting_at),
    lease_owner: record.lease_owner === null ? null : (JSON.parse(String(record.lease_owner)) as ProcessIdentity),
    lease_expires_at: nullableNumber(record.lease_expires_at),
    generation: Number(record.generation),
    attempts: Number(record.attempts),
    next_attempt_at: nullableNumber(record.next_attempt_at),
  }
}

function selectWokenRow(ctx: ops.StoreContext, durableId: string): WokenSessionRow | undefined {
  const found = ctx.sql.one(
    WOKEN_COLUMNS,
    `SELECT ${WOKEN_COLUMNS.join(", ")} FROM woken_sessions WHERE durable_id = ?`,
    [durableId],
  )
  return found === undefined ? undefined : wokenRowFrom(found)
}

function requireWokenRow(ctx: ops.StoreContext, durableId: string): WokenSessionRow {
  const row = selectWokenRow(ctx, durableId)
  if (row === undefined) throw new Error(`woken session ${durableId} vanished inside its own transaction`)
  return row
}

/**
 * The wake hint carriers watch: a temp file renamed over `wake.marker`, rewritten while the write lock is held, so like the
 * inbox marker it is only ever early. Written when a wake is requested and when a row ends (a place freed lets a
 * `requested` row start).
 */
function touchWakeMarker(ctx: ops.StoreContext, durableId: string, now: number): void {
  const marker = gatewayWakeMarkerPath(ctx.config.agent_dir)
  mkdirSync(dirname(marker), { recursive: true, mode: 0o700 })
  const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify({ durable_id: durableId, written_at: now }), { mode: 0o600 })
  renameSync(temporary, marker)
}

function fenced(
  ctx: ops.StoreContext,
  fence: WokenSessionFence,
  set: string,
  params: readonly (string | number | null)[],
): boolean {
  return (
    ops.write(ctx, `UPDATE woken_sessions SET ${set} WHERE durable_id = ? AND generation = ?`, [
      ...params,
      fence.durable_id,
      fence.generation,
    ]) === 1
  )
}

async function requestWake(
  ctx: ops.StoreContext,
  request: Timed<WokenSessionKey & { readonly session_file: string }>,
): Promise<WakeRequestOutcome> {
  return await ops.transaction(ctx, "woken_request", () => {
    const created =
      ops.write(
        ctx,
        "INSERT OR IGNORE INTO woken_sessions (durable_id, session_file, state, requested_at) VALUES (?, ?, 'requested', ?)",
        [request.durable_id, request.session_file, request.now],
      ) === 1
    touchWakeMarker(ctx, request.durable_id, request.now)
    return { kind: "requested", row: requireWokenRow(ctx, request.durable_id), created }
  })
}

async function startWake(ctx: ops.StoreContext, request: Timed<WokenSessionKey>): Promise<WakeStartOutcome> {
  return await ops.transaction(ctx, "woken_start", (): WakeStartOutcome => {
    const row = selectWokenRow(ctx, request.durable_id)
    if (row === undefined) return { kind: "not_found" }
    if (row.state !== "requested") return { kind: "in_progress", row }
    if (row.next_attempt_at !== null && row.next_attempt_at > request.now)
      return { kind: "not_yet", next_attempt_at: row.next_attempt_at }
    const taken = Number(
      ctx.sql.one(["n"], "SELECT COUNT(*) AS n FROM woken_sessions WHERE state <> 'requested'")?.n ?? 0,
    )
    if (taken >= WOKEN_SESSION_CAP) return { kind: "overloaded" }
    ops.write(
      ctx,
      "UPDATE woken_sessions SET state = 'opening', lease_owner = ?, lease_expires_at = ?, generation = generation + 1, next_attempt_at = NULL WHERE durable_id = ?",
      [JSON.stringify(ctx.self), request.now + WAKE_LEASE_MS, request.durable_id],
    )
    return { kind: "started", row: requireWokenRow(ctx, request.durable_id) }
  })
}

async function renewLease(
  ctx: ops.StoreContext,
  request: Timed<WokenSessionFence>,
): Promise<{ readonly kind: "renewed"; readonly row: WokenSessionRow } | LostLease> {
  return await ops.transaction(ctx, "woken_renew", () =>
    fenced(ctx, request, "lease_expires_at = ?", [request.now + WAKE_LEASE_MS])
      ? { kind: "renewed" as const, row: requireWokenRow(ctx, request.durable_id) }
      : LOST_LEASE,
  )
}

/**
 * Takes over a row whose lease ran out. The previous owner is probed BEFORE the lock (the probe can be slow), with the
 * probe `reconcile` uses for a claimant; the write then requires the generation that was judged.
 */
async function takeOverWake(ctx: ops.StoreContext, request: Timed<WokenSessionKey>): Promise<WakeTakeOverOutcome> {
  const seen = selectWokenRow(ctx, request.durable_id)
  if (seen === undefined) return { kind: "not_found" }
  if (seen.lease_owner === null || seen.lease_expires_at === null) return { kind: "not_leased", row: seen }
  if (seen.lease_expires_at > request.now) return { kind: "lease_live", row: seen }
  const previousOwnerAlive = !(await isClaimantDead(seen.lease_owner))
  return await ops.transaction(ctx, "woken_take_over", (): WakeTakeOverOutcome => {
    const current = selectWokenRow(ctx, request.durable_id)
    if (current === undefined) return { kind: "not_found" }
    if (current.generation !== seen.generation) return LOST_LEASE
    if (current.lease_expires_at !== null && current.lease_expires_at > request.now)
      return { kind: "lease_live", row: current }
    fenced(ctx, current, "lease_owner = ?, lease_expires_at = ?, generation = generation + 1", [
      JSON.stringify(ctx.self),
      request.now + WAKE_LEASE_MS,
    ])
    return {
      kind: "taken_over",
      row: requireWokenRow(ctx, request.durable_id),
      previous_owner_alive: previousOwnerAlive,
    }
  })
}

async function setWokenState(
  ctx: ops.StoreContext,
  request: Timed<WokenStateRequest>,
): Promise<{ readonly kind: "ok"; readonly row: WokenSessionRow } | LostLease> {
  return await ops.transaction(ctx, "woken_set_state", () => {
    const opened = request.state === "open" ? request.now : null
    const written = fenced(
      ctx,
      request,
      "state = ?, opened_at = COALESCE(opened_at, ?), host_instance = COALESCE(?, host_instance)",
      [request.state, opened, request.host_instance ?? null],
    )
    return written ? { kind: "ok" as const, row: requireWokenRow(ctx, request.durable_id) } : LOST_LEASE
  })
}

async function recordWaiting(
  ctx: ops.StoreContext,
  request: Timed<WokenSessionFence>,
): Promise<{ readonly kind: "ok"; readonly row: WokenSessionRow } | LostLease> {
  return await ops.transaction(ctx, "woken_record_waiting", () =>
    fenced(ctx, request, "first_waiting_at = COALESCE(first_waiting_at, ?)", [request.now])
      ? { kind: "ok" as const, row: requireWokenRow(ctx, request.durable_id) }
      : LOST_LEASE,
  )
}

/** A transient open failure (A3.1.5): back to `requested` with the next attempt's time, or deleted at the last attempt. */
async function retryWakeLater(ctx: ops.StoreContext, request: Timed<WokenSessionFence>): Promise<WakeRetryOutcome> {
  return await ops.transaction(ctx, "woken_retry_later", (): WakeRetryOutcome => {
    const row = selectWokenRow(ctx, request.durable_id)
    if (row === undefined || row.generation !== request.generation) return LOST_LEASE
    const attempts = row.attempts + 1
    if (attempts >= WAKE_MAX_ATTEMPTS) {
      ops.write(ctx, "DELETE FROM woken_sessions WHERE durable_id = ? AND generation = ?", [
        request.durable_id,
        request.generation,
      ])
      touchWakeMarker(ctx, request.durable_id, request.now)
      return { kind: "failed", attempts }
    }
    fenced(
      ctx,
      request,
      "state = 'requested', lease_owner = NULL, lease_expires_at = NULL, attempts = ?, next_attempt_at = ?",
      [attempts, request.now + WAKE_RETRY_DELAY_MS],
    )
    return { kind: "deferred", row: requireWokenRow(ctx, request.durable_id) }
  })
}

async function endWake(
  ctx: ops.StoreContext,
  request: Timed<WokenSessionFence>,
): Promise<{ readonly kind: "ended" } | LostLease> {
  return await ops.transaction(ctx, "woken_end", () => {
    const deleted = ops.write(ctx, "DELETE FROM woken_sessions WHERE durable_id = ? AND generation = ?", [
      request.durable_id,
      request.generation,
    ])
    if (deleted !== 1) return LOST_LEASE
    touchWakeMarker(ctx, request.durable_id, request.now)
    return { kind: "ended" as const }
  })
}

function isGated(ctx: ops.StoreContext, request: Timed<WokenSessionKey>): boolean {
  const row = selectWokenRow(ctx, request.durable_id)
  return row?.state === "opening" && row.lease_expires_at !== null && row.lease_expires_at > request.now
}

function listWoken(ctx: ops.StoreContext): WokenSessionRow[] {
  return ctx.sql
    .all(WOKEN_COLUMNS, `SELECT ${WOKEN_COLUMNS.join(", ")} FROM woken_sessions`, [], "requested_at, durable_id")
    .map(wokenRowFrom)
}

type WokenRequest<K extends keyof WokenSessionStore> = Parameters<WokenSessionStore[K]>[0] & { readonly now: number }

/** The woken-session ops (#13037 A3.1): kept inside the worker, like the intake op, so no module gains worker-only exports. */
async function dispatchWoken(ctx: ops.StoreContext, op: string, args: unknown): Promise<unknown> {
  switch (op) {
    case "woken_request":
      return await requestWake(ctx, args as WokenRequest<"request">)
    case "woken_start":
      return await startWake(ctx, args as WokenRequest<"start">)
    case "woken_renew":
      return await renewLease(ctx, args as WokenRequest<"renew">)
    case "woken_take_over":
      return await takeOverWake(ctx, args as WokenRequest<"takeOver">)
    case "woken_set_state":
      return await setWokenState(ctx, args as WokenRequest<"setState">)
    case "woken_record_waiting":
      return await recordWaiting(ctx, args as WokenRequest<"recordWaiting">)
    case "woken_retry_later":
      return await retryWakeLater(ctx, args as WokenRequest<"retryLater">)
    case "woken_end":
      return await endWake(ctx, args as WokenRequest<"end">)
    case "woken_gated":
      return isGated(ctx, args as WokenRequest<"gated">)
    case "woken_list":
      return listWoken(ctx)
    default:
      throw new Error(`unknown gateway store op ${op}`)
  }
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
  if (op.startsWith("woken_")) return await dispatchWoken(ctx, op, args)
  switch (op) {
    case "extension_register": {
      const request = args as {
        readonly extension: StoreExtensionRegistration
        readonly now: number
        readonly restored_at?: number
      }
      lastExtensionActivity = request.extension.name
      const result = await extensions?.register(request.extension, request.now, request.restored_at)
      return { result, retained: extensions?.holds(request.extension) === true }
    }
    case "extension_call":
    case "extension_session_call": {
      const request = args as {
        readonly name: string
        readonly op: string
        readonly args: unknown
        readonly now: number
      }
      lastExtensionActivity = request.name
      try {
        if (extensions === undefined) return undefined
        return op === "extension_call"
          ? await extensions.call(request.name, request.op, request.args, request.now)
          : await sessions.sessionCall(ctx, extensions, args as sessions.SessionCallRequest)
      } finally {
        for (const pending of resolutions.values()) pending.reject(new ExtensionTransactionEndedError(request.name))
        resolutions.clear()
        for (const pending of provenanceRequests.values())
          pending.reject(new ExtensionTransactionEndedError(request.name))
        provenanceRequests.clear()
      }
    }
    case "session_callable_ops":
      return listSessionOps(ctx)
    case "record_thread_creation":
      return await sessions.recordThreadCreation(ctx, args as Parameters<typeof sessions.recordThreadCreation>[1])
    case "enqueue":
      return await ops.enqueue(ctx, args as Parameters<typeof ops.enqueue>[1])
    case "intake":
      return await intake(ctx, args as IntakeRequest)
    case "reconcile":
      return await ops.reconcile(ctx, args as Parameters<typeof ops.reconcile>[1])
    case "claim":
      return await ops.claim(ctx, args as Parameters<typeof ops.claim>[1])
    case "record_outcome":
      return await ops.recordOutcome(ctx, args as Parameters<typeof ops.recordOutcome>[1])
    case "refuse_queued":
      return await ops.refuseQueued(ctx, args as Parameters<typeof ops.refuseQueued>[1])
    case "complete_receipt":
      return await ops.completeReceipt(ctx, args as Parameters<typeof ops.completeReceipt>[1])
    case "abandon_receipt":
      return await ops.abandonReceipt(ctx, args as Parameters<typeof ops.abandonReceipt>[1])
    case "delivery_view":
      return ops.deliveryView(ctx, args as string)
    case "delivery_receipt":
      return ops.deliveryReceipt(ctx, args as Parameters<typeof ops.deliveryReceipt>[1])
    case "recover_delivery":
      return await ops.recoverDelivery(ctx, args as Parameters<typeof ops.recoverDelivery>[1])
    case "list":
      return ops.listDeliveries(ctx, args as Parameters<typeof ops.listDeliveries>[1])
    case "is_referenced":
      return ops.isReferenced(ctx, args as string)
    case "journal_mode":
      return ops.journalMode(ctx)
    case "stats":
      return ops.stats(ctx)
    case "tool_receipt_begin":
      return await relay.toolReceiptBegin(ctx, args as Parameters<typeof relay.toolReceiptBegin>[1])
    case "tool_receipt_settle":
      return await relay.toolReceiptSettle(ctx, args as Parameters<typeof relay.toolReceiptSettle>[1])
    case "tool_receipt_revise":
      return await relay.toolReceiptRevise(ctx, args as Parameters<typeof relay.toolReceiptRevise>[1])
    case "bind":
      return await relay.bindThread(ctx, args as Parameters<typeof relay.bindThread>[1])
    case "unbind":
      return await relay.unbindThread(ctx, args as Parameters<typeof relay.unbindThread>[1])
    case "rebind":
      return await relay.rebindThread(ctx, args as Parameters<typeof relay.rebindThread>[1])
    case "list_bindings":
      return await relay.listBindings(ctx, args as Parameters<typeof relay.listBindings>[1])
    case "binding_view":
      return await relay.bindingView(ctx, args as Parameters<typeof relay.bindingView>[1])
    case "register_incarnation":
      return await ownership.registerIncarnation(ctx, args as Parameters<typeof ownership.registerIncarnation>[1])
    case "clear_endpoint":
      return await ownership.clearEndpoint(ctx, args as Parameters<typeof ownership.clearEndpoint>[1])
    case "session_owner":
      return ownership.sessionOwner(ctx, args as string)
    case "report":
      return await relay.reportEvent(ctx, args as Parameters<typeof relay.reportEvent>[1])
    case "emit_completions":
      return await relay.emitCompletions(ctx, args as Parameters<typeof relay.emitCompletions>[1])
    case "pending_completion_arms":
      return relay.pendingCompletionArms(ctx, args as string)
    case "latest_completion_arm":
      return relay.latestCompletionArm(ctx, args as string)
    case "read_outbox":
      return await relay.readOutbox(ctx, args as Parameters<typeof relay.readOutbox>[1])
    case "ack_outbox":
      return await relay.ackOutbox(ctx, args as Parameters<typeof relay.ackOutbox>[1])
    case "claim_answer":
      return await relay.claimAnswer(ctx, args as Parameters<typeof relay.claimAnswer>[1])
    case "release_answer":
      return await relay.releaseAnswer(ctx, args as Parameters<typeof relay.releaseAnswer>[1])
    case "confirm_answer":
      return await relay.confirmAnswer(ctx, args as Parameters<typeof relay.confirmAnswer>[1])
    case "mark_prior_delivered":
      return await relay.markPriorDelivered(ctx, args as Parameters<typeof relay.markPriorDelivered>[1])
    case "close_question":
      return await relay.closeQuestion(ctx, args as Parameters<typeof relay.closeQuestion>[1])
    default:
      throw new Error(`unknown gateway store op: ${op}`)
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
  const self = {
    pid: process.pid,
    process_start_time: await processStartTime(process.pid),
    instance_id: config.instance_id,
    runtime_instance: config.runtime_instance,
  }
  context = {
    sql,
    config,
    self,
    stats: { writes: 0, marker_unlinks: 0, transactions: 0 },
    emit,
    hook: runHook,
    delay: (ms) => delay(ms),
  }
  try {
    await ops.migrate(context)
    extensions = new StoreExtensions(context, resolveTarget, senderProvenance)
    const legacy = await ops.migrateLegacyMailboxes(context, request.now)
    context.stats.writes = 0
    context.stats.transactions = 0
    context.stats.marker_unlinks = 0
    return { self, legacy_migrated: legacy }
  } catch (error) {
    // A failed open must not leave the store's database held: the caller's retry opens a fresh
    // worker, and a reader reopening the file must find it free. Roll back any half-open
    // transaction, close the connection, and only then let the error cross the worker boundary.
    // The parent terminates this worker when the init reply fails, so its lifetime ends here.
    try {
      connection.exec("ROLLBACK")
    } catch {
      // No transaction was open; the connection still closes.
    }
    try {
      connection.close()
    } finally {
      connection = undefined
      context = undefined
      emit({ kind: "store_closed" })
    }
    throw error
  }
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
