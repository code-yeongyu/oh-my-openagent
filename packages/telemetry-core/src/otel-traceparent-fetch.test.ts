import { afterEach, describe, expect, test } from "bun:test"

import { createTraceparentFetch, OMO_TRACE_HOSTS } from "./otel-traceparent-fetch"
import type { OtlpFetch } from "./otlp-http"
import { capture, createSpoolRoot, makeTransport, recordingFetch } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function headerRecorder() {
  const seen: { url: string; traceparent: string | undefined }[] = []
  const fetch: OtlpFetch = async (url, init) => {
    seen.push({ url, traceparent: new Headers(init.headers).get("traceparent") ?? undefined })
    return new Response(null, { status: 200 })
  }
  return { seen, fetch }
}

describe("traceparent injection allowlist", () => {
  test("#given an active turn #when requests go to our hosts and to model providers #then only our hosts receive the turn's traceparent", async () => {
    // given
    const root = createSpoolRoot("telemetry-core-traceparent-")
    roots.push(root.cleanup)
    const transport = makeTransport(root.dir)
    const turn = transport.traces.startTurn({ attributes: { "gen_ai.operation.name": "chat" } })
    if (turn === undefined) throw new Error("turn span not started")
    const recorder = headerRecorder()
    const wrapped = createTraceparentFetch(recorder.fetch, OMO_TRACE_HOSTS)
    const urls = [
      "https://t.omo.dev/v1/logs",
      "https://api.omo.dev/v1/device",
      "https://api.anthropic.com/v1/messages",
      "https://api.openai.com/v1/responses",
      "https://openrouter.ai/api/v1/chat/completions",
      "https://t.omo.dev.attacker.example/v1/logs",
      "not a url",
    ]

    // when
    await turn.run(() => Promise.all(urls.map((url) => wrapped(url, { method: "POST", headers: { "content-type": "application/json" } }))))
    turn.end("ok")
    await wrapped("https://t.omo.dev/v1/logs", { method: "POST", headers: {} })

    // then
    expect(recorder.seen).toEqual([
      { url: "https://t.omo.dev/v1/logs", traceparent: turn.traceparent },
      { url: "https://api.omo.dev/v1/device", traceparent: turn.traceparent },
      { url: "https://api.anthropic.com/v1/messages", traceparent: undefined },
      { url: "https://api.openai.com/v1/responses", traceparent: undefined },
      { url: "https://openrouter.ai/api/v1/chat/completions", traceparent: undefined },
      { url: "https://t.omo.dev.attacker.example/v1/logs", traceparent: undefined },
      { url: "not a url", traceparent: undefined },
      { url: "https://t.omo.dev/v1/logs", traceparent: undefined },
    ])
  })

  test("#given the OTLP transport sends while a turn is active #when it posts to its configured collector #then that request carries the traceparent and keeps its own headers", async () => {
    // given
    const root = createSpoolRoot("telemetry-core-traceparent-sender-")
    roots.push(root.cleanup)
    const recorder = recordingFetch()
    const transport = makeTransport(root.dir, { fetch: recorder.fetch, endpoint: "https://collector.test" })
    const turn = transport.traces.startTurn({ attributes: { "gen_ai.operation.name": "chat" } })
    if (turn === undefined) throw new Error("turn span not started")

    // when
    await turn.run(async () => {
      capture(transport, "feature_used", { feature: "x" })
      await transport.flush()
    })
    turn.end("ok")

    // then
    expect(recorder.calls.map(({ url, headers }) => [url, headers["traceparent"], headers["x-omo-ingest-key"]])).toEqual([
      ["https://collector.test/v1/logs", turn.traceparent, "test-ingest-key"],
    ])
  })
})
