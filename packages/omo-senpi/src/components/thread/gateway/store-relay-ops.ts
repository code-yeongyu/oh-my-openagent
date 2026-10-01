/**
 * The relay half of the store: tool receipts, bindings, the outbox and reply tokens. Loaded only in
 * the store worker, like `store-ops.ts`. Every operation is one `BEGIN IMMEDIATE` transaction that
 * first moves due bindings to `expired`, so an expiry is decided in the same transaction as the
 * call or dispatch that observes it. Relay operations that carry an idempotency key record their
 * receipt in that same transaction: a replay returns the stored result, a different payload under
 * the same key is `idempotency_conflict`, and a refusal writes no receipt.
 */
import { randomUUID } from "node:crypto"
import { renameSync, writeFileSync } from "node:fs"

import {
  type BindingRecord,
  type BindRequest,
  BINDINGS_PAGE_DEFAULT,
  BINDINGS_PAGE_MAX,
  type CompletionOutcome,
  decodeBindingsCursor,
  encodeBindingsCursor,
  mintReplyToken,
  newBindingId,
  OUTBOX_PAGE_DEFAULT,
  OUTBOX_PAGE_MAX,
  OUTBOX_RETENTION_MS,
  type OutboundEvent,
  type OutboxRow,
  readReplyToken,
  type RelayOutcome,
  rfc3339,
} from "./bindings"
import { answerShape, isUiRequestKind, type UiRequestKind } from "./answer-shape"
import { GATEWAY_RECEIPT_RETENTION_MS } from "./constants"
import type { SqlRow, SqlValue } from "./sql"
import { gatewayOutboxMarkerPath } from "./paths"
import { OPEN_STATES, type StoreContext, transaction, unlinkMarker, write } from "./store-ops"
import { deleteExpiredReceipt, sweepRetentionIfDue } from "./store-retention"
import type { ExternalAuthor, StoreRefusal } from "./types"

const BINDING_COLUMNS = [
  "binding_id", "schema_version", "revision", "status", "platform", "account_id", "chat_id", "thread_id", "root_message_id",
  "progress_message_id", "session_realm_id", "session_durable_id", "direction_inbound", "direction_outbound", "inbound_mode",
  "outbound_events", "policy_id", "created_at", "updated_at", "lease_started_at", "ttl_seconds", "expires_at",
] as const

const OUTBOX_COLUMNS = [
  "cursor", "binding_id", "revision", "event_kind", "payload", "state", "provider_message_id", "created_at", "reply_token",
  "question_state", "outcome", "answered_by",
] as const

function refused(code: StoreRefusal["code"], message: string, details?: Readonly<Record<string, unknown>>): StoreRefusal {
  return { kind: "refused", code, message, ...(details === undefined ? {} : { details }) }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function authorColumn(author: ExternalAuthor | null | undefined): string | null {
  return author === null || author === undefined ? null : JSON.stringify(author)
}

function authorFromColumn(value: unknown): ExternalAuthor | null {
  return value === null || value === undefined ? null : (JSON.parse(String(value)) as ExternalAuthor)
}

/**
 * The outbox wake hint, rewritten after every outbox insert while the insert's write lock is held:
 * a temp file renamed over `outbox.marker`, so a watcher of the gateway directory never sees it half
 * written. Like the inbox marker it is only ever early - a reader's own transaction waits for this
 * one - and a rolled-back insert leaves a spurious wake, never a missed one.
 */
function touchOutboxMarker(ctx: StoreContext, bindingId: string, cursor: number, now: number): void {
  const marker = gatewayOutboxMarkerPath(ctx.config.agent_dir)
  const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify({ binding_id: bindingId, cursor, written_at: rfc3339(now) }), { mode: 0o600 })
  renameSync(temporary, marker)
}

function bindingFrom(record: SqlRow): BindingRecord {
  return {
    schema_version: 1,
    binding_id: String(record.binding_id),
    revision: Number(record.revision),
    status: record.status as BindingRecord["status"],
    platform: record.platform as BindingRecord["platform"],
    account_id: String(record.account_id),
    chat_id: String(record.chat_id),
    thread_id: String(record.thread_id),
    root_message_id: nullableString(record.root_message_id),
    progress_message_id: nullableString(record.progress_message_id),
    session_realm_id: String(record.session_realm_id),
    session_durable_id: String(record.session_durable_id),
    direction: { inbound: Number(record.direction_inbound) === 1, outbound: Number(record.direction_outbound) === 1 },
    inbound_mode: record.inbound_mode as BindingRecord["inbound_mode"],
    outbound_events: JSON.parse(String(record.outbound_events)) as OutboundEvent[],
    policy_id: String(record.policy_id),
    created_at: String(record.created_at),
    updated_at: String(record.updated_at),
    lease_started_at: String(record.lease_started_at),
    ttl_seconds: record.ttl_seconds === null || record.ttl_seconds === undefined ? null : Number(record.ttl_seconds),
    expires_at: nullableString(record.expires_at),
  }
}

function selectBindings(ctx: StoreContext, where: string, params: readonly SqlValue[], page?: { readonly orderBy: string; readonly limit: number }): BindingRecord[] {
  const sql = `SELECT ${BINDING_COLUMNS.join(", ")} FROM bindings WHERE ${where}${page === undefined ? "" : ` ORDER BY ${page.orderBy} LIMIT ?`}`
  return ctx.sql.all(BINDING_COLUMNS, sql, page === undefined ? params : [...params, page.limit], page?.orderBy).map(bindingFrom)
}

function selectBinding(ctx: StoreContext, bindingId: string): BindingRecord | undefined {
  return selectBindings(ctx, "binding_id = ?", [bindingId])[0]
}

function meta(ctx: StoreContext, key: string): string {
  const found = ctx.sql.one(["value"], "SELECT value FROM gateway_meta WHERE key = ?", [key])
  if (found === undefined) throw new Error(`gateway_meta ${key} is missing`)
  return String(found.value)
}

