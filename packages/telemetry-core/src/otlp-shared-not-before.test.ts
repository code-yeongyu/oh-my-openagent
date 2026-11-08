import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { MAX_RETRY_AFTER_MS, maxSendMs, postWithRetry } from "./otlp-http"
import { createSpoolNotBefore } from "./otlp-spool-not-before"
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
      call === 1 ? new Response(null, { status: 429, headers: { "retry-after": "30" } }) : new Response(null, { status: 200 }),
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

  test("#given every attempt waits out the shared time and every reply is a 429 with the longest Retry-After #when one batch is sent #then the whole send stays within maxSendMs", async () => {
    // given
    const requestTimeoutMs = 10_000
    const slept: number[] = []
    let fetches = 0

    // when
    const outcome = await postWithRetry(
      {
        fetch: async () => {
          fetches += 1
          return new Response(null, { status: 429, headers: { "retry-after": String(MAX_RETRY_AFTER_MS / 1000) } })
        },
        sleep: async (ms) => void slept.push(ms),
        random: () => 0.999,
        endpoint: "https://collector.invalid",
        ingestKey: "key",
        abort: new AbortController().signal,
        requestTimeoutMs,
        notBefore: { read: () => Date.now() + 10 * MAX_RETRY_AFTER_MS, defer: () => {} },
      },
      "logs",
      new Uint8Array([1]),
    )

    // then: each attempt can also run to its request timeout, so that is added for every fetch
    expect(outcome).toEqual({ kind: "retry_later" })
    const worstCaseMs = slept.reduce((total, ms) => total + ms, 0) + fetches * requestTimeoutMs
    expect(worstCaseMs).toBeLessThanOrEqual(maxSendMs(requestTimeoutMs))
  })

  test("#given a shared time hours ahead #when it is read #then it costs one Retry-After window and the file is cut back to it", () => {
    // given
    const { dir, cleanup } = createSpoolRoot("telemetry-core-not-before-far-")
    roots.push(cleanup)
    mkdirSync(dirname(dir), { recursive: true })
    writeFileSync(`${dir}.not-before`, String(Date.now() + 10 * 60 * 60_000))

    // when
    const before = Date.now()
    const read = createSpoolNotBefore(dir).read()

    // then
    expect(read).toBeLessThanOrEqual(Date.now() + MAX_RETRY_AFTER_MS)
    expect(read).toBeGreaterThanOrEqual(before + MAX_RETRY_AFTER_MS)
    expect(Number(readFileSync(`${dir}.not-before`, "utf8"))).toBeLessThanOrEqual(Date.now() + MAX_RETRY_AFTER_MS)
  })

  test("#given the shared file cannot be replaced #when a later time is deferred #then no temp file is left beside the spool", () => {
    // given: a directory where the file belongs, so the rename onto it fails
    const { dir, cleanup } = createSpoolRoot("telemetry-core-not-before-rename-")
    roots.push(cleanup)
    mkdirSync(`${dir}.not-before`, { recursive: true })

    // when
    createSpoolNotBefore(dir).defer(Date.now() + 5_000)

    // then
    expect(readdirSync(dirname(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  test("#given the temp file path is a directory #when a later time is deferred #then the failed write and cleanup stay inside defer", () => {
    // given: a directory at the temp path, so the write fails and the cleanup's rm throws too
    const { dir, cleanup } = createSpoolRoot("telemetry-core-not-before-temp-dir-")
    roots.push(cleanup)
    mkdirSync(`${dir}.not-before.${process.pid}.tmp`, { recursive: true })
    const notBefore = createSpoolNotBefore(dir)

    // when
    const defer = () => notBefore.defer(Date.now() + 5_000)

    // then
    expect(defer).not.toThrow()
  })
})
