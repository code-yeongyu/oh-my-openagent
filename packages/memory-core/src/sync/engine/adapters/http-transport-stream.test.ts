import { expect, test } from "bun:test"

import { awaitWithinTestBudget } from "../../../../../../test-support/test-deadline"
import { createHttpTransport } from "./http-transport"

// The account event stream's lifecycle against the service's wire (omo-service core/src/events/routes.ts): each
// frame carries `id: <cursor>`, a stream closes after its bounded lifetime, a reconnect with Last-Event-ID replays
// what landed in between, and the stream route refuses with `{ error: { code } }` (#14476).

const encoder = new TextEncoder()

function sse(
  frames: readonly string[],
  close: boolean | Promise<void>,
  signal: AbortSignal | null | undefined,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      if (close === true) controller.close()
      else if (close !== false) void close.then(() => controller.close())
      signal?.addEventListener("abort", () => controller.error(signal.reason))
    },
  })
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

interface Connect {
  readonly lastEventId: string | null
}

function streamServer(answers: readonly ((signal: AbortSignal | null | undefined) => Response)[]) {
  const connects: Connect[] = []
  const waiting: { readonly count: number; readonly resolve: () => void }[] = []
  const serve = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    connects.push({ lastEventId: headers.get("last-event-id") })
    for (const w of waiting.filter((x) => connects.length >= x.count)) w.resolve()
    const answer = answers[connects.length - 1]
    if (answer === undefined) return sse([], false, init?.signal)
    return answer(init?.signal)
  }) as typeof fetch
  const untilConnects = (count: number) =>
    new Promise<void>((resolve) => {
      if (connects.length >= count) resolve()
      else waiting.push({ count, resolve })
    })
  return { fetch: serve, connects, untilConnects }
}

const advanced = (seq: number, cursor: string) =>
  `id: ${cursor}\ndata: ${JSON.stringify({ type: "sync.advanced", head: { seq, link: "A".repeat(43) } })}\n\n`

// Time is the behavior here: a stream counts as resumable only once it lived the retry wait.
const lived = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

test("a stream the service closes after its lifetime is resumed at once with Last-Event-ID, and the engine is never told it dropped", async () => {
  const server = streamServer([
    (signal) =>
      sse(
        ["retry: 2000\nid: p1.d0123456789abcdef\n\n", advanced(3, "p1.d0123456789abcdef.s3.n0.t0")],
        lived(5_100),
        signal,
      ),
  ])
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  const connected: boolean[] = []
  const heads: number[] = []
  const stop = transport.subscribe({
    onAdvanced: (head) => heads.push(head),
    onConnected: (up) => connected.push(up),
    onStateChanged: () => undefined,
  })
  try {
    await awaitWithinTestBudget(server.untilConnects(2), "the reconnect after the service closed the stream")
  } finally {
    stop()
  }
  expect(server.connects.map((c) => c.lastEventId)).toEqual([null, "p1.d0123456789abcdef.s3.n0.t0"])
  expect(heads).toEqual([3])
  expect(connected).toEqual([true, true])
})

test("a stream that delivers a cursor and ends at once is reported down before any reconnect, so repeated ends never spin", async () => {
  const server = streamServer([(signal) => sse([advanced(3, "p1.d0123456789abcdef.s3.n0.t0")], true, signal)])
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  let stop: () => void = () => undefined
  const reports: (readonly [boolean, string | undefined, number])[] = []
  const down = new Promise<void>((resolve) => {
    stop = transport.subscribe({
      onAdvanced: () => undefined,
      onConnected: (up, cause) => {
        reports.push([up, cause, server.connects.length])
        if (!up) resolve()
      },
      onStateChanged: () => undefined,
    })
  })
  try {
    await awaitWithinTestBudget(down, "the down report of a stream that ended early")
  } finally {
    stop()
  }
  expect(reports).toEqual([
    [true, undefined, 1],
    [false, "stream ended early", 1],
  ])
})

test("a connect that never answers is reported down once its deadline passes, and the stalled request is aborted", async () => {
  let aborted = false
  const stalled = (async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true
        reject(init.signal?.reason)
      })
    })) as typeof fetch
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: stalled })
  let stop: () => void = () => undefined
  const down = new Promise<readonly [boolean, string | undefined]>((resolve) => {
    stop = transport.subscribe({
      onAdvanced: () => undefined,
      onConnected: (up, cause) => resolve([up, cause]),
      onStateChanged: () => undefined,
    })
  })
  try {
    expect(await awaitWithinTestBudget(down, "the stalled connect's down report")).toEqual([false, "connect timed out"])
  } finally {
    stop()
  }
  expect(aborted).toBe(true)
})

test("a refused stream is reported down on the first attempt with the HTTP status and the service's code", async () => {
  const server = streamServer([
    () => Response.json({ error: { code: "rate_limited", message: "too many open update streams" } }, { status: 429 }),
  ])
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  let stop: () => void = () => undefined
  const down = new Promise<readonly [boolean, string | undefined]>((resolve) => {
    stop = transport.subscribe({
      onAdvanced: () => undefined,
      onConnected: (up, cause) => resolve([up, cause]),
      onStateChanged: () => undefined,
    })
  })
  try {
    expect(await awaitWithinTestBudget(down, "the refused stream's down report")).toEqual([
      false,
      "HTTP 429 rate_limited",
    ])
  } finally {
    stop()
  }
})

test("a stream that ends before sending any cursor is reported down instead of being retried in a tight loop", async () => {
  const server = streamServer([(signal) => sse([], true, signal)])
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  let stop: () => void = () => undefined
  const reports: (readonly [boolean, string | undefined])[] = []
  const down = new Promise<void>((resolve) => {
    stop = transport.subscribe({
      onAdvanced: () => undefined,
      onConnected: (up, cause) => {
        reports.push([up, cause])
        if (!up) resolve()
      },
      onStateChanged: () => undefined,
    })
  })
  try {
    await awaitWithinTestBudget(down, "the down report of a stream that ended with no cursor")
  } finally {
    stop()
  }
  expect(reports).toEqual([
    [true, undefined],
    [false, "stream ended before its first event id"],
  ])
  expect(server.connects).toHaveLength(1)
})
