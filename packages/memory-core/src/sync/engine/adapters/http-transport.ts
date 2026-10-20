// Transport over the todo 15 sync routes (omo-service #463) and the account event stream.
// Digests travel as 43-char base64url and are handled as hex inside the engine. A pull reads
// `GET /v1/sync/batches?after=n` (at most 500 rows a page); when the cursor is below the retained
// history it first reads the snapshot from `GET /v1/sync/state`. Each batch row names its batch id
// (#463 contract 1.17.0; null on keyring rows); the engine checks it against the sealed header. Refusals arrive as
// `{ error: { code } }`; `stale_base` is answered with the head read back from the state route.

import type { AppendRequest, AppendResult, PulledEntry, PullPage, SnapshotRef, StreamHandlers, Transport } from "../ports"

export const b64urlOfHex = (hex: string): string => Buffer.from(hex, "hex").toString("base64url")
export const hexOfB64url = (b64url: string): string => Buffer.from(b64url, "base64url").toString("hex")

const STREAM_RETRY_MS = 5_000

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

export interface HttpTransportOptions {
  readonly baseUrl: string
  /** The device's bearer token, read per request so a refresh takes effect. */
  readonly token: () => string | Promise<string>
  readonly fetch?: typeof fetch
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
  readonly oldest_retained_seq: number
  readonly snapshot: { readonly covers_seq: number; readonly chunk_object_ids: readonly string[] } | null
}

export function createHttpTransport(options: HttpTransportOptions): Transport {
  const doFetch = options.fetch ?? fetch
  const request = async (method: string, path: string, body?: string | Uint8Array, json = true): Promise<Response> => {
    const headers: Record<string, string> = { authorization: `Bearer ${await options.token()}` }
    if (body !== undefined && json) headers["content-type"] = "application/json"
    const response = await doFetch(`${options.baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body }) })
    if (response.ok) return response
    const code = await response.json().then(
      (b: unknown) => (b as { error?: { code?: string } }).error?.code ?? "unknown",
      () => "unknown",
    )
    throw new SyncHttpError(response.status >= 500 ? "unavailable" : code, response.status, response.status >= 500)
  }
  const readState = async (): Promise<WireState> => (await request("GET", "/v1/sync/state")).json() as Promise<WireState>
  const entryOf = (row: WireRow): PulledEntry => ({
    seq: row.seq,
    kind: row.kind,
    batchId: row.batch_id,
    digest: hexOfB64url(row.digest),
    objectId: row.object_id ?? "",
    author: `${row.author.kind}:${row.author.id}`,
  })
  return {
    async pull(after, limit): Promise<PullPage> {
      const state = await readState()
      const s = state.snapshot
      const snapshot: SnapshotRef | null =
        s !== null && after < state.oldest_retained_seq - 1 ? { coversSeq: s.covers_seq, objectIds: s.chunk_object_ids, digest: null } : null
      const from = snapshot === null ? after : Math.max(after, snapshot.coversSeq)
      const page = (await (await request("GET", `/v1/sync/batches?after=${from}`)).json()) as { entries: readonly WireRow[] }
      const rows = page.entries.slice(0, limit)
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
    async append(req: AppendRequest): Promise<AppendResult> {
      const body = JSON.stringify({
        upload_id: req.uploadId,
        digest: b64urlOfHex(req.digest),
        base_seq: req.baseSeq,
        idempotency_key: req.batchId,
        epoch: req.epoch,
        link: req.link,
        record_sig: req.recordSig,
      })
      try {
        return { ok: true, seq: ((await (await request("POST", "/v1/sync/batches", body)).json()) as { seq: number }).seq }
      } catch (error) {
        if (!(error instanceof SyncHttpError && error.code === "stale_base")) throw error
        return { ok: false, error: "stale_base", head: (await readState()).head.seq }
      }
    },
    subscribe(handlers: StreamHandlers) {
      const abort = new AbortController()
      void streamLoop(options, doFetch, handlers, abort.signal)
      return () => abort.abort()
    },
  }
}

async function streamLoop(options: HttpTransportOptions, doFetch: typeof fetch, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    let up = false
    try {
      const response = await doFetch(`${options.baseUrl}/v1/me/events`, {
        headers: { authorization: `Bearer ${await options.token()}`, accept: "text/event-stream" },
        signal,
      })
      if (!response.ok || response.body === null) throw new SyncHttpError("stream", response.status, true)
      up = true
      handlers.onConnected(true)
      let buffer = ""
      const decoder = new TextDecoder()
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        let end = buffer.indexOf("\n\n")
        while (end >= 0) {
          const head = advancedHead(buffer.slice(0, end))
          if (head !== null) handlers.onAdvanced(head)
          buffer = buffer.slice(end + 2)
          end = buffer.indexOf("\n\n")
        }
      }
    } catch (error) {
      if (signal.aborted) return
      if (!(error instanceof Error)) throw error
    }
    if (up) handlers.onConnected(false)
    if (signal.aborted) return
    await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_MS))
  }
}

function advancedHead(frame: string): number | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
  if (data === "") return null
  const event = JSON.parse(data) as { type?: string; head?: { seq?: number } }
  if (event.type !== "sync.advanced" && event.type !== "sync.keyring.changed") return null
  return typeof event.head?.seq === "number" ? event.head.seq : null
}