function expireDue(ctx: StoreContext, now: number): void {
  const at = rfc3339(now)
  write(ctx, "UPDATE bindings SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?", [at, at])
}

function pruneOutbox(ctx: StoreContext, now: number): void {
  write(ctx, "DELETE FROM outbox WHERE state = 'acked' AND acked_at IS NOT NULL AND acked_at <= ?", [now - OUTBOX_RETENTION_MS])
  write(
    ctx,
    "DELETE FROM outbox WHERE state = 'pending' AND binding_id IN (SELECT binding_id FROM bindings WHERE status != 'active' AND updated_at <= ?)",
    [rfc3339(now - OUTBOX_RETENTION_MS)],
  )
}

type ReceiptKey = { readonly principal: string; readonly operation: string; readonly idempotency_key: string; readonly args_hash: string }

type StoredReceipt = { readonly args_hash: string; readonly status: string; readonly owner_instance: string; readonly result: string | null }

function selectReceipt(ctx: StoreContext, key: Omit<ReceiptKey, "args_hash">): StoredReceipt | undefined {
  const found = ctx.sql.one(
    ["args_hash", "status", "owner_instance", "result"],
    "SELECT args_hash, status, owner_instance, result FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?",
    [key.principal, key.operation, key.idempotency_key],
  )
  if (found === undefined) return undefined
  return { args_hash: String(found.args_hash), status: String(found.status), owner_instance: String(found.owner_instance), result: nullableString(found.result) }
}

function priorOutcome<T>(ctx: StoreContext, key: ReceiptKey | null, now: number): RelayOutcome<T> | undefined {
  if (key === null) return undefined
  deleteExpiredReceipt(ctx, key, now)
  const receipt = selectReceipt(ctx, key)
  if (receipt === undefined) return undefined
  if (receipt.args_hash !== key.args_hash) return refused("idempotency_conflict", "The idempotency key was already used with different arguments.")
  if (receipt.status === "completed" && receipt.result !== null) return { ...(JSON.parse(receipt.result) as object), kind: "ok", deduplicated: true } as unknown as RelayOutcome<T>
  return refused("idempotency_uncertain", "An earlier call under this key did not record its outcome.")
}

function recordOutcome(ctx: StoreContext, key: ReceiptKey | null, now: number, result: unknown): void {
  if (key === null) return
  write(
    ctx,
    "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, result, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, 'completed', NULL, ?, ?, ?, ?, ?)",
    [key.principal, key.operation, key.idempotency_key, key.args_hash, ctx.config.instance_id, JSON.stringify(result), now, now, now + GATEWAY_RECEIPT_RETENTION_MS],
  )
}

/** A relay mutation: expiry, the receipt check, the body, and the receipt of a success, all in one transaction. */
async function relayMutation<T extends object>(ctx: StoreContext, op: string, now: number, key: ReceiptKey | null, body: () => RelayOutcome<T>): Promise<RelayOutcome<T>> {
  return await transaction(ctx, op, () => {
    expireDue(ctx, now)
    const prior = priorOutcome<T>(ctx, key, now)
    if (prior !== undefined) return prior
    const outcome = body()
    if (outcome.kind === "ok") recordOutcome(ctx, key, now, { ...outcome, deduplicated: false })
    // After the body, so what this call just wrote protects the rows it references.
    sweepRetentionIfDue(ctx, now)
    return outcome.kind === "ok" ? ({ ...outcome, deduplicated: false } as RelayOutcome<T>) : outcome
  })
}

export type ToolReceiptBegin =
  | { readonly kind: "accepted" }
  | { readonly kind: "replay"; readonly result: unknown }
  | { readonly kind: "conflict" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "uncertain"; readonly error_note: string | null }

/**
 * `prepared` before the side effect, `completed` with its result after, `uncertain` when it threw.
 * A prepared receipt of ANOTHER instance means that process died mid-call: the effect may have
 * landed, so the receipt becomes `uncertain` and is never retried (the mailbox-era file receipts'
 * semantics, now in the gateway's `receipts` table). The admission also runs the bounded retention
 * sweep when one is due, so traffic made only of peer tool calls still drains expired receipts.
 */
export async function toolReceiptBegin(ctx: StoreContext, request: ReceiptKey & { readonly now: number }): Promise<ToolReceiptBegin> {
  return await transaction(ctx, "tool_receipt_begin", (): ToolReceiptBegin => {
    const admission = admitToolReceipt(ctx, request)
    // After the admission, so the receipt this call just wrote or read is not what the sweep removes.
    sweepRetentionIfDue(ctx, request.now)
    return admission
  })
}

function admitToolReceipt(ctx: StoreContext, request: ReceiptKey & { readonly now: number }): ToolReceiptBegin {
  deleteExpiredReceipt(ctx, request, request.now)
  const receipt = selectReceipt(ctx, request)
  if (receipt === undefined) {
    write(
      ctx,
      "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, 'prepared', NULL, ?, ?, ?, ?)",
      [request.principal, request.operation, request.idempotency_key, request.args_hash, ctx.config.instance_id, request.now, request.now, request.now + GATEWAY_RECEIPT_RETENTION_MS],
    )
    return { kind: "accepted" }
  }
  if (receipt.args_hash !== request.args_hash) return { kind: "conflict" }
  if (receipt.status === "completed") return { kind: "replay", result: receipt.result === null ? null : JSON.parse(receipt.result) }
  if (receipt.status === "prepared" && receipt.owner_instance === ctx.config.instance_id) return { kind: "in_progress" }
  if (receipt.status === "prepared") {
    write(ctx, "UPDATE receipts SET status = 'uncertain', error_note = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ?", [
      "the process that began this call ended before recording its outcome", request.now, request.principal, request.operation, request.idempotency_key,
    ])
  }
  const note = ctx.sql.one(["error_note"], "SELECT error_note FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?", [request.principal, request.operation, request.idempotency_key])
  return { kind: "uncertain", error_note: nullableString(note?.error_note) }
}

