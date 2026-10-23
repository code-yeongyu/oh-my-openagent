import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  capture,
  createSpoolRoot,
  decodeLogs,
  logRecordsOf,
  makeTransport,
  recordingFetch,
  spoolNames,
} from "./otlp-test-support"

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-timeout-")
  cleanups.push(created.cleanup)
  return created.dir
}

/**
 * A real local collector, in its own process like a real one, that accepts every request and never
 * answers it. The request count is read from the lines it prints, so it is exact once the client is done.
 */
async function silentServer(): Promise<{ readonly url: string; readonly requests: () => number; readonly reached: (count: number) => Promise<void> }> {
  const server = Bun.spawn([process.execPath, join(import.meta.dir, "otlp-silent-server.ts")], { stdout: "pipe", stderr: "inherit" })
  cleanups.push(() => server.kill("SIGKILL"))
  const reader = server.stdout.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  let requests = 0
  const waiters: { readonly count: number; readonly resolve: () => void }[] = []
  let port: number | undefined
  let announce: () => void = () => undefined
  const announced = new Promise<void>((resolve) => {
    announce = resolve
  })
  void (async () => {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffered += decoder.decode(chunk.value)
      const lines = buffered.split("\n")
      buffered = lines.pop() ?? ""
      for (const line of lines) {
        if (line === "REQUEST") {
          requests += 1
          for (const waiter of waiters.filter((w) => w.count <= requests)) {
            waiters.splice(waiters.indexOf(waiter), 1)
            waiter.resolve()
          }
        } else if (port === undefined) {
          port = Number(line)
          announce()
        }
      }
    }
  })()
  await announced
  const reached = (count: number): Promise<void> =>
    count <= requests ? Promise.resolve() : new Promise<void>((resolve) => void waiters.push({ count, resolve }))
  return { url: `http://127.0.0.1:${port}`, requests: () => requests, reached }
}

function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<"settled" | "hung"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hung = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), ms)
  })
  return Promise.race([promise.then(() => "settled" as const), hung]).finally(() => clearTimeout(timer))
}

describe("request timeout", () => {
  test("#given a real collector that accepts and never answers #then every attempt times out, the flush settles and the batch goes back to the spool", async () => {
    // given
    const dir = root()
    const server = await silentServer()
    const transport = makeTransport(dir, { endpoint: server.url, fetch: globalThis.fetch, requestTimeoutMs: 100 })
    capture(transport, "feature_used", { feature: "a" })

    // when
    const outcome = await settlesWithin(transport.flush(), 30_000)

    // then
    expect(outcome).toBe("settled")
    expect(await settlesWithin(server.reached(6), 10_000)).toBe("settled")
    expect(server.requests()).toBe(6)
    expect(spoolNames(dir)).toEqual([expect.stringMatching(/^batch-logs-[0-9a-f-]{36}\.otlp$/)])
    await transport.shutdown()
  }, 40_000)

  test("#given a fake fetch that ignores its abort signal #then the request timeout still ends the attempt", async () => {
    // given
    const dir = root()
    let calls = 0
    const transport = makeTransport(dir, {
      requestTimeoutMs: 50,
      fetch: () => {
        calls += 1
        return new Promise<Response>(() => undefined)
      },
    })
    capture(transport, "feature_used", { feature: "a" })

    // when
    const outcome = await settlesWithin(transport.flush(), 30_000)

    // then
    expect(outcome).toBe("settled")
    expect(calls).toBe(6)
  }, 40_000)

  test("#given a host that never calls shutdown while a request hangs #then the process still exits on its own", async () => {
    // given
    const dir = root()
    const server = await silentServer()
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "otlp-timeout-child.ts"), dir, server.url], {
      stdout: "pipe",
      stderr: "inherit",
    })
    cleanups.push(() => child.kill("SIGKILL"))

    // when
    const outcome = await settlesWithin(child.exited, 60_000)

    // then
    expect(outcome).toBe("settled")
    expect(child.exitCode).toBe(0)
    expect(server.requests()).toBeGreaterThanOrEqual(1)
    expect(await new Response(child.stdout).text()).toBe("FLUSHING\n")
  }, 70_000)

  test("#given a send stuck past its own deadline #then the lease is no longer renewed, so another process can take the batch over", async () => {
    // given
    const dir = root()
    let now = Date.now()
    let onNow: (() => void) | undefined
    const nowMs = (): number => {
      onNow?.()
      return now
    }
    const nextClockRead = (): Promise<void> => new Promise((resolve) => {
      onNow = () => {
        onNow = undefined
        resolve()
      }
    })
    let markAsleep: () => void = () => undefined
    const asleep = new Promise<void>((resolve) => {
      markAsleep = resolve
    })
    const transport = makeTransport(dir, {
      nowMs,
      leaseRenewIntervalMs: 5,
      requestTimeoutMs: 100,
      fetch: recordingFetch(() => new Response(null, { status: 503 })).fetch,
      sleep: (_ms, abort) => {
        markAsleep()
        return new Promise<void>((resolve) => abort.addEventListener("abort", () => resolve(), { once: true }))
      },
    })
    capture(transport, "feature_used", { feature: "a" })
    const flushing = transport.flush()
    await asleep
    const leaseOf = (): number => Number(spoolNames(dir)[0]?.split("-").at(-1))
    const firstLease = leaseOf()

    // when
    now += 1_000
    await nextClockRead()
    await nextClockRead()
    const renewedLease = leaseOf()
    now += 60 * 60 * 1000
    await nextClockRead()
    await nextClockRead()
    await nextClockRead()
    const lateLease = leaseOf()

    // then
    expect(renewedLease).toBeGreaterThan(firstLease)
    expect(lateLease).toBe(renewedLease)
    await transport.shutdown()
    await flushing
  }, 30_000)
})

describe("real local collector", () => {
  test("#given a real Bun.serve collector answering 200 #then it receives the protobuf request with the ingest key and the spool empties", async () => {
    // given
    const dir = root()
    const bodies: Uint8Array[] = []
    const headers: Headers[] = []
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (request) => {
        headers.push(request.headers)
        bodies.push(new Uint8Array(await request.arrayBuffer()))
        return new Response(null, { status: 200 })
      },
    })
    cleanups.push(() => void server.stop(true))
    const transport = makeTransport(dir, { endpoint: `http://127.0.0.1:${server.port}`, fetch: globalThis.fetch })

    // when
    capture(transport, "feature_used", { feature: "real" })
    await transport.flush()

    // then
    expect(bodies.length).toBe(1)
    expect(headers[0]?.get("content-type")).toBe("application/x-protobuf")
    expect(headers[0]?.get("x-omo-ingest-key")).toBe("test-ingest-key")
    expect(logRecordsOf(decodeLogs(bodies[0] ?? new Uint8Array())).map((r) => r.eventName)).toEqual(["omo.feature_used"])
    expect(spoolNames(dir)).toEqual([])
  })
})
