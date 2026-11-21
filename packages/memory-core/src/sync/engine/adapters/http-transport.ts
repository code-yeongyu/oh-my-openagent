// Transport over the todo 15 sync routes (omo-service #463) and the account event stream.
// Digests travel as 43-char base64url and are handled as hex inside the engine. A pull reads
// `GET /v1/sync/batches?after=n` (at most 500 rows a page); when the cursor is below the retained
// history it first reads the snapshot from `GET /v1/sync/state`. Each batch row names its batch id
// (#463 contract 1.17.0; null on keyring rows); the engine checks it against the sealed header. Refusals arrive as
// `{ error: { code } }`; `stale_base` is answered with the head read back from the state route.
// Every request, the event stream included, carries syncRequestHeaders (#13691). The event stream itself lives in
// http-event-stream.ts.

import { syncRequestHeaders } from "../../contract-version"
import { streamLoop } from "./http-event-stream"
import type {
  AppendRequest,
  AppendResult,
  PulledEntry,
  PullPage,
  SnapshotRef,
  StreamHandlers,
  Transport,
} from "../ports"

export const b64urlOfHex = (hex: string): string => Buffer.from(hex, "hex").toString("base64url")
export const hexOfB64url = (b64url: string): string => Buffer.from(b64url, "base64url").toString("hex")

/** omo-service contract SYNC_INLINE_BATCH_MAX_BYTES (#1315). */
const INLINE_BATCH_MAX_BYTES = 262_144

export class SyncHttpError extends Error {
  override readonly name = "SyncHttpError"
  constructor(
    readonly code: string,
    readonly status: number,
    readonly transient: boolean,
  ) {
    super(`sync request refused: ${code} (${status})`)
  }
}

/** The device's bearer token could not be read or refreshed: its sign-in has expired or was refused. */
export class SyncAuthError extends Error {
  override readonly name = "SyncAuthError"
  constructor(cause: unknown) {
    super("the device's sign-in token could not be read or refreshed", { cause })
  }
}

/** The sync service could not be reached at all: no network, DNS, a refused or reset connection. */
export class SyncNetworkError extends Error {
  override readonly name = "SyncNetworkError"
  constructor(cause: unknown) {
    super("the sync service could not be reached", { cause })
  }
}

export interface HttpTransportOptions {
  readonly baseUrl: string
  /** The device's bearer token, read per request so a refresh takes effect. */
  readonly token: () => string | Promise<string>
  readonly fetch?: typeof fetch
  /** How long the event stream waits after a 426 before it reconnects; tests shorten it. */
  readonly floorRetryMs?: number
}

interface WireRow {
  readonly seq: number
  readonly kind: "batch" | "keyring"
  readonly author: { readonly kind: string; readonly id: string }
  readonly digest: string
  readonly object_id: string | null
  readonly batch_id: string | null
}

interface WireState {
  readonly head: { readonly seq: number }
  readonly accepts_inline_batches?: boolean
  readonly oldest_retained_seq: number
  readonly snapshot: { readonly covers_seq: number; readonly chunk_object_ids: readonly string[] } | null
}

async function bearer(options: HttpTransportOptions): Promise<string> {
  try {
    return await options.token()
  } catch (error) {
    throw new SyncAuthError(error)
  }
}