export async function toolReceiptSettle(
  ctx: StoreContext,
  request: Omit<ReceiptKey, "args_hash"> & { readonly now: number } & ({ readonly result: unknown } | { readonly error_note: string }),
): Promise<boolean> {
  return await transaction(ctx, "tool_receipt_settle", () => {
    const completed = "result" in request
    return write(
      ctx,
      `UPDATE receipts SET status = ?, ${completed ? "result" : "error_note"} = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?`,
      [completed ? "completed" : "uncertain", completed ? JSON.stringify(request.result) : request.error_note, request.now, request.principal, request.operation, request.idempotency_key, ctx.config.instance_id],
    ) === 1
  })
}

export type BindOpRequest = { readonly now: number; readonly receipt: ReceiptKey | null; readonly binding: BindRequest }

export async function bindThread(ctx: StoreContext, request: BindOpRequest): Promise<RelayOutcome<{ readonly binding: BindingRecord }>> {
  const wanted = request.binding
  return await relayMutation(ctx, "bind", request.now, request.receipt, () => {
    const holder = selectBindings(ctx, "platform = ? AND account_id = ? AND chat_id = ? AND thread_id = ? AND status = 'active'", [wanted.platform, wanted.account_id, wanted.chat_id, wanted.thread_id])[0]
    if (holder !== undefined) {
      const same = holder.session_durable_id === wanted.session_durable_id
      return refused(
        "binding_conflict",
        same ? "This thread is already bound to that session." : "This thread is bound to another session; rebind it explicitly to move it.",
        { binding_id: holder.binding_id, revision: holder.revision, session: holder.session_durable_id },
      )
    }
    const at = rfc3339(request.now)
    const binding: BindingRecord = {
      schema_version: 1,
      binding_id: newBindingId(),
      revision: 1,
      status: "active",
      platform: wanted.platform,
      account_id: wanted.account_id,
      chat_id: wanted.chat_id,
      thread_id: wanted.thread_id,
      root_message_id: wanted.root_message_id,
      progress_message_id: wanted.progress_message_id,
      session_realm_id: meta(ctx, "realm_id"),
      session_durable_id: wanted.session_durable_id,
      direction: wanted.direction,
      inbound_mode: wanted.inbound_mode,
      outbound_events: wanted.outbound_events,
      policy_id: wanted.policy_id,
      created_at: at,
      updated_at: at,
      lease_started_at: at,
      ttl_seconds: wanted.ttl_seconds,
      expires_at: wanted.ttl_seconds === null ? null : rfc3339(request.now + wanted.ttl_seconds * 1000),
    }
    write(ctx, `INSERT INTO bindings (${BINDING_COLUMNS.join(", ")}) VALUES (${BINDING_COLUMNS.map(() => "?").join(", ")})`, [
      binding.binding_id, binding.schema_version, binding.revision, binding.status, binding.platform, binding.account_id, binding.chat_id,
      binding.thread_id, binding.root_message_id, binding.progress_message_id, binding.session_realm_id, binding.session_durable_id,
      binding.direction.inbound ? 1 : 0, binding.direction.outbound ? 1 : 0, binding.inbound_mode, JSON.stringify(binding.outbound_events),
      binding.policy_id, binding.created_at, binding.updated_at, binding.lease_started_at, binding.ttl_seconds, binding.expires_at,
    ])
    return { kind: "ok", binding }
  })
}

function inFlight(ctx: StoreContext, bindingId: string): string[] {
  return ctx.sql.all(["delivery_id"], `SELECT delivery_id, seq FROM deliveries WHERE binding_id = ? AND state IN ${OPEN_STATES}`, [bindingId], "seq").map((row) => String(row.delivery_id))
}

export type CasRequest = { readonly now: number; readonly receipt: ReceiptKey | null; readonly binding_id: string; readonly expected_revision: number }

/** CAS detach. A binding that is already closed answers success again, with its current state. */
export async function unbindThread(ctx: StoreContext, request: CasRequest): Promise<RelayOutcome<{ readonly binding: BindingRecord; readonly already_closed: boolean; readonly in_flight: readonly string[] }>> {
  return await relayMutation(ctx, "unbind", request.now, request.receipt, () => {
    const current = selectBinding(ctx, request.binding_id)
    if (current === undefined) return refused("not_found", "No binding has this id.", { binding_id: request.binding_id })
    if (current.status !== "active") return { kind: "ok", binding: current, already_closed: true, in_flight: inFlight(ctx, current.binding_id) }
    if (current.revision !== request.expected_revision) return refused("stale_revision", "The binding changed since that revision.", { binding_id: current.binding_id, revision: current.revision })
    const at = rfc3339(request.now)
    write(ctx, "UPDATE bindings SET status = 'detached', revision = revision + 1, updated_at = ? WHERE binding_id = ? AND revision = ?", [at, current.binding_id, current.revision])
    write(ctx, "DELETE FROM completion_arms WHERE binding_id = ?", [current.binding_id])
    return { kind: "ok", binding: selectBinding(ctx, current.binding_id) as BindingRecord, already_closed: false, in_flight: inFlight(ctx, current.binding_id) }
  })
}

/**
 * CAS move to another session. Work queued under the old revision is closed with a refusal
 * (`binding_closed`, its inbox marker removed) and never moved: the new session starts clean, and
 * the connector sees the refusal on the sender's result.
 */
