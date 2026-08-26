// allow: SIZE_OK - the four dag query handlers share one parser vocabulary and one error mapping, so splitting them would duplicate the envelope contract.
import type { SenpiExtensionAPI } from "../../extension/types"

// The sequenced ledger channel these handlers hand a client back to. Kept as a literal so the
// handshake names the channel the viewer must already be listening on before it calls subscribe.
const DAG_EVENT_CHANNEL = "omo.dag.event"

const LIST_DEFAULT_LIMIT = 100
const LIST_MAX_LIMIT = 256
const HISTORY_DEFAULT_LIMIT = 256
const HISTORY_MAX_LIMIT = 1000

const RUN_STATUSES = new Set([
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
])

const EVENT_LANES = new Set(["activity", "boundary"])

export const DAG_RPC_ERROR_CODES = [
  "invalid_arguments",
  "run_not_found",
  "run_not_owned",
  "history_unavailable",
] as const

export type DagRpcErrorCode = (typeof DAG_RPC_ERROR_CODES)[number]

export type DagRpcEnvelope<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: { readonly code: DagRpcErrorCode; readonly message: string } }

// Structural mirrors of the dag domain contract (senpi-task/src/dag/{types,manager,store}.ts).
// Declared locally so this module stays a read-only consumer of whatever DagManager the extension
// wires in, exactly like `dag-status-ui.ts`.
export interface DagRpcRunSummary {
  readonly runId: string
  readonly status: string
  readonly updatedAt: string
}

export interface DagRpcRunSnapshot {
  readonly runId: string
  readonly status: string
  readonly lastSeq: number
}

export interface DagRpcEvent {
  readonly runId: string
  readonly seq: number
  readonly lane: string
  readonly type: string
}

export interface DagRpcHistoryPage {
  readonly events: readonly DagRpcEvent[]
  readonly nextSinceSeq: number
  readonly headSeq: number
  readonly hasMore: boolean
}

export interface DagRpcListValue {
  readonly runs: readonly DagRpcRunSummary[]
  readonly limit: number
}

export interface DagRpcSubscribeHandshake {
  readonly schemaVersion: 1
  readonly eventName: typeof DAG_EVENT_CHANNEL
  readonly snapshot: DagRpcRunSnapshot
  readonly highWaterSeq: number
  readonly page: DagRpcHistoryPage
}

export interface DagRpcHistoryQuery {
  readonly runId: string
  readonly parentSessionId: string
  readonly sinceSeq?: number
  readonly limit?: number
  readonly lane?: string
  readonly types?: readonly string[]
  readonly throughSeq?: number
}

// The read seam these handlers need from DagManager. Every rejection arrives as a thrown error
// carrying the engine `code`; nothing here reaches into the store directly.
export interface DagRpcQueryManager {
  list(parentSessionId: string, options?: { readonly limit?: number }): readonly DagRpcRunSummary[]
  snapshot(runId: string, parentSessionId: string): DagRpcRunSnapshot
  history(params: DagRpcHistoryQuery): DagRpcHistoryPage
}

export interface DagRpcHandlerDeps {
  readonly manager: DagRpcQueryManager
  // Undefined between sessions: no session owns anything, so run-scoped reads answer run_not_owned.
  readonly sessionId: () => string | undefined
}

type ParseResult<TValue> = { readonly value: TValue } | { readonly error: string }

export function registerDagRpcHandlers(pi: SenpiExtensionAPI, deps: DagRpcHandlerDeps): void {
  const handle = pi.rpc?.handle
  if (handle === undefined) return

  handle("omo.dag.list", (data) => {
    const input = parseList(data)
    if ("error" in input) return invalidArguments(input.error)
    const sessionId = deps.sessionId()
    if (sessionId === undefined) return ok<DagRpcListValue>({ runs: [], limit: input.value.limit })
    return attempt(() => {
      // The engine limit is applied before the status filter, so ask for the maximum window and
      // narrow here: a filtered query must never lose runs the window already dropped.
      const runs = deps.manager
        .list(sessionId, { limit: LIST_MAX_LIMIT })
        .filter((run) => input.value.statuses === undefined || input.value.statuses.includes(run.status))
        .slice(0, input.value.limit)
      return { runs, limit: input.value.limit } satisfies DagRpcListValue
    })
  })

  handle("omo.dag.snapshot", (data) => {
    const input = parseRunScoped(data)
    if ("error" in input) return invalidArguments(input.error)
    const sessionId = deps.sessionId()
    if (sessionId === undefined) return notOwned(input.value.runId)
    return attempt(() => deps.manager.snapshot(input.value.runId, sessionId))
  })

  handle("omo.dag.history", (data) => {
    const input = parseHistory(data)
    if ("error" in input) return invalidArguments(input.error)
    const sessionId = deps.sessionId()
    if (sessionId === undefined) return notOwned(input.value.runId)
    return attempt(() => deps.manager.history(historyQuery(input.value, sessionId)))
  })

  handle("omo.dag.subscribe", (data) => {
    const input = parseHistory(data)
    if ("error" in input) return invalidArguments(input.error)
    const sessionId = deps.sessionId()
    if (sessionId === undefined) return notOwned(input.value.runId)
    return attempt(() => {
      // Stateless catch-up handshake: no subscriber is registered anywhere. The snapshot is read
      // FIRST so highWaterSeq describes the ledger before the first page is read; the page is then
      // bounded by that mark, so a client paging omo.dag.history with the same throughSeq sees a
      // frozen window and dedupes live events by (runId, seq) without a gap or a duplicate.
      const snapshot = deps.manager.snapshot(input.value.runId, sessionId)
      const highWaterSeq = snapshot.lastSeq
      const page = deps.manager.history({
        ...historyQuery(input.value, sessionId),
        throughSeq: input.value.throughSeq === undefined
          ? highWaterSeq
          : Math.min(input.value.throughSeq, highWaterSeq),
      })
      return {
        schemaVersion: 1,
        eventName: DAG_EVENT_CHANNEL,
        snapshot,
        highWaterSeq,
        page,
      } satisfies DagRpcSubscribeHandshake
    })
  })
}

