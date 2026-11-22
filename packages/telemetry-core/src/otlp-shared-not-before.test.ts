import { afterEach, describe, expect, test } from "bun:test"

import { capture, createSpoolRoot, makeTransport, recordingFetch } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

describe("per-install 429 backoff shared across processes", () => {
  test("#given one process of an install got a 429 with Retry-After #then the install's other processes send nothing before that time", async () => {
    // given: two senders over one spool directory, as two processes of one install
    const { dir, cleanup } = createSpoolRoot("telemetry-core-not-before-")
    roots.push(cleanup)
    const log: string[] = []
    const first = recordingFetch((_url, call) =>
      call === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "30" } })
        : new Response(null, { status: 200 }),
    )
    const throttled = makeTransport(dir, {
      fetch: async (url, init) => {
        log.push("throttled:fetch")
        return first.fetch(url, init)
      },
      sleep: async (ms: number) => void log.push(`throttled:sleep:${ms}`),
    })
    capture(throttled, "feature_used", { feature: "a" })
    await throttled.flush()

    const otherDelays: number[] = []
    const other = makeTransport(dir, {
      fetch: async () => {
        log.push("other:fetch")
        return new Response(null, { status: 200 })
      },
      sleep: async (ms: number) => {
        otherDelays.push(ms)
        log.push("other:sleep")
      },
    })

    // when: the other process has its own batch to send
    capture(other, "feature_used", { feature: "b" })
    await other.flush()

    // then: it waited out the install's Retry-After before its first request
    const firstOtherFetch = log.indexOf("other:fetch")
    expect(firstOtherFetch).toBeGreaterThan(-1)
    expect(log.slice(0, firstOtherFetch)).toContain("other:sleep")
    expect(otherDelays[0]).toBeGreaterThan(25_000)
    expect(otherDelays[0]).toBeLessThanOrEqual(30_000)
  })
})