export async function rebindThread(ctx: StoreContext, request: CasRequest & { readonly session_durable_id: string }): Promise<RelayOutcome<{ readonly binding: BindingRecord; readonly closed: readonly string[] }>> {
  return await relayMutation(ctx, "rebind", request.now, request.receipt, () => {
    const current = selectBinding(ctx, request.binding_id)
    if (current === undefined) return refused("not_found", "No binding has this id.", { binding_id: request.binding_id })
    if (current.status !== "active") return refused("binding_inactive", `The binding is ${current.status}.`, { binding_id: current.binding_id, status: current.status })
    if (current.revision !== request.expected_revision) return refused("stale_revision", "The binding changed since that revision.", { binding_id: current.binding_id, revision: current.revision })
    if (current.session_durable_id === request.session_durable_id) return refused("invalid_arguments", "The binding is already attached to that session.", { binding_id: current.binding_id })
    const at = rfc3339(request.now)
    const closed = ctx.sql
      .all(["delivery_id", "target"], "SELECT delivery_id, target_durable_id AS target, seq FROM deliveries WHERE binding_id = ? AND binding_revision = ? AND state = 'queued'", [current.binding_id, current.revision], "seq")
      .map((row) => ({ delivery_id: String(row.delivery_id), target: String(row.target) }))
    for (const row of closed) {
      write(ctx, "UPDATE deliveries SET state = 'refused', reason = 'binding_closed', updated_at = ? WHERE delivery_id = ? AND state = 'queued'", [request.now, row.delivery_id])
      unlinkMarker(ctx, row.target, row.delivery_id)
    }
    write(ctx, "UPDATE bindings SET session_durable_id = ?, revision = revision + 1, lease_started_at = ?, updated_at = ? WHERE binding_id = ? AND revision = ?", [
      request.session_durable_id, at, at, current.binding_id, current.revision,
    ])
    write(ctx, "DELETE FROM completion_arms WHERE binding_id = ?", [current.binding_id])
    return { kind: "ok", binding: selectBinding(ctx, current.binding_id) as BindingRecord, closed: closed.map((row) => row.delivery_id) }
  })
}

export type BindingsFilter = {
  readonly session_durable_id?: string
  readonly platform?: string
  readonly account_id?: string
  readonly chat_id?: string
  readonly thread_id?: string
  readonly status?: string
}

export async function listBindings(
  ctx: StoreContext,
  request: { readonly now: number; readonly filter: BindingsFilter; readonly cursor?: string; readonly limit?: number },
): Promise<RelayOutcome<{ readonly bindings: readonly BindingRecord[]; readonly next_cursor: string | null }>> {
  const decoded = request.cursor === undefined ? null : decodeBindingsCursor(request.cursor)
  if (request.cursor !== undefined && decoded === null) return refused("cursor_invalid", "The bindings cursor is not one this gateway issued.")
  const limit = Math.min(Math.max(request.limit ?? BINDINGS_PAGE_DEFAULT, 1), BINDINGS_PAGE_MAX)
  return await transaction(ctx, "list_bindings", () => {
    expireDue(ctx, request.now)
    const asOf = decoded?.as_of ?? Number(ctx.sql.one(["m"], "SELECT COALESCE(MAX(rowid), 0) AS m FROM bindings")?.m ?? 0)
    const clauses = ["rowid <= ?"]
    const params: SqlValue[] = [asOf]
    const columns: readonly (readonly [keyof BindingsFilter, string])[] = [
      ["session_durable_id", "session_durable_id"], ["platform", "platform"], ["account_id", "account_id"], ["chat_id", "chat_id"], ["thread_id", "thread_id"], ["status", "status"],
    ]
    for (const [field, column] of columns) {
      const value = request.filter[field]
      if (value === undefined) continue
      clauses.push(`${column} = ?`)
      params.push(value)
    }
    if (decoded?.after != null) {
      clauses.push("(created_at > ? OR (created_at = ? AND binding_id > ?))")
      params.push(decoded.after[0], decoded.after[0], decoded.after[1])
    }
    // One row past the page says whether another page follows.
    const page = selectBindings(ctx, clauses.join(" AND "), params, { orderBy: "created_at, binding_id", limit: limit + 1 })
    const bindings = page.slice(0, limit)
    const last = bindings.at(-1)
    return { kind: "ok", bindings, next_cursor: page.length > limit && last !== undefined ? encodeBindingsCursor(asOf, [last.created_at, last.binding_id]) : null }
  })
}

export async function bindingView(ctx: StoreContext, request: { readonly now: number; readonly binding_id: string }): Promise<BindingRecord | null> {
  return await transaction(ctx, "binding_view", () => {
    expireDue(ctx, request.now)
    return selectBinding(ctx, request.binding_id) ?? null
  })
}

/** Records which runtime holds a session now; a reply token minted under an earlier incarnation goes stale. */
export async function registerIncarnation(ctx: StoreContext, request: { readonly durable_id: string; readonly incarnation: string }): Promise<void> {
  await transaction(ctx, "register_incarnation", () => {
    write(
      ctx,
      "INSERT INTO session_meta (durable_id, next_seq, incarnation) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM deliveries WHERE target_durable_id = ?), ?) ON CONFLICT(durable_id) DO UPDATE SET incarnation = excluded.incarnation",
      [request.durable_id, request.durable_id, request.incarnation],
    )
  })
}

function incarnationOf(ctx: StoreContext, durableId: string): string | null {
  return nullableString(ctx.sql.one(["incarnation"], "SELECT incarnation FROM session_meta WHERE durable_id = ?", [durableId])?.incarnation)
}

export type ReportOpRequest = {
  readonly now: number
  readonly receipt: ReceiptKey | null
  readonly session_durable_id: string
  /** null: the binding of `origin_delivery_ids`, else the session's only active outbound binding (`reportBindingDefault`). */
  readonly binding_id: string | null
  /** The deliveries the reporter's current answer is for, when the reporter knows them (the `thread_report` tool does; the CLI does not): empty when none. */
  readonly origin_delivery_ids: readonly string[]
  /** A `user` message (typed in the reporter's terminal, or an extension's) is part of the same answer: with a bound message there and another outbound binding, the origin is ambiguous and refused. */
  readonly origin_local_input?: boolean
  readonly event: OutboundEvent
  readonly text: string
  readonly ui_request_id: string | null
  /** For a question: the kind of the session's pending request; null when the session declared none. */
  readonly ui_request_kind: UiRequestKind | null
}

