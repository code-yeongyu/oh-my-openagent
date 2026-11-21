import { expect, test } from "bun:test"

import { awaitWithinTestBudget } from "../../../../../../test-support/test-deadline"
import { createHttpTransport } from "./http-transport"

// #14476: a client that read the state before the service took inline batches keeps the upload form only until its
// next state read, and the announced-head pull skips that read. Each event-stream (re)connect re-reads the state
// while inline is not accepted, so a running device switches within one stream lifetime of the deploy.

function capabilityServer() {
  let inline = false
  let stateReads = 0
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
    stateReads: () => stateReads,
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

test("once inline is accepted, a stream connect does not read the state again", async () => {
  const server = capabilityServer()
  server.acceptInline()
  const transport = createHttpTransport({ baseUrl: "https://service.test", token: () => "tok", fetch: server.fetch })
  await transport.pull(0, 500)
  expect(inlineOf(transport) > 0).toBe(true)

  const connected: boolean[] = []
  const stop = transport.subscribe(handlers(connected))
  try {
    await awaitWithinTestBudget(
      (async () => {
        while (connected.length === 0) await new Promise((resolve) => setImmediate(resolve))
      })(),
      "the stream connect",
    )
    expect([connected, server.stateReads()]).toEqual([[true], 1])
  } finally {
    stop()
  }
})
