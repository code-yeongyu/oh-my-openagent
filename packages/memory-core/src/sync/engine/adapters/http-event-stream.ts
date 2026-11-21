// The account event stream (`GET /v1/me/events`) behind the HTTP transport's subscribe: connect with a deadline,
// resume with `Last-Event-ID`, back off on a refusal or a 426 client floor, and hand each sync event to the engine (#14476).

import type { StreamHandlers } from "../ports"

export interface EventStreamOptions {
  readonly url: string
  /** The request headers (bearer and contract version), read per connect so a token refresh takes effect. */
  readonly headers: () => Promise<Record<string, string>>
  readonly fetch: typeof fetch
  /** How long the stream waits after a 426 before it reconnects; tests shorten it. */
  readonly floorRetryMs?: number
}

const STREAM_RETRY_MS = 5_000
const STREAM_CONNECT_MS = 3_000
/** A stream that lived this long before the service closed it resumes at once; a shorter one waits STREAM_RETRY_MS. */
const STREAM_RESUME_MIN_MS = 1_000
/** How long the event stream waits after a 426 client-floor refusal before it asks again (#14483). */
const STREAM_FLOOR_RETRY_MS = 15 * 60_000

/**
 * Waits `ms`, or less when the stream is closed, so a long floor wait never outlives its subscription. The abort listener
 * is removed when the timer fires, so repeated waits leave nothing behind on the subscription's signal (#14483 review M1).
 */
const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })

/**
 * Holds the stream open for as long as the subscription lives. A stream that delivered a cursor and lived at least
 * STREAM_RESUME_MIN_MS (the service closes each one after its bounded lifetime) is resumed at once with `Last-Event-ID`, so the service
 * replays what landed in between and the engine never drops to its poll for a routine reconnect. Any other end - a
 * refused, failed or stalled connect (each connect has a deadline), a broken stream, one that ended before its first
 * cursor or sooner than that - is reported as `onConnected(false, cause)` with the HTTP status and code or the
 * failure, and retried after STREAM_RETRY_MS; the engine polls meanwhile (#14476).
 */
export async function streamLoop(
  stream: EventStreamOptions,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let lastEventId: string | null = null
  while (!signal.aborted) {
    let cause: string
    const opened = Date.now()
    try {
      const headers: Record<string, string> = {
        ...(await stream.headers()),
        accept: "text/event-stream",
      }
      if (lastEventId !== null) headers["last-event-id"] = lastEventId
      const response = await connectWithin(stream.fetch, stream.url, headers, signal)
      if (response.status === 426) {
        // The client floor refuses this build until OmO is updated (#14483): no 5 s reconnect loop, but a slow retry,
        // so a floor the service lifts without a client update brings the stream (and an end to polling) back.
        handlers.onConnected(false, await refusalOf(response))
        await pause(stream.floorRetryMs ?? STREAM_FLOOR_RETRY_MS, signal)
        continue
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
    await pause(STREAM_RETRY_MS, signal)
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