export type ReportOpResult = {
  readonly binding_id: string
  readonly revision: number
  readonly event: OutboundEvent
  /** The outbox row written; null for a completion, which is only armed here. */
  readonly cursor: number | null
  readonly reply_token: string | null
  readonly armed: boolean
}

/**
 * The binding a report without `binding_id` goes to: the binding of the messages the reporter's
 * current answer is for, so a message from another thread queued behind the run never takes it over,
 * and a queued follow-up the session answers next is answered in its own thread. Messages from two
 * bound threads in one answer refuse, and so does a bound message answered together with a `user`
 * message (a prompt typed in the terminal, or an extension's `sendUserMessage` such as an ask_user
 * answer) when that input could be answered elsewhere: the session has an active outbound binding
 * other than the bound message's. With the bound message's binding as the only outbound one, both
 * inputs can only be answered there, so the report goes to it. Without a bound message, the session's one active outbound binding; with several, the caller must
 * name one. Never a guess between bindings.
 */
function reportBindingDefault(ctx: StoreContext, sessionDurableId: string, originDeliveryIds: readonly string[], localInput: boolean): { readonly binding_id: string } | StoreRefusal {
  const origins = [...new Set(originDeliveryIds.flatMap((deliveryId) => {
    const row = ctx.sql.one(["binding_id"], "SELECT binding_id FROM deliveries WHERE delivery_id = ? AND target_durable_id = ?", [deliveryId, sessionDurableId])
    const bindingId = nullableString(row?.binding_id)
    return bindingId === null ? [] : [bindingId]
  }))].sort()
  const outbound = ctx.sql
    .all(["binding_id"], "SELECT binding_id FROM bindings WHERE session_durable_id = ? AND status = 'active' AND direction_outbound = 1", [sessionDurableId], "binding_id")
    .map((row) => String(row.binding_id))
  const [origin, ...otherOrigins] = origins
  if (origin !== undefined && otherOrigins.length > 0) return refused("invalid_arguments", `This session's current run answers messages from ${origins.length} bound threads; name binding_id.`, { binding_ids: origins })
  if (origin !== undefined && localInput && outbound.some((id) => id !== origin)) return refused("invalid_arguments", "This session's current run answers a bound thread's message and a user message (typed in its terminal or sent by an extension) together; name binding_id.", { binding_ids: outbound })
  if (origin !== undefined) return { binding_id: origin }
  const [only, ...others] = outbound
  if (only !== undefined && others.length === 0) return { binding_id: only }
  if (only === undefined) return refused("invalid_arguments", "This session has no active outbound binding and its current run answers no bound message; name binding_id.")
  return refused("invalid_arguments", `This session has ${outbound.length} active outbound bindings and its current run answers no bound message; name binding_id.`, { binding_ids: outbound })
}

function insertOutbox(ctx: StoreContext, row: { readonly binding: BindingRecord; readonly event: OutboundEvent; readonly text: string; readonly now: number; readonly reply_token?: string; readonly ui_request_id?: string; readonly ui_request_kind?: UiRequestKind; readonly incarnation?: string | null; readonly outcome?: CompletionOutcome }): number {
  write(
    ctx,
    "INSERT INTO outbox (binding_id, revision, event_kind, payload, state, provider_message_id, created_at, acked_at, session_durable_id, reply_token, ui_request_id, ui_request_kind, incarnation, question_state, answer, answered_at, outcome) VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
    [
      row.binding.binding_id, row.binding.revision, row.event, JSON.stringify({ text: row.text }), row.now, row.binding.session_durable_id,
      row.reply_token ?? null, row.ui_request_id ?? null, row.ui_request_kind ?? null, row.incarnation ?? null, row.reply_token === undefined ? null : "pending", row.outcome ?? null,
    ],
  )
  const cursor = Number(ctx.sql.one(["c"], "SELECT last_insert_rowid() AS c")?.c)
  touchOutboxMarker(ctx, row.binding.binding_id, cursor, row.now)
  return cursor
}

/**
 * The only way a session writes to a binding's outbox. The binding must be attached to the calling
 * session, active, outbound, and subscribed to the event; nothing is ever copied to the session's
 * other bindings. A `question` mints a reply token; a `completion` is only armed, and the session's
 * next settle writes it with the real outcome.
 */
export async function reportEvent(ctx: StoreContext, request: ReportOpRequest): Promise<RelayOutcome<ReportOpResult>> {
  return await relayMutation(ctx, "report", request.now, request.receipt, () => {
    const resolved = request.binding_id === null ? reportBindingDefault(ctx, request.session_durable_id, request.origin_delivery_ids, request.origin_local_input === true) : { binding_id: request.binding_id }
    if ("kind" in resolved) return resolved
    const bindingId = resolved.binding_id
    const binding = selectBinding(ctx, bindingId)
    if (binding === undefined) return refused("not_found", "No binding has this id.", { binding_id: bindingId })
    if (binding.session_durable_id !== request.session_durable_id) return refused("scope_denied", "The binding is attached to another session.", { binding_id: bindingId })
    if (binding.status !== "active") return refused("binding_inactive", `The binding is ${binding.status}.`, { binding_id: bindingId, status: binding.status })
    if (!binding.direction.outbound) return refused("unsupported", "The binding carries no outbound direction.", { binding_id: bindingId, direction: binding.direction })
    if (!binding.outbound_events.includes(request.event)) return refused("unsupported", `The binding is not subscribed to ${request.event} events.`, { binding_id: bindingId, outbound_events: binding.outbound_events })
    if (request.ui_request_kind !== null && request.event !== "question") return refused("invalid_arguments", "Only a question names a request kind.")
    const base = { binding_id: bindingId, revision: binding.revision, event: request.event }
    if (request.event === "completion") {
      write(ctx, "INSERT OR REPLACE INTO completion_arms (session_durable_id, binding_id, revision, text, armed_at) VALUES (?, ?, ?, ?, ?)", [
        request.session_durable_id, bindingId, binding.revision, request.text, request.now,
      ])
      return { kind: "ok", ...base, cursor: null, reply_token: null, armed: true }
    }
    if (request.event === "question") {
      if (request.ui_request_id === null) return refused("invalid_arguments", "A question names the session's pending extension UI request (request_id).")
      const incarnation = incarnationOf(ctx, request.session_durable_id)
      const token = mintReplyToken(meta(ctx, "token_secret"), { binding_id: bindingId, revision: binding.revision, session_durable_id: request.session_durable_id, incarnation, ui_request_id: request.ui_request_id })
      const cursor = insertOutbox(ctx, { binding, event: "question", text: request.text, now: request.now, reply_token: token, ui_request_id: request.ui_request_id, ...(request.ui_request_kind === null ? {} : { ui_request_kind: request.ui_request_kind }), incarnation })
      pruneOutbox(ctx, request.now)
      return { kind: "ok", ...base, cursor, reply_token: token, armed: false }
    }
    const cursor = insertOutbox(ctx, { binding, event: request.event, text: request.text, now: request.now })
    pruneOutbox(ctx, request.now)
    return { kind: "ok", ...base, cursor, reply_token: null, armed: false }
  })
}

