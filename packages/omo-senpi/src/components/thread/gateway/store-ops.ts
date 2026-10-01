/**
 * Every statement the gateway store runs. Loaded only inside the store worker thread, which owns
 * the one `DatabaseSync` connection, so nothing here ever runs on a session loop.
 *
 * Wake protocol, sender half (`enqueue`): `BEGIN IMMEDIATE` takes the store's single write lock,
 * the row, receipt, causal edge and budgets are written, the target's inbox marker is created
 * `O_EXCL` while the lock is still held, then `COMMIT`. A receiver whose inbox watcher fires on
 * the marker starts its drain with its own `BEGIN IMMEDIATE` (`reconcile`), which cannot succeed
 * until this transaction is fully published or fully rolled back - so a notification is only ever
 * early, never late, and every marker a lock holder sees names a row that is visible or gone.
 */
import { createHash, randomUUID } from "node:crypto"
import { closeSync, constants, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"

import { closesCycle, type CausalEdge } from "./causal"
import {
  GATEWAY_RECEIPT_RETENTION_MS,
  MAX_CAUSAL_DELIVERIES,
  MAX_FANOUT_PER_TURN,
  MAX_HOPS,
  PAIR_BUCKET_BURST,
  PAIR_BUCKET_REFILL_MS,
  QUEUED_TTL_MS,
  ROOT_LIFETIME_MS,
  SESSION_CONTROL_DELIVERY_TYPE,
  SESSION_RELEASED_ENTRY_TYPE,
  TARGET_MAX_BYTES,
  TARGET_MAX_MESSAGES,
} from "./constants"
import { readLegacyMailbox } from "./legacy-mailbox"
import { gatewayInboxDirectory } from "./paths"
import { isClaimantDead, sameProcess } from "./process-identity"
import { deleteExpiredReceipt, sweepRetentionIfDue } from "./store-retention"
import { resultFromRow } from "./result"
import { GATEWAY_MIGRATIONS } from "./schema"
import { lockWaitExceeded } from "./lock-wait"
import { isBusyError, type Sql, type SqlRow, type SqlValue } from "./sql"
import type {
  ClaimOutcome,
  ClaimRequest,
  DeliveryEnvelope,
  DeliveryRow,
  DeliveryState,
  EnqueueOutcome,
  EnqueueRequest,
  GatewayStoreConfig,
  GatewayStoreEvent,
  GatewayStoreStats,
  LegacyMailboxSkip,
  ProcessIdentity,
  ReconcileOutcome,
  ReconcileRequest,
  RecordOutcomeRequest,
  RefusalReason,
  StoreRefusal,
} from "./types"

export type StoreContext = {
  readonly sql: Sql
  readonly config: GatewayStoreConfig
  readonly self: ProcessIdentity
  readonly stats: { writes: number; marker_unlinks: number; transactions: number }
  readonly emit: (event: GatewayStoreEvent) => void
  readonly hook: (name: "beforeDbCommit" | "afterDbCommit") => Promise<void>
  readonly delay: (ms: number) => Promise<void>
}

const DELIVERY_COLUMNS = [
  "delivery_id", "target_durable_id", "seq", "sender", "sender_turn", "envelope", "body", "bytes", "mode_requested",
  "mode_effective", "expected_turn_id", "state", "reason", "admitted_by", "claimed_at", "attempt", "admission_kind",
  "turn_epoch", "root_id", "hop", "created_at", "updated_at", "expires_at", "binding_id", "binding_revision",
] as const

export const OPEN_STATES = "('queued', 'admitting', 'admitted')"
const DURABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

function refused(code: StoreRefusal["code"], message: string, details?: Readonly<Record<string, unknown>>): StoreRefusal {
  return { kind: "refused", code, message, ...(details === undefined ? {} : { details }) }
}

function rowFrom(record: SqlRow): DeliveryRow {
  const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
  return {
    delivery_id: String(record.delivery_id),
    target_durable_id: String(record.target_durable_id),
    seq: Number(record.seq),
    sender: String(record.sender),
    sender_turn: record.sender_turn === null ? null : String(record.sender_turn),
    envelope: JSON.parse(String(record.envelope)) as DeliveryEnvelope,
    body: String(record.body),
    bytes: Number(record.bytes),
    mode_requested: record.mode_requested as DeliveryRow["mode_requested"],
    mode_effective: (record.mode_effective ?? null) as DeliveryRow["mode_effective"],
    expected_turn_id: nullableNumber(record.expected_turn_id),
    state: record.state as DeliveryState,
    reason: record.reason === null ? null : String(record.reason),
    admitted_by: record.admitted_by === null ? null : (JSON.parse(String(record.admitted_by)) as ProcessIdentity),
    claimed_at: nullableNumber(record.claimed_at),
    attempt: Number(record.attempt),
    admission_kind: record.admission_kind === null ? null : String(record.admission_kind),
    turn_epoch: nullableNumber(record.turn_epoch),
    root_id: String(record.root_id),
    hop: Number(record.hop),
    created_at: Number(record.created_at),
    updated_at: Number(record.updated_at),
    expires_at: Number(record.expires_at),
    binding_id: record.binding_id === null ? null : String(record.binding_id),
    binding_revision: nullableNumber(record.binding_revision),
  }
}

function selectRows(ctx: StoreContext, where: string, params: readonly SqlValue[], orderBy?: string): DeliveryRow[] {
  return ctx.sql.all(DELIVERY_COLUMNS, `SELECT ${DELIVERY_COLUMNS.join(", ")} FROM deliveries WHERE ${where}`, params, orderBy).map(rowFrom)
}

function selectRow(ctx: StoreContext, deliveryId: string): DeliveryRow | undefined {
  return selectRows(ctx, "delivery_id = ?", [deliveryId])[0]
}

export function write(ctx: StoreContext, sql: string, params: readonly SqlValue[] = []): number {
  const changed = ctx.sql.run(sql, params)
  ctx.stats.writes += changed
  return changed
}

function queuePosition(ctx: StoreContext, row: DeliveryRow): number {
  if (row.state !== "queued" && row.state !== "admitting" && row.state !== "admitted") return 0
  const found = ctx.sql.one(["n"], `SELECT COUNT(*) AS n FROM deliveries WHERE target_durable_id = ? AND state IN ${OPEN_STATES} AND seq <= ?`, [row.target_durable_id, row.seq])
  return Number(found?.n ?? 1)
}

async function beginImmediate(ctx: StoreContext, op: string, retryUntilLocked: boolean): Promise<boolean> {
  const started = Date.now()
  for (;;) {
    try {
      ctx.sql.exec("BEGIN IMMEDIATE")
      ctx.stats.transactions++
      return true
    } catch (error) {
      if (!isBusyError(error)) throw error
      ctx.emit({ kind: "busy", op })
      if (!retryUntilLocked) return false
      // The protocol's only timer: a writer suspended while holding the lock (SIGSTOP, ^Z) makes
      // BEGIN IMMEDIATE time out; retry once per busy_timeout until it continues or dies. The
      // operation gives up before its total wait could pass `lock_wait_max_ms` (the next attempt
      // sleeps busy_timeout, then may block busy_timeout more), so it never stalls the worker and
      // every call queued behind it; the callers that must not give up re-arm their own retry.
      const waited = Date.now() - started
      if (waited + 2 * ctx.config.busy_timeout_ms > ctx.config.lock_wait_max_ms) {
        ctx.emit({ kind: "lock_wait_exceeded", op, waited_ms: waited })
        throw lockWaitExceeded(op, waited, ctx.config.lock_wait_max_ms)
      }
      await ctx.delay(ctx.config.busy_timeout_ms)
    }
  }
}

function rollbackQuietly(ctx: StoreContext): void {
  try {
    ctx.sql.exec("ROLLBACK")
  } catch {
    return
  }
}

export async function transaction<T>(ctx: StoreContext, op: string, body: () => T): Promise<T> {
  await beginImmediate(ctx, op, true)
  try {
    const value = body()
    ctx.sql.exec("COMMIT")
    return value
  } catch (error) {
    rollbackQuietly(ctx)
    throw error
  }
}

function createMarker(ctx: StoreContext, targetDurableId: string, deliveryId: string, allowExisting: boolean): string {
  const directory = gatewayInboxDirectory(ctx.config.agent_dir, targetDurableId)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, deliveryId)
  let fd: number
  try {
    fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  } catch (error) {
    if (allowExisting && error instanceof Error && "code" in error && error.code === "EEXIST") return path
    throw error
  }
  try {
    writeSync(fd, JSON.stringify({ pid: ctx.self.pid, process_start_time: ctx.self.process_start_time }))
  } finally {
    closeSync(fd)
  }
  return path
}

