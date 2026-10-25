import { afterEach, describe, expect, test } from "bun:test"

import { parseRetryAfter } from "./otlp-http"
import { capture, createSpoolRoot, makeTransport, recordingFetch, spoolNames } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-retry-")
  roots.push(created.cleanup)
  return created.dir
}

function sleepRecorder() {
  const delays: number[] = []
  return { delays, sleep: async (ms: number) => void delays.push(ms) }
}

describe("OTLP retry policy", () => {
  test("#given 503 on every try #then it backs off 1,2,4,8,16 s (+jitter from the injected source) and renames the file back for later", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch(() => new Response(null, { status: 503 }))
    const { delays, sleep } = sleepRecorder()
    const transport = makeTransport(dir, { fetch, sleep, random: () => 0.5 })

    // when
    capture(transport, "feature_used", { feature: "a" })
    await transport.flush()

    // then
    expect(calls.length).toBe(6)
    expect(delays).toEqual([1_100, 2_200, 4_400, 8_800, 17_600])
    expect(spoolNames(dir).length).toBe(1)
    expect(spoolNames(dir)[0]).toMatch(/^batch-logs-[0-9a-f-]{36}\.otlp$/)
  })

  test("#given 429 with Retry-After #then the header wins over the backoff, capped at 60 s", async () => {
    // given
    const dir = root()
    const answers = [
      new Response(null, { status: 429, headers: { "retry-after": "7" } }),
      new Response(null, { status: 503, headers: { "retry-after": "120" } }),
      new Response(null, { status: 200 }),
    ]
    const { calls, fetch } = recordingFetch((_url, call) => answers[call - 1] ?? new Response(null, { status: 200 }))
    const { delays, sleep } = sleepRecorder()
    const transport = makeTransport(dir, { fetch, sleep })

    // when
    capture(transport, "feature_used", { feature: "a" })
    await transport.flush()

    // then
    expect(delays).toEqual([7_000, 60_000])
    expect(calls.length).toBe(3)
    expect(spoolNames(dir)).toEqual([])
    expect(parseRetryAfter(new Date(Date.now() + 30_000).toUTCString(), Date.now())).toBeLessThanOrEqual(30_000)
  })

  test("#given a network error then 200 #then the batch is retried and delivered once", async () => {
    // given
    const dir = root()
    let call = 0
    const { delays, sleep } = sleepRecorder()
    const transport = makeTransport(dir, {
      sleep,
      fetch: async () => {
        call += 1
        if (call === 1) throw new TypeError("connection reset")
        return new Response(null, { status: 200 })
      },
    })

    // when
    capture(transport, "feature_used", { feature: "a" })
    await transport.flush()

    // then
    expect(call).toBe(2)
    expect(delays).toEqual([1_000])
    expect(spoolNames(dir)).toEqual([])
  })

  for (const status of [400, 401, 413]) {
    test(`#given ${status} #then the batch is never retried, its file is deleted and its records counted as rejected`, async () => {
      // given
      const dir = root()
      const { calls, fetch } = recordingFetch(() => new Response(null, { status }))
      const transport = makeTransport(dir, { fetch })

      // when
      for (const feature of ["a", "b", "c"]) capture(transport, "feature_used", { feature })
      await transport.flush()

      // then
      expect(calls.length).toBe(1)
      expect(spoolNames(dir)).toEqual([])
      expect(transport.droppedEvents()).toBe(3)
    })
  }

  test("#given 200 on /v1/logs and 503 on /v1/traces #then only the logs file is deleted and the traces file is renamed back and resent later", async () => {
    // given
    const dir = root()
    let tracesUp = false
    const { calls, fetch } = recordingFetch((url) =>
      new Response(null, { status: url.endsWith("/v1/traces") && !tracesUp ? 503 : 200 }))
    const transport = makeTransport(dir, { fetch })
    capture(transport, "feature_used", { feature: "a" })
    transport.tracer.startSpan("omo.turn").end()

    // when
    await transport.flush()
    const afterFirst = spoolNames(dir)
    tracesUp = true
    await transport.flush()

    // then
    expect(afterFirst.length).toBe(1)
    expect(afterFirst[0]).toMatch(/^batch-traces-[0-9a-f-]{36}\.otlp$/)
    expect(calls.filter((c) => c.url.endsWith("/v1/logs")).length).toBe(1)
    expect(calls.filter((c) => c.url.endsWith("/v1/traces")).length).toBe(7)
    expect(spoolNames(dir)).toEqual([])
  }, 30_000)
})