/**
 * Called when the session settles (no retry, compaction or queued continuation will run): every
 * completion armed for it becomes one outbox row with the run's outcome, on a binding still active
 * at the revision it was armed under. Arms are consumed, so a later settle emits nothing. With
 * `armed_through` (the time the run settled) only arms made by then are consumed: an arm a later run
 * made waits for that run's own settle, even when this write was delayed or retried past it.
 */
export async function emitCompletions(ctx: StoreContext, request: { readonly now: number; readonly session_durable_id: string; readonly outcome: CompletionOutcome; readonly armed_through?: number }): Promise<readonly { readonly binding_id: string; readonly cursor: number }[]> {
  return await transaction(ctx, "emit_completions", () => {
    expireDue(ctx, request.now)
    const arms = request.armed_through === undefined
      ? ctx.sql.all(["binding_id", "revision", "text"], "SELECT binding_id, revision, text FROM completion_arms WHERE session_durable_id = ?", [request.session_durable_id], "binding_id")
      : ctx.sql.all(["binding_id", "revision", "text"], "SELECT binding_id, revision, text FROM completion_arms WHERE session_durable_id = ? AND armed_at <= ?", [request.session_durable_id, request.armed_through], "binding_id")
    const emitted: { binding_id: string; cursor: number }[] = []
    for (const arm of arms) {
      const binding = selectBinding(ctx, String(arm.binding_id))
      write(ctx, "DELETE FROM completion_arms WHERE session_durable_id = ? AND binding_id = ?", [request.session_durable_id, String(arm.binding_id)])
      if (binding === undefined || binding.status !== "active" || binding.revision !== Number(arm.revision) || binding.session_durable_id !== request.session_durable_id) continue
      if (!binding.direction.outbound || !binding.outbound_events.includes("completion")) continue
      emitted.push({ binding_id: binding.binding_id, cursor: insertOutbox(ctx, { binding, event: "completion", text: String(arm.text), now: request.now, outcome: request.outcome }) })
    }
    return emitted
  }).then((emitted) => {
    ctx.emit({ kind: "completions_emitted", session_durable_id: request.session_durable_id, cursors: emitted.map((row) => row.cursor) })
    return emitted
  })
}

/** How many completion arms wait for the session's settle: a plain read that takes no write lock, so it never waits on another writer. */
export function pendingCompletionArms(ctx: StoreContext, durableId: string): number {
  return Number(ctx.sql.one(["n"], "SELECT COUNT(*) AS n FROM completion_arms WHERE session_durable_id = ?", [durableId])?.n ?? 0)
}

function outboxRowFrom(record: SqlRow, binding: BindingRecord): OutboxRow {
  const event = record.event_kind as OutboundEvent
  return {
    cursor: Number(record.cursor),
    binding_id: String(record.binding_id),
    revision: Number(record.revision),
    event,
    text: String((JSON.parse(String(record.payload)) as { text?: unknown }).text ?? ""),
    state: record.state as OutboxRow["state"],
    created_at: rfc3339(Number(record.created_at)),
    edit_message_id: event === "milestone" ? binding.progress_message_id : null,
    provider_message_id: nullableString(record.provider_message_id),
    reply_token: nullableString(record.reply_token),
    question_state: (record.question_state ?? null) as OutboxRow["question_state"],
    outcome: (record.outcome ?? null) as OutboxRow["outcome"],
    answered_by: authorFromColumn(record.answered_by),
  }
}

function ackedCursor(ctx: StoreContext, bindingId: string): number {
  return Number(ctx.sql.one(["acked_cursor"], "SELECT acked_cursor FROM outbox_cursors WHERE binding_id = ?", [bindingId])?.acked_cursor ?? 0)
}

/**
 * The connector's read. Without `after_cursor` it continues after the binding's acknowledged
 * cursor, so rows already acked are not handed out again; with an older cursor it re-reads from
 * there (rows are kept 30 days after their ack). Rows come in cursor order.
 */