function historyQuery(
  params: HistoryParams,
  parentSessionId: string,
): DagRpcHistoryQuery {
  return {
    runId: params.runId,
    parentSessionId,
    sinceSeq: params.sinceSeq,
    limit: params.limit,
    ...(params.lane === undefined ? {} : { lane: params.lane }),
    ...(params.types === undefined ? {} : { types: params.types }),
    ...(params.throughSeq === undefined ? {} : { throughSeq: params.throughSeq }),
  }
}

// Nothing crosses the RPC boundary as a throw: an engine rejection becomes its own envelope code,
// and any other failure degrades to history_unavailable rather than a broken response.
function attempt<TValue>(operation: () => TValue): DagRpcEnvelope<TValue> {
  try {
    return ok(operation())
  } catch (error) {
    const code = errorCode(error)
    return fail(code, errorMessage(error))
  }
}

function errorCode(error: unknown): DagRpcErrorCode {
  if (typeof error !== "object" || error === null) return "history_unavailable"
  const code = (error as { readonly code?: unknown }).code
  if (code === "run_not_found" || code === "run_not_owned" || code === "invalid_arguments") return code
  return "history_unavailable"
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return "dag query failed"
}

interface ListParams {
  readonly statuses?: readonly string[]
  readonly limit: number
}

interface HistoryParams {
  readonly runId: string
  readonly sinceSeq: number
  readonly limit: number
  readonly lane?: string
  readonly types?: readonly string[]
  readonly throughSeq?: number
}

function parseList(value: unknown): ParseResult<ListParams> {
  if (!isRecord(value)) return { error: "Request must be an object." }
  const limit = parseLimit(value.limit, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  if ("error" in limit) return limit
  if (value.statuses === undefined) return { value: { limit: limit.value } }
  if (!Array.isArray(value.statuses)) return { error: "statuses must be an array of run statuses." }
  const statuses: string[] = []
  for (const status of value.statuses) {
    if (typeof status !== "string" || !RUN_STATUSES.has(status)) {
      return { error: `statuses must contain only ${[...RUN_STATUSES].join(", ")}.` }
    }
    statuses.push(status)
  }
  return { value: { statuses, limit: limit.value } }
}

function parseRunScoped(value: unknown): ParseResult<{ readonly runId: string }> {
  if (!isRecord(value)) return { error: "Request must be an object." }
  const runId = value.runId
  if (typeof runId !== "string" || runId.trim().length === 0) return { error: "runId is required." }
  return { value: { runId } }
}

function parseHistory(value: unknown): ParseResult<HistoryParams> {
  const runScoped = parseRunScoped(value)
  if ("error" in runScoped) return runScoped
  if (!isRecord(value)) return { error: "Request must be an object." }
  const sinceSeq = parseSeq(value.sinceSeq, "sinceSeq", 0)
  if ("error" in sinceSeq) return sinceSeq
  const limit = parseLimit(value.limit, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT)
  if ("error" in limit) return limit
  if (value.lane !== undefined && (typeof value.lane !== "string" || !EVENT_LANES.has(value.lane))) {
    return { error: `lane must be one of ${[...EVENT_LANES].join(", ")}.` }
  }
  const types = parseTypes(value.types)
  if ("error" in types) return types
  const throughSeq = value.throughSeq === undefined
    ? { value: undefined }
    : parseSeq(value.throughSeq, "throughSeq", 0)
  if ("error" in throughSeq) return throughSeq
  return {
    value: {
      runId: runScoped.value.runId,
      sinceSeq: sinceSeq.value,
      limit: limit.value,
      ...(value.lane === undefined ? {} : { lane: value.lane as string }),
      ...(types.value === undefined ? {} : { types: types.value }),
      ...(throughSeq.value === undefined ? {} : { throughSeq: throughSeq.value }),
    },
  }
}

function parseTypes(value: unknown): ParseResult<readonly string[] | undefined> {
  if (value === undefined) return { value: undefined }
  if (!Array.isArray(value)) return { error: "types must be an array of event types." }
  const types: string[] = []
  for (const type of value) {
    if (typeof type !== "string" || type.trim().length === 0) return { error: "types must contain only event types." }
    types.push(type)
  }
  return { value: types }
}

function parseLimit(value: unknown, fallback: number, max: number): ParseResult<number> {
  if (value === undefined) return { value: fallback }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { error: "limit must be a positive integer." }
  }
  return { value: Math.min(value, max) }
}

function parseSeq(value: unknown, field: string, fallback: number): ParseResult<number> {
  if (value === undefined) return { value: fallback }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { error: `${field} must be a non-negative integer.` }
  }
  return { value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function ok<TValue>(value: TValue): DagRpcEnvelope<TValue> {
  return { ok: true, value }
}

function fail<TValue>(code: DagRpcErrorCode, message: string): DagRpcEnvelope<TValue> {
  return { ok: false, error: { code, message } }
}

function invalidArguments<TValue>(message: string): DagRpcEnvelope<TValue> {
  return fail("invalid_arguments", message)
}

function notOwned<TValue>(runId: string): DagRpcEnvelope<TValue> {
  return fail("run_not_owned", `dag run "${runId}" belongs to another session`)
}