export function unlinkMarker(ctx: StoreContext, targetDurableId: string, deliveryId: string): void {
  const path = join(gatewayInboxDirectory(ctx.config.agent_dir, targetDurableId), deliveryId)
  try {
    rmSync(path)
    ctx.stats.marker_unlinks++
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

function markerNames(ctx: StoreContext, targetDurableId: string): string[] {
  try {
    return readdirSync(gatewayInboxDirectory(ctx.config.agent_dir, targetDurableId)).filter((name) => !name.startsWith("."))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

function allocateSeq(ctx: StoreContext, targetDurableId: string): number {
  const meta = ctx.sql.one(["next_seq"], "SELECT next_seq FROM session_meta WHERE durable_id = ?", [targetDurableId])
  const seq = meta === undefined
    ? Number(ctx.sql.one(["m"], "SELECT COALESCE(MAX(seq), 0) + 1 AS m FROM deliveries WHERE target_durable_id = ?", [targetDurableId])?.m ?? 1)
    : Number(meta.next_seq)
  write(ctx, "INSERT INTO session_meta (durable_id, next_seq) VALUES (?, ?) ON CONFLICT(durable_id) DO UPDATE SET next_seq = excluded.next_seq", [targetDurableId, seq + 1])
  return seq
}

function insertDelivery(ctx: StoreContext, row: DeliveryRow): void {
  write(
    ctx,
    `INSERT INTO deliveries (${DELIVERY_COLUMNS.join(", ")}) VALUES (${DELIVERY_COLUMNS.map(() => "?").join(", ")})`,
    [
      row.delivery_id, row.target_durable_id, row.seq, row.sender, row.sender_turn, JSON.stringify(row.envelope), row.body, row.bytes,
      row.mode_requested, row.mode_effective, row.expected_turn_id, row.state, row.reason,
      row.admitted_by === null ? null : JSON.stringify(row.admitted_by), row.claimed_at, row.attempt, row.admission_kind,
      row.turn_epoch, row.root_id, row.hop, row.created_at, row.updated_at, row.expires_at, row.binding_id, row.binding_revision,
    ],
  )
}

function argsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function schemaVersion(ctx: StoreContext): number {
  return Number(ctx.sql.one(["user_version"], "SELECT user_version FROM pragma_user_version()")?.user_version ?? 0)
}

/**
 * Applies pending migrations. A store that is already current takes no write lock (opening must
 * never wait behind another process's transaction); otherwise each step re-reads the version under
 * the lock, so two processes opening a fresh store at once apply every migration exactly once.
 */
export async function migrate(ctx: StoreContext): Promise<void> {
  if (schemaVersion(ctx) >= GATEWAY_MIGRATIONS.length) return
  for (;;) {
    const applied = await transaction(ctx, "migrate", () => {
      const version = schemaVersion(ctx)
      if (version >= GATEWAY_MIGRATIONS.length) return false
      for (const statement of GATEWAY_MIGRATIONS[version]) ctx.sql.exec(statement)
      ctx.sql.exec(`PRAGMA user_version = ${version + 1}`)
      return true
    })
    if (!applied) return
  }
}

type ReceiptRecord = {
  readonly args_hash: string
  readonly status: "prepared" | "completed" | "uncertain"
  readonly delivery_id: string | null
  readonly owner_instance: string
  readonly result: string | null
  readonly expires_at: number
}

function selectReceipt(ctx: StoreContext, principal: string, key: string): ReceiptRecord | undefined {
  const found = ctx.sql.one(
    ["args_hash", "status", "delivery_id", "owner_instance", "result", "expires_at"],
    "SELECT args_hash, status, delivery_id, owner_instance, result, expires_at FROM receipts WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ?",
    [principal, key],
  )
  if (found === undefined) return undefined
  return {
    args_hash: String(found.args_hash),
    status: found.status as ReceiptRecord["status"],
    delivery_id: found.delivery_id === null ? null : String(found.delivery_id),
    owner_instance: String(found.owner_instance),
    result: found.result === null ? null : String(found.result),
    expires_at: Number(found.expires_at),
  }
}

function classifyReceipt(ctx: StoreContext, request: EnqueueRequest, receipt: ReceiptRecord): EnqueueOutcome {
  if (receipt.args_hash !== request.receipt.args_hash) {
    return refused("idempotency_conflict", "The idempotency key was already used with different arguments.")
  }
  if (receipt.status === "completed" && receipt.result !== null) return { kind: "replay", result: JSON.parse(receipt.result) }
  // The row is read before the owner: a decided row proves the outcome whoever began the receipt,
  // including this process when both of its receipt writes failed (the receipt then stays prepared).
  const row = receipt.delivery_id === null ? undefined : selectRow(ctx, receipt.delivery_id)
  const decided = row !== undefined && (row.state === "admitted" || row.state === "applied" || row.state === "refused")
  if (receipt.status === "prepared" && !decided && receipt.owner_instance === ctx.config.instance_id) {
    return refused("idempotency_in_progress", "The same delivery is already in progress.")
  }
  if (receipt.status === "prepared" && decided) {
    // Lost ACK with proof: the target's row records the admission outcome, so the stored result
    // is rebuilt from it and the receipt completes - never a second send.
    const result = { ...resultFromRow(row, queuePosition(ctx, row), request.endpoint_kind, true, false) }
    write(ctx, "UPDATE receipts SET status = 'completed', result = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ?", [
      JSON.stringify(result), request.now, request.sender_principal, request.receipt.idempotency_key,
    ])
    return { kind: "replay", result }
  }
  if (receipt.status === "prepared") {
    write(ctx, "UPDATE receipts SET status = 'uncertain', error_note = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ?", [
      "the sender lost the acknowledgement before the target admitted the delivery", request.now, request.sender_principal, request.receipt.idempotency_key,
    ])
  }
  return refused("idempotency_uncertain", "The earlier delivery may or may not reach the target; it is never sent twice.", {
    delivery_id: receipt.delivery_id,
    state: row?.state ?? null,
  })
}

type CausalPlacement = { readonly root_id: string; readonly hop: number; readonly via: readonly string[]; readonly new_root: boolean }

function placeCausally(ctx: StoreContext, request: EnqueueRequest): CausalPlacement | StoreRefusal {
  let placement: CausalPlacement
  if (request.cause_delivery_id !== null) {
    const cause = selectRow(ctx, request.cause_delivery_id)
    if (cause === undefined || cause.target_durable_id !== request.sender_node || (cause.state !== "admitted" && cause.state !== "applied")) {
      return refused("invalid_arguments", "The delivery this send continues is not one the sender received.", { guard: "unknown_cause" })
    }
    placement = { root_id: cause.root_id, hop: cause.hop + 1, via: [...cause.envelope.via, request.sender_node], new_root: false }
  } else {
    placement = { root_id: `root-${randomUUID()}`, hop: 1, via: [request.sender_node], new_root: true }
  }
  if (request.claimed_root_id !== null && request.claimed_root_id !== placement.root_id) {
    return refused("invalid_arguments", "The causal root is derived by the gateway and cannot be chosen by the caller.", { guard: "forged_root" })
  }
  if (!placement.new_root) {
    const root = ctx.sql.one(["expires_at"], "SELECT expires_at FROM causal_roots WHERE root_id = ?", [placement.root_id])
    if (root === undefined || Number(root.expires_at) <= request.now) {
      return refused("loop_detected", "This causal chain is older than its lifetime.", { guard: "root_expired", root_id: placement.root_id })
    }
  }
  if (request.target_durable_id === request.sender_node) {
    return refused("loop_detected", "A session cannot deliver to itself through the gateway.", { guard: "self_send" })
  }
  if (placement.hop > MAX_HOPS) {
    return refused("loop_detected", `This delivery would be hop ${placement.hop}; at most ${MAX_HOPS} are allowed.`, { guard: "hop_limit", hop: placement.hop })
  }
  const count = Number(ctx.sql.one(["n"], "SELECT COUNT(*) AS n FROM deliveries WHERE root_id = ? AND state != 'refused'", [placement.root_id])?.n ?? 0)
  if (count >= MAX_CAUSAL_DELIVERIES) {
    return refused("loop_detected", `This causal chain already carried ${count} deliveries.`, { guard: "causal_budget", root_id: placement.root_id })
  }
  const edges: CausalEdge[] = ctx.sql
    .all(["from_durable_id", "to_durable_id"], "SELECT from_durable_id, to_durable_id FROM causal_edges WHERE root_id = ?", [placement.root_id])
    .map((edge) => ({ from: String(edge.from_durable_id), to: String(edge.to_durable_id) }))
  if (closesCycle(edges, request.sender_node, request.target_durable_id)) {
    return refused("loop_detected", "The target already leads back to the sender in this causal chain.", { guard: "cycle", root_id: placement.root_id })
  }
  return placement
}

function checkFanout(ctx: StoreContext, request: EnqueueRequest): StoreRefusal | undefined {
  if (request.sender_turn === null) return undefined
  const targets = new Set(
    ctx.sql
      .all(["t"], "SELECT DISTINCT target_durable_id AS t FROM deliveries WHERE sender = ? AND sender_turn = ? AND state != 'refused'", [request.sender_principal, request.sender_turn])
      .map((row) => String(row.t)),
  )
  if (targets.has(request.target_durable_id) || targets.size < MAX_FANOUT_PER_TURN) return undefined
  return refused("overloaded", `One turn may reach at most ${MAX_FANOUT_PER_TURN} sessions.`, { budget: "fanout" })
}

function takePairToken(ctx: StoreContext, request: EnqueueRequest): StoreRefusal | undefined {
  const sender = request.rate_principal ?? request.sender_principal
  const bucket = ctx.sql.one(["tokens", "updated_at"], "SELECT tokens, updated_at FROM rate_buckets WHERE sender = ? AND target_durable_id = ?", [sender, request.target_durable_id])
  const tokens = bucket === undefined
    ? PAIR_BUCKET_BURST
    : Math.min(PAIR_BUCKET_BURST, Number(bucket.tokens) + Math.max(0, request.now - Number(bucket.updated_at)) / PAIR_BUCKET_REFILL_MS)
  if (tokens < 1) {
    return refused("overloaded", "Too many deliveries to this session; wait before sending again.", {
      budget: "pair_rate",
      retry_after_ms: Math.ceil((1 - tokens) * PAIR_BUCKET_REFILL_MS),
    })
  }
  write(ctx, "INSERT INTO rate_buckets (sender, target_durable_id, tokens, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(sender, target_durable_id) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at", [
    sender, request.target_durable_id, tokens - 1, request.now,
  ])
  return undefined
}

function checkBinding(ctx: StoreContext, request: EnqueueRequest): { readonly expires_at: number | null } | StoreRefusal {
  if (request.binding === null) return { expires_at: null }
  const binding = ctx.sql.one(
    ["revision", "status", "session_durable_id", "direction_inbound", "expires_at"],
    "SELECT revision, status, session_durable_id, direction_inbound, expires_at FROM bindings WHERE binding_id = ?",
    [request.binding.binding_id],
  )
  const expiresAt = binding?.expires_at === null || binding?.expires_at === undefined ? null : Date.parse(String(binding.expires_at))
  if (
    binding === undefined ||
    binding.status !== "active" ||
    Number(binding.revision) !== request.binding.revision ||
    String(binding.session_durable_id) !== request.target_durable_id ||
    Number(binding.direction_inbound) !== 1 ||
    (expiresAt !== null && expiresAt <= request.now)
  ) {
    return refused("invalid_arguments", "The binding is not active for this session at this revision.", { binding: request.binding.binding_id })
  }
  return { expires_at: expiresAt }
}

export async function enqueue(ctx: StoreContext, request: EnqueueRequest): Promise<EnqueueOutcome> {
  if (!DURABLE_ID_PATTERN.test(request.target_durable_id) || !DURABLE_ID_PATTERN.test(request.delivery_id)) {
    return refused("invalid_arguments", "The target session id is not a durable session id.")
  }
  if (!(await beginImmediate(ctx, "enqueue", false))) return { kind: "busy" }
  let marker: string | null = null
  let committed = false
  try {
    deleteExpiredReceipt(ctx, { principal: request.sender_principal, operation: "deliver", idempotency_key: request.receipt.idempotency_key }, request.now)
    const receipt = selectReceipt(ctx, request.sender_principal, request.receipt.idempotency_key)
    if (receipt !== undefined) {
      const outcome = classifyReceipt(ctx, request, receipt)
      ctx.sql.exec("COMMIT")
      committed = true
      return outcome
    }
    const binding = checkBinding(ctx, request)
    if ("kind" in binding) {
      rollbackQuietly(ctx)
      return binding
    }
    const backlog = ctx.sql.one(["n", "b"], `SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM deliveries WHERE target_durable_id = ? AND state IN ${OPEN_STATES}`, [request.target_durable_id])
    const bytes = Buffer.byteLength(request.body)
    if (Number(backlog?.n ?? 0) >= TARGET_MAX_MESSAGES || Number(backlog?.b ?? 0) + bytes > TARGET_MAX_BYTES) {
      rollbackQuietly(ctx)
      return refused("queue_full", "The target's delivery backlog is full.", { max_messages: TARGET_MAX_MESSAGES, max_bytes: TARGET_MAX_BYTES })
    }
    const placement = placeCausally(ctx, request)
    if ("kind" in placement) {
      rollbackQuietly(ctx)
      return placement
    }
    const budget = checkFanout(ctx, request) ?? takePairToken(ctx, request)
    if (budget !== undefined) {
      rollbackQuietly(ctx)
      return budget
    }
    if (placement.new_root) {
      write(ctx, "INSERT INTO causal_roots (root_id, origin_principal, created_at, expires_at) VALUES (?, ?, ?, ?)", [
        placement.root_id, request.sender_principal, request.now, request.now + ROOT_LIFETIME_MS,
      ])
    }
    write(ctx, "INSERT OR IGNORE INTO causal_edges (root_id, from_durable_id, to_durable_id, delivery_id, created_at) VALUES (?, ?, ?, ?, ?)", [
      placement.root_id, request.sender_node, request.target_durable_id, request.delivery_id, request.now,
    ])
    const row: DeliveryRow = {
      delivery_id: request.delivery_id,
      target_durable_id: request.target_durable_id,
      seq: allocateSeq(ctx, request.target_durable_id),
      sender: request.sender_principal,
      sender_turn: request.sender_turn,
      envelope: { origin: request.origin, actor: request.actor, via: placement.via, root_id: placement.root_id, hop: placement.hop, delivery_id: request.delivery_id },
      body: request.body,
      bytes,
      mode_requested: request.mode,
      mode_effective: null,
      expected_turn_id: request.expected_turn_id,
      state: "queued",
      reason: null,
      admitted_by: null,
      claimed_at: null,
      attempt: 0,
      admission_kind: null,
      turn_epoch: null,
      root_id: placement.root_id,
      hop: placement.hop,
      created_at: request.now,
      updated_at: request.now,
      expires_at: Math.min(request.now + QUEUED_TTL_MS, binding.expires_at ?? Number.POSITIVE_INFINITY),
      binding_id: request.binding?.binding_id ?? null,
      binding_revision: request.binding?.revision ?? null,
    }
    insertDelivery(ctx, row)
    write(ctx, "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES (?, 'deliver', ?, ?, 'prepared', ?, ?, ?, ?, ?)", [
      request.sender_principal, request.receipt.idempotency_key, request.receipt.args_hash, row.delivery_id, ctx.config.instance_id,
      request.now, request.now, request.now + GATEWAY_RECEIPT_RETENTION_MS,
    ])
    marker = createMarker(ctx, row.target_durable_id, row.delivery_id, false)
    const position = queuePosition(ctx, row)
    sweepRetentionIfDue(ctx, request.now)
    await ctx.hook("beforeDbCommit")
    ctx.sql.exec("COMMIT")
    committed = true
    await ctx.hook("afterDbCommit")
    return { kind: "inserted", row, queue_position: position }
  } catch (error) {
    if (!committed) {
      rollbackQuietly(ctx)
      if (marker !== null) rmSync(marker, { force: true })
    }
    throw error
  }
}

function transcriptText(sessionPath: string | null, cache: Map<string, string>): string {
  if (sessionPath === null) return ""
  let text = cache.get(sessionPath)
  if (text === undefined) {
    try {
      text = readFileSync(sessionPath, "utf8")
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      text = ""
    }
    cache.set(sessionPath, text)
  }
  return text
}

/**
 * When each host generation last handed this session file to another runtime: senpi's
 * `release_session` appends a `custom` entry `session_released { host_instance, released_at }`
 * before it tears the runtime down, and that runtime writes nothing afterwards. Keyed by
 * `host_instance` (the same id the host stamps into every session's `pi.sessionContext`), so a
 * release lets go only the claims of the runtime that released, never a concurrent one's.
 */
function releasesByRuntime(sessionPath: string | null, cache: Map<string, string>): ReadonlyMap<string, number> {
  const latest = new Map<string, number>()
  for (const line of transcriptText(sessionPath, cache).split("\n")) {
    if (!line.includes(SESSION_RELEASED_ENTRY_TYPE)) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const record = entry as { type?: unknown; customType?: unknown; data?: { host_instance?: unknown; released_at?: unknown } }
    if (record.type !== "custom" || record.customType !== SESSION_RELEASED_ENTRY_TYPE) continue
    const instance = record.data?.host_instance
    const at = typeof record.data?.released_at === "string" ? Date.parse(record.data.released_at) : Number.NaN
    if (typeof instance !== "string" || instance.length === 0 || !Number.isFinite(at)) continue
    latest.set(instance, Math.max(at, latest.get(instance) ?? at))
  }
  return latest
}

function releasedByClaimant(claimant: ProcessIdentity, claimedAt: number | null, releases: () => ReadonlyMap<string, number>): boolean {
  if (claimant.runtime_instance === null || claimedAt === null) return false
  const releasedAt = releases().get(claimant.runtime_instance)
  return releasedAt !== undefined && claimedAt <= releasedAt
}

function sessionHasToken(sessionPath: string | null, deliveryId: string, cache: Map<string, string>): boolean {
  for (const line of transcriptText(sessionPath, cache).split("\n")) {
    if (!line.includes(deliveryId)) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== "object" || entry === null) continue
    const record = entry as { type?: unknown; customType?: unknown; details?: { delivery_id?: unknown } }
    if (record.type === "custom_message" && record.customType === SESSION_CONTROL_DELIVERY_TYPE && record.details?.delivery_id === deliveryId) return true
  }
  return false
}

function claimFingerprint(row: DeliveryRow): string {
  return `${JSON.stringify(row.admitted_by)}#${row.attempt}`
}

const CLEARED_CLAIM = "admitted_by = NULL, claimed_at = NULL, mode_effective = NULL, admission_kind = NULL, turn_epoch = NULL"

function transition(ctx: StoreContext, row: DeliveryRow, to: DeliveryState, now: number, extra: { readonly reason?: RefusalReason } = {}): void {
  if (to === "queued") {
    write(ctx, `UPDATE deliveries SET state = 'queued', ${CLEARED_CLAIM}, updated_at = ? WHERE delivery_id = ?`, [now, row.delivery_id])
    return
  }
  if (to === "refused") {
    write(ctx, "UPDATE deliveries SET state = 'refused', reason = ?, updated_at = ? WHERE delivery_id = ?", [extra.reason ?? null, now, row.delivery_id])
    return
  }
  write(ctx, "UPDATE deliveries SET state = ?, updated_at = ? WHERE delivery_id = ?", [to, now, row.delivery_id])
  if (to === "applied") {
    write(ctx, "UPDATE session_meta SET applied_seq = MAX(applied_seq, ?) WHERE durable_id = ?", [row.seq, row.target_durable_id])
  }
}

/**
 * Receiver barrier pass. Claimant liveness and the transcript are read BEFORE the lock (both can
 * be slow), then applied under `BEGIN IMMEDIATE` only to rows whose claim is still the one that
 * was judged. Only state changes are written, so a pass that finds nothing new writes nothing.
 */
export async function reconcile(ctx: StoreContext, request: ReconcileRequest): Promise<ReconcileOutcome> {
  const target = request.target_durable_id
  const verdicts = new Map<string, { readonly fingerprint: string; readonly to: DeliveryState | "dual" }>()
  const transcripts = new Map<string, string>()
  const deadClaimants = new Map<string, boolean>()
  let releases: ReadonlyMap<string, number> | undefined
  const releaseIndex = (): ReadonlyMap<string, number> => {
    releases ??= releasesByRuntime(request.session_path, transcripts)
    return releases
  }
  for (const row of selectRows(ctx, "target_durable_id = ? AND state IN ('admitting', 'admitted')", [target])) {
    if (row.admitted_by === null || sameProcess(row.admitted_by, request.self)) continue
    const key = JSON.stringify(row.admitted_by)
    let dead = deadClaimants.get(key)
    if (dead === undefined) {
      dead = await isClaimantDead(row.admitted_by)
      deadClaimants.set(key, dead)
    }
    const letGo = dead || releasedByClaimant(row.admitted_by, row.claimed_at, releaseIndex)
    const to = !letGo ? "dual" : sessionHasToken(request.session_path, row.delivery_id, transcripts) ? "applied" : "queued"
    verdicts.set(row.delivery_id, { fingerprint: claimFingerprint(row), to })
  }

  if (ctx.config.test_hooks.announceBarrier === true) ctx.emit({ kind: "barrier", op: "reconcile" })
  return await transaction(ctx, "reconcile", () => {
    const pending = new Set(request.ledger.pending)
    const emitted = new Set(request.ledger.emitted)
    const transitions: { delivery_id: string; from: DeliveryState; to: DeliveryState }[] = []
    const dual: string[] = []
    for (const row of selectRows(ctx, `target_durable_id = ? AND state IN ${OPEN_STATES}`, [target], "seq")) {
      let to: DeliveryState = row.state
      if (row.state === "queued") {
        if (row.expires_at <= request.now) {
          transition(ctx, row, "refused", request.now, { reason: "expired" })
          transitions.push({ delivery_id: row.delivery_id, from: row.state, to: "refused" })
        }
        continue
      }
      if (row.admitted_by !== null && sameProcess(row.admitted_by, request.self)) {
        to = emitted.has(row.delivery_id) ? "applied" : pending.has(row.delivery_id) ? "admitted" : "queued"
      } else if (row.admitted_by === null) {
        to = "queued"
      } else {
        const verdict = verdicts.get(row.delivery_id)
        if (verdict === undefined || verdict.fingerprint !== claimFingerprint(row) || verdict.to === "dual") {
          dual.push(row.delivery_id)
          continue
        }
        to = verdict.to
      }
      if (to === row.state) continue
      transition(ctx, row, to, request.now)
      transitions.push({ delivery_id: row.delivery_id, from: row.state, to })
    }
    for (const name of markerNames(ctx, target)) {
      const state = ctx.sql.one(["state"], "SELECT state FROM deliveries WHERE delivery_id = ?", [name])?.state
      if (state !== "queued") unlinkMarker(ctx, target, name)
    }
    const queued = selectRows(ctx, "target_durable_id = ? AND state = 'queued'", [target], "seq")
    return { queued, transitions, dual_runtime: dual }
  })
}

export async function claim(ctx: StoreContext, request: ClaimRequest): Promise<ClaimOutcome> {
  return await transaction(ctx, "claim", (): ClaimOutcome => {
    const row = selectRow(ctx, request.delivery_id)
    if (row === undefined || row.state !== "queued") return { kind: "lost", state: row?.state ?? null }
    if (row.expires_at <= request.now) {
      transition(ctx, row, "refused", request.now, { reason: "expired" })
      unlinkMarker(ctx, row.target_durable_id, row.delivery_id)
      return { kind: "lost", state: "refused" }
    }
    write(ctx, "UPDATE deliveries SET state = 'admitting', admitted_by = ?, claimed_at = ?, attempt = attempt + 1, mode_effective = ?, updated_at = ? WHERE delivery_id = ? AND state = 'queued'", [
      JSON.stringify(request.self), request.now, request.lane, request.now, request.delivery_id,
    ])
    unlinkMarker(ctx, row.target_durable_id, row.delivery_id)
    return { kind: "claimed", row: selectRow(ctx, request.delivery_id) as DeliveryRow }
  })
}

export async function recordOutcome(ctx: StoreContext, request: RecordOutcomeRequest): Promise<ClaimOutcome> {
  return await transaction(ctx, "record_outcome", (): ClaimOutcome => {
    const row = selectRow(ctx, request.delivery_id)
    if (row === undefined || (row.state !== "admitting" && row.state !== "admitted") || row.admitted_by === null || !sameProcess(row.admitted_by, request.self)) {
      return { kind: "lost", state: row?.state ?? null }
    }
    const outcome = request.outcome
    if (outcome.kind === "requeue") transition(ctx, row, "queued", request.now)
    else if (outcome.kind === "refused") transition(ctx, row, "refused", request.now, { reason: outcome.reason })
    else {
      write(ctx, "UPDATE deliveries SET admission_kind = ?, turn_epoch = ?, updated_at = ? WHERE delivery_id = ?", [outcome.admission_kind, outcome.turn_epoch, request.now, row.delivery_id])
      if (row.state !== outcome.kind) transition(ctx, row, outcome.kind, request.now)
    }
    return { kind: "claimed", row: selectRow(ctx, request.delivery_id) as DeliveryRow }
  })
}

export async function refuseQueued(ctx: StoreContext, request: { readonly now: number; readonly delivery_id: string; readonly reason: RefusalReason }): Promise<boolean> {
  return await transaction(ctx, "refuse", () => {
    const row = selectRow(ctx, request.delivery_id)
    if (row === undefined || row.state !== "queued") return false
    transition(ctx, row, "refused", request.now, { reason: request.reason })
    unlinkMarker(ctx, row.target_durable_id, row.delivery_id)
    return true
  })
}

export async function completeReceipt(ctx: StoreContext, request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly result: unknown }): Promise<boolean> {
  return await transaction(ctx, "complete_receipt", () => write(
    ctx,
    "UPDATE receipts SET status = 'completed', result = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?",
    [JSON.stringify(request.result), request.now, request.principal, request.idempotency_key, ctx.config.instance_id],
  ) === 1)
}

export async function abandonReceipt(ctx: StoreContext, request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly error_note: string }): Promise<boolean> {
  return await transaction(ctx, "abandon_receipt", () => write(
    ctx,
    "UPDATE receipts SET status = 'uncertain', error_note = ?, updated_at = ? WHERE principal = ? AND operation = 'deliver' AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?",
    [request.error_note, request.now, request.principal, request.idempotency_key, ctx.config.instance_id],
  ) === 1)
}

export function deliveryView(ctx: StoreContext, deliveryId: string): { readonly row: DeliveryRow; readonly queue_position: number } | null {
  const row = selectRow(ctx, deliveryId)
  return row === undefined ? null : { row, queue_position: queuePosition(ctx, row) }
}

export function listDeliveries(ctx: StoreContext, filter: { readonly target_durable_id?: string; readonly root_id?: string }): DeliveryRow[] {
  if (filter.target_durable_id !== undefined) return selectRows(ctx, "target_durable_id = ?", [filter.target_durable_id], "seq")
  if (filter.root_id !== undefined) return selectRows(ctx, "root_id = ?", [filter.root_id], "created_at, seq")
  return selectRows(ctx, "1 = 1", [], "created_at, seq")
}

export function isReferenced(ctx: StoreContext, durableId: string): boolean {
  const open = Number(ctx.sql.one(["n"], `SELECT COUNT(*) AS n FROM deliveries WHERE target_durable_id = ? AND state IN ${OPEN_STATES}`, [durableId])?.n ?? 0)
  if (open > 0) return true
  const bindings = Number(ctx.sql.one(["n"], "SELECT COUNT(*) AS n FROM bindings WHERE session_durable_id = ? AND status = 'active'", [durableId])?.n ?? 0)
  return bindings > 0 || markerNames(ctx, durableId).length > 0
}

export function journalMode(ctx: StoreContext): string {
  return String(ctx.sql.one(["journal_mode"], "SELECT journal_mode FROM pragma_journal_mode()")?.journal_mode ?? "")
}

export function stats(ctx: StoreContext): GatewayStoreStats {
  return { ...ctx.stats }
}

export async function migrateLegacyMailboxes(ctx: StoreContext, now: number): Promise<number> {
  let migrated = 0
  for (const directory of ctx.config.legacy_mailbox_directories) {
    const key = `legacy_mailbox:${directory}`
    if (ctx.sql.one(["value"], "SELECT value FROM gateway_meta WHERE key = ?", [key]) !== undefined) continue
    let items
    try {
      items = readLegacyMailbox(directory)
    } catch (error) {
      ctx.emit({ kind: "legacy_mailbox_invalid", directory, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (items === null) continue
    const user = safeUserName()
    // An item whose target is not a durable id can never be delivered: it is reported and the
    // directory is still marked migrated, because a later open could do no better. A directory that
    // cannot be read is not marked, so the next open tries again (`legacy_mailbox_invalid`).
    const skipped: readonly LegacyMailboxSkip[] = items.filter((item) => !DURABLE_ID_PATTERN.test(item.target)).map((item) => ({ message_seq: item.message_seq, target: item.target, reason: "invalid_target" }))
    const deliverable = items.filter((item) => DURABLE_ID_PATTERN.test(item.target))
    migrated += await transaction(ctx, "migrate_legacy", () => {
      let count = 0
      for (const item of deliverable) {
        const deliveryId = `legacy-${argsHash([directory, item.message_seq]).slice(0, 32)}`
        if (selectRow(ctx, deliveryId) !== undefined) continue
        const rootId = `root-${randomUUID()}`
        const sender = `legacy:${directory}`
        write(ctx, "INSERT INTO causal_roots (root_id, origin_principal, created_at, expires_at) VALUES (?, ?, ?, ?)", [rootId, sender, now, now + ROOT_LIFETIME_MS])
        const accepted = Date.parse(item.accepted_at)
        insertDelivery(ctx, {
          delivery_id: deliveryId,
          target_durable_id: item.target,
          seq: allocateSeq(ctx, item.target),
          sender,
          sender_turn: null,
          envelope: {
            origin: { external: { platform: "legacy_mailbox", account_id: user, chat_id: directory, thread_id: "@chat", message_id: item.operation_id } },
            actor: "legacy thread mailbox",
            via: [sender],
            root_id: rootId,
            hop: 1,
            delivery_id: deliveryId,
          },
          body: item.message,
          bytes: Buffer.byteLength(item.message),
          mode_requested: item.delivery,
          mode_effective: null,
          expected_turn_id: item.expected_turn_id,
          state: "queued",
          reason: null,
          admitted_by: null,
          claimed_at: null,
          attempt: 0,
          admission_kind: null,
          turn_epoch: null,
          root_id: rootId,
          hop: 1,
          created_at: Number.isFinite(accepted) ? accepted : now,
          updated_at: now,
          expires_at: now + QUEUED_TTL_MS,
          binding_id: null,
          binding_revision: null,
        })
        createMarker(ctx, item.target, deliveryId, true)
        count++
      }
      write(ctx, "INSERT INTO gateway_meta (key, value) VALUES (?, ?)", [key, JSON.stringify({ migrated_at: now, count, skipped })])
      return count
    })
    if (skipped.length > 0) ctx.emit({ kind: "legacy_mailbox_skipped", directory, items: skipped })
  }
  return migrated
}

function safeUserName(): string {
  try {
    return userInfo().username
  } catch {
    return "unknown"
  }
}