export async function readOutbox(
  ctx: StoreContext,
  request: { readonly now: number; readonly binding_id: string; readonly after_cursor?: number; readonly limit?: number },
): Promise<RelayOutcome<{ readonly binding_id: string; readonly revision: number; readonly status: BindingRecord["status"]; readonly rows: readonly OutboxRow[]; readonly next_cursor: number; readonly acked_cursor: number }>> {
  const limit = Math.min(Math.max(request.limit ?? OUTBOX_PAGE_DEFAULT, 1), OUTBOX_PAGE_MAX)
  return await transaction(ctx, "read_outbox", () => {
    expireDue(ctx, request.now)
    pruneOutbox(ctx, request.now)
    const binding = selectBinding(ctx, request.binding_id)
    if (binding === undefined) return refused("not_found", "No binding has this id.", { binding_id: request.binding_id })
    const acked = ackedCursor(ctx, binding.binding_id)
    const after = request.after_cursor ?? acked
    const rows = ctx.sql
      .all(OUTBOX_COLUMNS, `SELECT ${OUTBOX_COLUMNS.join(", ")} FROM outbox WHERE binding_id = ? AND cursor > ? ORDER BY cursor LIMIT ?`, [binding.binding_id, after, limit], "cursor")
      .map((row) => outboxRowFrom(row, binding))
    sweepRetentionIfDue(ctx, request.now)
    return { kind: "ok", binding_id: binding.binding_id, revision: binding.revision, status: binding.status, rows, next_cursor: rows.at(-1)?.cursor ?? after, acked_cursor: acked }
  })
}

/**
 * Marks every row up to `cursor` consumed. Idempotent: an older or equal cursor changes nothing.
 * Cursors are global across bindings, so a newer cursor must name one of this binding's own rows: a
 * cursor another binding owns is `cursor_invalid` and acks nothing, because it would otherwise ack
 * this binding's rows below it that the connector never read for it. A
 * `provider_message_id` names the message the connector posted for the row at `cursor`; the first
 * one reported for a milestone becomes the binding's progress message, which later milestones edit.
 */
export async function ackOutbox(
  ctx: StoreContext,
  request: { readonly now: number; readonly binding_id: string; readonly cursor: number; readonly provider_message_id?: string },
): Promise<RelayOutcome<{ readonly binding_id: string; readonly acked_cursor: number; readonly changed: boolean }>> {
  return await transaction(ctx, "ack_outbox", () => {
    expireDue(ctx, request.now)
    const binding = selectBinding(ctx, request.binding_id)
    if (binding === undefined) return refused("not_found", "No binding has this id.", { binding_id: request.binding_id })
    const acked = ackedCursor(ctx, binding.binding_id)
    if (request.cursor <= acked) return { kind: "ok", binding_id: binding.binding_id, acked_cursor: acked, changed: false }
    if (ctx.sql.one(["cursor"], "SELECT cursor FROM outbox WHERE binding_id = ? AND cursor = ?", [binding.binding_id, request.cursor]) === undefined) {
      const newest = Number(ctx.sql.one(["m"], "SELECT COALESCE(MAX(cursor), 0) AS m FROM outbox WHERE binding_id = ?", [binding.binding_id])?.m ?? 0)
      return refused("cursor_invalid", request.cursor > newest ? "The cursor is past the newest outbox row of this binding." : "The cursor names no outbox row of this binding.", { newest })
    }
    write(ctx, "UPDATE outbox SET state = 'acked', acked_at = ? WHERE binding_id = ? AND cursor <= ? AND state = 'pending'", [request.now, binding.binding_id, request.cursor])
    write(ctx, "INSERT INTO outbox_cursors (binding_id, acked_cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(binding_id) DO UPDATE SET acked_cursor = excluded.acked_cursor, updated_at = excluded.updated_at", [
      binding.binding_id, request.cursor, request.now,
    ])
    if (request.provider_message_id !== undefined) {
      write(ctx, "UPDATE outbox SET provider_message_id = ? WHERE binding_id = ? AND cursor = ?", [request.provider_message_id, binding.binding_id, request.cursor])
      const event = ctx.sql.one(["event_kind"], "SELECT event_kind FROM outbox WHERE binding_id = ? AND cursor = ?", [binding.binding_id, request.cursor])?.event_kind
      if (event === "milestone" && binding.progress_message_id === null) {
        write(ctx, "UPDATE bindings SET progress_message_id = ?, updated_at = ? WHERE binding_id = ?", [request.provider_message_id, rfc3339(request.now), binding.binding_id])
      }
    }
    return { kind: "ok", binding_id: binding.binding_id, acked_cursor: request.cursor, changed: true }
  })
}

/**
 * `ui_request_kind` is null when the question declared none. `claimed_at` is the claim's `answered_at`:
 * `releaseAnswer` undoes only the in-flight claim that still carries it, so a claimant whose claim was
 * taken over releases nothing. `confirmAnswer` records a fact, not a claim: the session took this
 * claimant's answer, so it lands for whichever claimant that was.
 */
export type AnswerClaim = { readonly session_durable_id: string; readonly ui_request_id: string; readonly ui_request_kind: UiRequestKind | null; readonly cursor: number; readonly claimed_at: number; readonly taken_over: PriorAnswer | null }
/** The answer an expired claim held when a new answer took it over (a pre-v3 row's may have been delivered). */
export type PriorAnswer = { readonly answer: string | null; readonly answered_at: number | null; readonly answered_by?: ExternalAuthor | null }
export type AnswerClaimRef = { readonly reply_token: string; readonly claimed_at: number }
export type AnswerDelivered = AnswerClaimRef & { readonly answer: string; readonly answered_by?: ExternalAuthor | null }

/**
 * How long a claimed answer counts as still being handed over. The relay's hand-off gives up well
 * before this (60 s request timeout), so an older `in_flight` claim belongs to a claimant that died
 * mid-hand-off; a new answer may take it over, and the session itself refuses a second resolution.
 * A row claimed before v3 (`answered`, NULL `answer_state`) cannot tell a delivered answer from one
 * whose claimant died mid-hand-off, so it counts as a claim made at its `answered_at`: once the bound
 * has passed a new answer takes it over, and a session that already has the answer refuses it.
 */
export const ANSWER_IN_FLIGHT_MAX_MS = 120_000

/** How a question the session closed another way (answered locally, timed out, cancelled) reads: delivered with no answer text. */
export const CLOSED_ELSEWHERE = "The session no longer waits for this question (answered or closed elsewhere)"