export function createHttpTransport(options: HttpTransportOptions): Transport {
  const doFetch = options.fetch ?? fetch
  const request = async (method: string, path: string, body?: string | Uint8Array, json = true): Promise<Response> => {
    const headers = syncRequestHeaders(await bearer(options))
    if (body !== undefined && json) headers["content-type"] = "application/json"
    const response = await doFetch(`${options.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    }).catch((error: unknown) => {
      throw new SyncNetworkError(error)
    })
    if (response.ok) return response
    const code = await response.json().then(
      (b: unknown) => (b as { error?: { code?: string } }).error?.code ?? "unknown",
      () => "unknown",
    )
    throw new SyncHttpError(response.status >= 500 ? "unavailable" : code, response.status, response.status >= 500)
  }
  // The service's answer on the latest state read: whether an append may carry its object inline (omo-service #1315).
  let inlineAccepted = false
  const readState = async (): Promise<WireState> => {
    const state = (await (await request("GET", "/v1/sync/state")).json()) as WireState
    inlineAccepted = state.accepts_inline_batches === true
    return state
  }
  const entryOf = (row: WireRow): PulledEntry => ({
    seq: row.seq,
    kind: row.kind,
    batchId: row.batch_id,
    digest: hexOfB64url(row.digest),
    objectId: row.object_id ?? "",
    author: `${row.author.kind}:${row.author.id}`,
  })
  let oldestRetained: number | null = null
  const page = async (from: number): Promise<readonly WireRow[]> =>
    ((await (await request("GET", `/v1/sync/batches?after=${from}`)).json()) as { entries: readonly WireRow[] }).entries
  return {
    async pull(after, limit, advertised): Promise<PullPage> {
      // An announced head inside the retained history (a state read showed where it starts) is answered by the
      // batches page alone when its rows start right after the cursor and reach that head: no snapshot is due and
      // the head is known, so the state read is skipped (#14476). Anything else reads the state as before.
      if (advertised !== undefined && advertised > after && oldestRetained !== null && after >= oldestRetained - 1) {
        const rows = (await page(after)).slice(0, limit)
        const last = rows.at(-1)?.seq
        if (last !== undefined && rows[0]?.seq === after + 1 && last >= advertised)
          return { snapshot: null, entries: rows.map(entryOf), head: last, more: false }
      }
      const state = await readState()
      oldestRetained = state.oldest_retained_seq
      const s = state.snapshot
      const snapshot: SnapshotRef | null =
        s !== null && after < state.oldest_retained_seq - 1
          ? { coversSeq: s.covers_seq, objectIds: s.chunk_object_ids, digest: null }
          : null
      const from = snapshot === null ? after : Math.max(after, snapshot.coversSeq)
      const rows = (await page(from)).slice(0, limit)
      const last = rows.at(-1)?.seq ?? from
      return { snapshot, entries: rows.map(entryOf), head: Math.max(state.head.seq, last), more: last < state.head.seq }
    },
    async download(objectId) {
      return new Uint8Array(await (await request("GET", `/v1/sync/objects/${objectId}`)).arrayBuffer())
    },
    async reserve(size, digest) {
      const body = JSON.stringify({ kind: "batch", bytes: size, sha256: b64urlOfHex(digest) })
      return ((await (await request("POST", "/v1/sync/uploads", body)).json()) as { upload_id: string }).upload_id
    },
    async upload(uploadId, bytes) {
      await request("PUT", `/v1/sync/uploads/${uploadId}`, bytes, false)
    },
    inlineBytes: () => (inlineAccepted ? INLINE_BATCH_MAX_BYTES : 0),
    async append(req: AppendRequest): Promise<AppendResult> {
      const body = JSON.stringify({
        ...(req.inline === undefined
          ? { upload_id: req.uploadId }
          : { inline: Buffer.from(req.inline).toString("base64url") }),
        digest: b64urlOfHex(req.digest),
        base_seq: req.baseSeq,
        idempotency_key: req.batchId,
        epoch: req.epoch,
        link: req.link,
        record_sig: req.recordSig,
      })
      try {
        return {
          ok: true,
          seq: ((await (await request("POST", "/v1/sync/batches", body)).json()) as { seq: number }).seq,
        }
      } catch (error) {
        if (!(error instanceof SyncHttpError && error.code === "stale_base")) throw error
        return { ok: false, error: "stale_base", head: (await readState()).head.seq }
      }
    },
    subscribe(handlers: StreamHandlers) {
      const abort = new AbortController()
      void streamLoop(
        {
          url: `${options.baseUrl}/v1/me/events`,
          headers: async () => syncRequestHeaders(await bearer(options)),
          fetch: doFetch,
          ...(options.floorRetryMs === undefined ? {} : { floorRetryMs: options.floorRetryMs }),
        },
        handlers,
        abort.signal,
      )
      return () => abort.abort()
    },
  }
}
