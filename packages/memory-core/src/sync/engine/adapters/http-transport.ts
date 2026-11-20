// Transport over the todo 15 sync routes (omo-service #463) and the account event stream.
// Digests travel as 43-char base64url and are handled as hex inside the engine. A pull reads
// `GET /v1/sync/batches?after=n` (at most 500 rows a page); when the cursor is below the retained
// history it first reads the snapshot from `GET /v1/sync/state`. Each batch row names its batch id
// (#463 contract 1.17.0; null on keyring rows); the engine checks it against the sealed header. Refusals arrive as
// `{ error: { code } }`; `stale_base` is answered with the head read back from the state route.
// Every request, the event stream included, carries syncRequestHeaders (#13691).

import { syncRequestHeaders } from "../../contract-version"
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

const STREAM_RETRY_MS = 5_000
/** omo-service contract SYNC_INLINE_BATCH_MAX_BYTES (#1315). */
const INLINE_BATCH_MAX_BYTES = 262_144
const STREAM_CONNECT_MS = 3_000
/** A stream that lived this long before the service closed it resumes at once; a shorter one waits STREAM_RETRY_MS. */
const STREAM_RESUME_MIN_MS = 1_000

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
      void streamLoop(options, doFetch, handlers, abort.signal)
      return () => abort.abort()
    },
  }
}

/**
 * Holds the stream open for as long as the subscription lives. A stream that delivered a cursor and lived at least
 * STREAM_RESUME_MIN_MS (the service closes each one after its bounded lifetime) is resumed at once with `Last-Event-ID`, so the service
 * replays what landed in between and the engine never drops to its poll for a routine reconnect. Any other end - a
 * refused, failed or stalled connect (each connect has a deadline), a broken stream, one that ended before its first
 * cursor or sooner than that - is reported as `onConnected(false, cause)` with the HTTP status and code or the
 * failure, and retried after STREAM_RETRY_MS; the engine polls meanwhile (#14476).
 */
async function streamLoop(
  options: HttpTransportOptions,
  doFetch: typeof fetch,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let lastEventId: string | null = null
  while (!signal.aborted) {
    let cause: string
    const opened = Date.now()
    try {
      const headers: Record<string, string> = {
        ...syncRequestHeaders(await bearer(options)),
        accept: "text/event-stream",
      }
      if (lastEventId !== null) headers["last-event-id"] = lastEventId
      const response = await connectWithin(doFetch, `${options.baseUrl}/v1/me/events`, headers, signal)
      if (response.status === 426) {
        // The client floor refuses this build until OmO is updated (#14483): stop reconnecting and let the engine's
        // paced recheck (polling while the stream is down) notice a lifted floor instead of a 5 s reconnect loop.
        handlers.onConnected(false, await refusalOf(response))
        return
      }
      if (!response.ok || response.body === null) cause = await refusalOf(response)
      else {
        handlers.onConnected(true)
        let resumable = false
        for await (const frame of streamFrames(response.body)) {
          if (frame.id !== null) {
            lastEventId = frame.id
            resumable = true
          }
          const event = streamEvent(frame.data)
          if (event?.kind === "advanced") handlers.onAdvanced(event.head)
          else if (event?.kind === "state") handlers.onStateChanged()
        }
        // A stream that lived past the floor resumes at once; one that ended sooner is retried after the full wait like
        // any other failure, so an endpoint that keeps ending streams early never spins the loop.
        if (resumable && Date.now() - opened >= STREAM_RESUME_MIN_MS) continue
        cause = resumable ? "stream ended early" : "stream ended before its first event id"
      }
    } catch (error) {
      if (signal.aborted) return
      if (!(error instanceof Error)) throw error
      cause = error instanceof ConnectTimeout ? "connect timed out" : error.name
    }
    handlers.onConnected(false, cause)
    await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_MS))
  }
}

class ConnectTimeout extends Error {
  override readonly name = "ConnectTimeout"
}

/** Every connect, a resume included, answers within STREAM_CONNECT_MS or fails, so a stalled one is reported down. */
async function connectWithin(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  const deadline = new AbortController()
  const timer = setTimeout(
    () => deadline.abort(new ConnectTimeout("the event stream did not answer in time")),
    STREAM_CONNECT_MS,
  )
  try {
    return await doFetch(url, { headers, signal: AbortSignal.any([signal, deadline.signal]) })
  } catch (error) {
    if (deadline.signal.aborted && !signal.aborted) throw deadline.signal.reason
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function refusalOf(response: Response): Promise<string> {
  const code = await response.json().then(
    (b: unknown) => (b as { error?: { code?: string } }).error?.code ?? "no code",
    () => "no code",
  )
  return `HTTP ${response.status} ${code}`
}

/** The stream's frames: the `id:` field (the service's resume cursor) and the joined `data:` lines. */
async function* streamFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ readonly id: string | null; readonly data: string }> {
  let buffer = ""
  const decoder = new TextDecoder()
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let end = buffer.indexOf("\n\n")
    while (end >= 0) {
      const lines = buffer.slice(0, end).split("\n")
      buffer = buffer.slice(end + 2)
      end = buffer.indexOf("\n\n")
      const id = lines.findLast((line) => line.startsWith("id:"))
      yield {
        id: id === undefined ? null : id.slice(3).trim(),
        data: lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n"),
      }
    }
  }
}

type StreamEvent = { readonly kind: "advanced"; readonly head: number } | { readonly kind: "state" }

function streamEvent(data: string): StreamEvent | null {
  if (data === "") return null
  const event = JSON.parse(data) as { type?: string; head?: { seq?: number } }
  if (event.type === "sync.state.changed") return { kind: "state" }
  if (event.type !== "sync.advanced" && event.type !== "sync.keyring.changed") return null
  return typeof event.head?.seq === "number" ? { kind: "advanced", head: event.head.seq } : null
}