/**
 * First phase of `thread_answer`. `binding_id` is the binding the answer ARRIVED through; the token
 * names the binding that emitted the question. A mismatch is refused before anything is written, so
 * the question stays pending. Then: a question already answered is `already_answered`; a binding
 * that moved (detached, expired, rebound) or a session that restarted since is `stale_token`.
 * An answer another caller is still handing over is `answer_in_progress` (it may yet fail and leave
 * the question pending); `already_answered` means the answer reached the session. An answer the
 * request kind cannot take (`answerShape`) is `invalid_arguments`. Only a match claims the question
 * (`answered`, `in_flight`); the caller then delivers the `extension_ui_response` and confirms the
 * claim, or releases it if that delivery fails.
 */
export async function claimAnswer(ctx: StoreContext, request: { readonly now: number; readonly binding_id: string; readonly reply_token: string; readonly answer: string; readonly answered_by?: ExternalAuthor | null }): Promise<RelayOutcome<AnswerClaim>> {
  return await transaction(ctx, "claim_answer", () => {
    expireDue(ctx, request.now)
    const token = readReplyToken(meta(ctx, "token_secret"), request.reply_token)
    if (token === null) return refused("invalid_arguments", "This is not a reply token this gateway issued.")
    if (token.binding_id !== request.binding_id) return refused("binding_mismatch", "The answer arrived through a different binding than the one that asked the question.", { binding_id: request.binding_id })
    const row = ctx.sql.one(["cursor", "question_state", "answer_state", "answer", "answered_at", "answered_by", "ui_request_id", "ui_request_kind", "session"], "SELECT cursor, question_state, answer_state, answer, answered_at, answered_by, ui_request_id, ui_request_kind, session_durable_id AS session FROM outbox WHERE reply_token = ? AND binding_id = ?", [request.reply_token, token.binding_id])
    if (row === undefined) return refused("not_found", "The question this token belongs to is no longer in the outbox.")
    const inFlight = row.question_state === "answered" && row.answer_state !== "delivered"
    const abandoned = inFlight && Number(row.answered_at) + ANSWER_IN_FLIGHT_MAX_MS <= request.now
    if (inFlight && !abandoned) return refused("answer_in_progress", "Another answer to this question is still being handed to the session.", { cursor: Number(row.cursor) })
    if (row.question_state === "answered" && !abandoned) return refused("already_answered", row.answer === null && row.answer_state === "delivered" ? `${CLOSED_ELSEWHERE}.` : "This question was already answered.", { cursor: Number(row.cursor) })
    const kind: UiRequestKind | null = isUiRequestKind(row.ui_request_kind) ? row.ui_request_kind : null
    const shape = answerShape(kind, request.answer)
    if (!shape.ok) return refused("invalid_arguments", shape.reason, { ui_request_kind: kind })
    const binding = selectBinding(ctx, token.binding_id)
    const moved = binding === undefined || binding.status !== "active" || binding.revision !== token.revision || binding.session_durable_id !== token.session_durable_id
    if (moved || incarnationOf(ctx, token.session_durable_id) !== token.incarnation || nullableString(row.ui_request_id) !== token.ui_request_id) {
      return refused("stale_token", "The binding or the session changed since the question was asked.", { binding_id: token.binding_id })
    }
    write(ctx, "UPDATE outbox SET question_state = 'answered', answer_state = 'in_flight', answer = ?, answered_at = ?, answered_by = ? WHERE reply_token = ?", [request.answer, request.now, authorColumn(request.answered_by), request.reply_token])
    return { kind: "ok", session_durable_id: token.session_durable_id, ui_request_id: token.ui_request_id, ui_request_kind: kind, cursor: Number(row.cursor), claimed_at: request.now, taken_over: abandoned ? { answer: nullableString(row.answer), answered_at: row.answered_at === null || row.answered_at === undefined ? null : Number(row.answered_at), answered_by: authorFromColumn(row.answered_by) } : null }
  })
}

export async function releaseAnswer(ctx: StoreContext, request: AnswerClaimRef): Promise<boolean> {
  return await transaction(ctx, "release_answer", () => write(ctx, "UPDATE outbox SET question_state = 'pending', answer_state = NULL, answer = NULL, answered_at = NULL, answered_by = NULL WHERE reply_token = ? AND question_state = 'answered' AND answer_state = 'in_flight' AND answered_at = ?", [request.reply_token, request.claimed_at]) === 1)
}

/**
 * A claim that took over an expired one was refused because the session no longer waits on the request:
 * it already took an answer, the one the expired claim held. The question goes back to that answer,
 * delivered, instead of to pending, so no later answer sends another frame. Bound to the caller's own
 * in-flight claim like a release.
 */
export async function markPriorDelivered(ctx: StoreContext, request: AnswerClaimRef & { readonly prior: PriorAnswer }): Promise<boolean> {
  return await transaction(ctx, "mark_prior_delivered", () => write(ctx, "UPDATE outbox SET answer_state = 'delivered', answer = ?, answered_at = ?, answered_by = ? WHERE reply_token = ? AND question_state = 'answered' AND answer_state = 'in_flight' AND answered_at = ?", [request.prior.answer, request.prior.answered_at, authorColumn(request.prior.answered_by), request.reply_token, request.claimed_at]) === 1)
}

/**
 * The session accepted this claimant's answer: the question is delivered with that answer, whether or
 * not a later answer took the claim over meanwhile (the session resolves a request once, so at most
 * one claimant's frame is ever accepted). A question already delivered is left as it is.
 */
export async function confirmAnswer(ctx: StoreContext, request: AnswerDelivered): Promise<boolean> {
  return await transaction(ctx, "confirm_answer", () => write(ctx, "UPDATE outbox SET question_state = 'answered', answer_state = 'delivered', answer = ?, answered_at = ?, answered_by = ? WHERE reply_token = ? AND answer_state IS NOT 'delivered'", [request.answer, request.claimed_at, authorColumn(request.answered_by), request.reply_token]) === 1)
}
