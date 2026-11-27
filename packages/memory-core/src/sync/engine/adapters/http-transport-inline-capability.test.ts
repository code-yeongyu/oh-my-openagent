import { expect, test } from "bun:test"

import { awaitWithinTestBudget } from "../../../../../../test-support/test-deadline"
import { createHttpTransport } from "./http-transport"

// #14476: a client that read the state before the service took inline batches keeps the upload form only until its
// next state read, and the announced-head pull skips that read. Each event-stream (re)connect re-reads the state
// while inline is not accepted, so a running device switches within one stream lifetime of the deploy.

function capabilityServer() {
  let inline = false
  let stateReads = 0
  const posts: string[] = []
  const waiting: { readonly count: number; readonly resolve: () => void }[] = []
  const serve = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    if (path === "/v1/sync/state") {
      stateReads++
      for (const w of waiting.filter((x) => stateReads >= x.count)) w.resolve()
      return Response.json({
        head: { seq: 0 },
        oldest_retained_seq: 1,
        snapshot: null,
        ...(inline ? { accepts_inline_batches: true } : {}),
      })
    }
    if (path === "/v1/sync/batches" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { inline?: string; upload_id?: string }
      posts.push(body.inline !== undefined ? "inline" : `upload_id ${String(body.upload_id)}`)
      if (body.inline !== undefined && !inline)
        return Response.json({ error: { code: "invalid_request" } }, { status: 400 })
      return Response.json({ seq: 1 })
    }
    if (path === "/v1/sync/uploads" && init?.method === "POST") {
      posts.push("reserve")
      return Response.json({ upload_id: "u1" })
    }
    if (path === "/v1/sync/uploads/u1" && init?.method === "PUT") {
      posts.push("upload")
      return new Response(null, { status: 204 })
    }
    if (path === "/v1/sync/batches") return Response.json({ entries: [] })
    if (path === "/v1/me/events") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("id: p1.d0123456789abcdef\n\n"))
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason))
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    return Response.json({ error: { code: "not_found" } }, { status: 404 })
  }) as typeof fetch
  return {
    fetch: serve,
    acceptInline: () => void (inline = true),
    rejectInline: () => void (inline = false),
    stateReads: () => stateReads,
    posts: () => posts,
    untilStateReads: (count: number) =>
      new Promise<void>((resolve) => {
        if (stateReads >= count) resolve()
        else waiting.push({ count, resolve })
      }),
  }
}

const inlineOf = (transport: ReturnType<typeof createHttpTransport>): number => transport.inlineBytes?.() ?? 0

const handlers = (connected: boolean[]) => ({
  onAdvanced: () => undefined,
  onStateChanged: () => undefined,
  onConnected: (up: boolean) => void connected.push(up),
})

test("a stream connect re-reads the state while inline is not accepted, so a service that starts taking inline batches is picked up", async () => {
  const server = capabilityServer()
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  await transport.pull(0, 500)
  expect(inlineOf(transport)).toBe(0)

  server.acceptInline()
  const connected: boolean[] = []
  const stop = transport.subscribe(handlers(connected))
  try {
    await awaitWithinTestBudget(server.untilStateReads(2), "the state re-read on connect")
    await awaitWithinTestBudget(
      (async () => {
        while (inlineOf(transport) === 0) await new Promise((resolve) => setImmediate(resolve))
      })(),
      "the inline capability",
    )
    expect([connected, inlineOf(transport) > 0]).toEqual([[true], true])
  } finally {
    stop()
  }
})

// #14496 review M1: the re-read runs on every connect, so a service that stops taking inline batches is noticed too.
test("a stream connect re-reads the state when inline is accepted, so a service that stops taking inline batches is noticed", async () => {
  const server = capabilityServer()
  server.acceptInline()
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  await transport.pull(0, 500)
  expect(inlineOf(transport) > 0).toBe(true)

  server.rejectInline()
  const connected: boolean[] = []
  const stop = transport.subscribe(handlers(connected))
  try {
    await awaitWithinTestBudget(server.untilStateReads(2), "the state re-read on connect")
    await awaitWithinTestBudget(
      (async () => {
        while (inlineOf(transport) > 0) await new Promise((resolve) => setImmediate(resolve))
      })(),
      "the inline capability withdrawn",
    )
    expect([connected, inlineOf(transport)]).toEqual([[true], 0])
  } finally {
    stop()
  }
})

// #14496 review M1: an inline append the service refuses invalid_request (it stopped taking inline batches after this
// client's last state read) is sent once more through the upload form, and the next push does not try inline.
test("an inline append refused invalid_request lands through the upload form, and the next push skips inline", async () => {
  const server = capabilityServer()
  server.acceptInline()
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  await transport.pull(0, 500)
  server.rejectInline()
  const appended = await transport.append({
    inline: new Uint8Array([1, 2, 3]),
    uploadId: "",
    digest: "ab".repeat(32),
    baseSeq: 0,
    batchId: "B".repeat(22),
    epoch: 1,
    link: "L".repeat(43),
    recordSig: "S".repeat(86),
  })
  expect([appended, server.posts(), inlineOf(transport)]).toEqual([
    { ok: true, seq: 1 },
    ["inline", "reserve", "upload", "upload_id u1"],
    0,
  ])
})
