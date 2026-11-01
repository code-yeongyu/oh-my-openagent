import { expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSenpiOtlpTransport, createSenpiTelemetryTransportFactory } from "./otlp"

const hash = "a".repeat(64)
const key = `v1.omo-senpi.${hash}.kid.mac`
const message = { distinctId: hash, event: "daily_active", properties: { package_version: "1.0.0" } }

function fixture(register: (request: Request) => Response | Promise<Response> = () => Response.json({ key }), status = 200) {
  const root = mkdtempSync(join(tmpdir(), "omo-ingest-key-"))
  const requests: { path: string; key: string | null; body: string }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      requests.push({ path, key: request.headers.get("x-omo-ingest-key"), body: path === "/v1/register" ? await request.clone().text() : "" })
      if (path === "/v1/register") return register(request)
      return path === "/v1/logs" ? new Response(status === 401 ? '{"error":"bad_key"}' : null, { status }) : Response.json({})
    },
  })
  const env = { OMO_CODING_AGENT_DIR: root, OMO_TELEMETRY_ENDPOINT: server.url.origin }
  const path = join(root, "omo-senpi", "otlp-ingest-key.json")
  return {
    env, path, requests, origin: server.url.origin,
    disconnect() { void server.stop(true) },
    seed(value: unknown) {
      mkdirSync(join(root, "omo-senpi"), { recursive: true })
      writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
    },
    read() { return JSON.parse(readFileSync(path, "utf8")) },
    async close() { await server.stop(true); rmSync(root, { recursive: true, force: true }) },
  }
}

test("#given a cached install key #when OTLP starts #then registration is not called", async () => {
  const f = fixture()
  f.seed({ endpoint: f.origin, key })
  try {
    const transport = await createSenpiOtlpTransport({ env: f.env, consent: () => true }, message)
    expect(transport).not.toBeNull()
    transport?.capture(message)
    await transport?.flush?.()
    await transport?.shutdown()
    expect(f.requests.map(row => row.path)).toEqual(["/v1/logs"])
    expect(f.requests[0]?.key).toBe(key)
  } finally { await f.close() }
})

for (const cached of [undefined, `v1.omo-senpi.${"b".repeat(64)}.kid.mac`] as const) {
  test(`#given ${cached === undefined ? "no" : "another install's"} key #when OTLP starts #then it registers and caches a private key`, async () => {
    const f = fixture(async request => {
      expect(request.headers.get("content-type")).toBe("application/json")
      expect(await request.json()).toEqual({ product: "omo-senpi", install_hash: hash })
      return Response.json({ key })
    })
    if (cached !== undefined) f.seed({ endpoint: f.origin, key: cached })
    try {
      const transport = await createSenpiOtlpTransport({ env: f.env, consent: () => true }, message)
      expect(transport).not.toBeNull()
      await transport?.shutdown()
      expect(f.requests.map(row => row.path)).toEqual(["/v1/register"])
      expect(f.read()).toMatchObject({ endpoint: f.origin, key })
      if (process.platform !== "win32") expect(statSync(f.path).mode & 0o777).toBe(0o600)
    } finally { await f.close() }
  })
}

for (const [label, response] of [
  ["400", () => new Response(null, { status: 400 })],
  ["500", () => new Response(null, { status: 500 })],
  ["wrong hash", () => Response.json({ key: `v1.omo-senpi.${"b".repeat(64)}.kid.mac` })],
  ["bad shape", () => Response.json({ key: `v1.omo-senpi.${hash}.` })],
  ["invalid JSON", () => new Response("{")],
] as const) {
  test(`#given registration ${label} #when events arrive #then OTLP refuses once and PostHog still sends`, async () => {
    const f = fixture(response)
    try {
      const input = { env: f.env, consent: () => true }
      // The factory's real PostHog sidecar must still deliver, despite OTLP startup refusing.
      const transport = createSenpiTelemetryTransportFactory(input)("synthetic-posthog-key", {
        host: f.origin, disableGeoip: false, enableExceptionAutocapture: false,
        enableLocalEvaluation: false, strictLocalEvaluation: true, disableRemoteConfig: true,
        flushAt: 20, flushInterval: 0,
      })
      transport.capture(message)
      await transport.flush?.()
      expect(await createSenpiOtlpTransport(input, message)).toBeNull()
      expect(await createSenpiOtlpTransport(input, message)).toBeNull()
      await transport.shutdown()
      expect(f.requests.filter(row => row.path === "/v1/register")).toHaveLength(1)
      expect(f.requests.some(row => row.path === "/batch/")).toBe(true)
      expect(f.requests.some(row => row.path === "/v1/logs")).toBe(false)
    } finally { await f.close() }
  })
}

for (const status of [429, 503]) {
  test(`#given registration ${status} #when startup repeats #then Retry-After is persisted without retries`, async () => {
    const f = fixture(() => new Response(null, { status, headers: { "retry-after": "120" } }))
    try {
      const before = Date.now()
      const input = { env: f.env, consent: () => true }
      expect(await createSenpiOtlpTransport(input, message)).toBeNull()
      expect(f.read().notBefore).toBeGreaterThanOrEqual(before + 120_000)
      expect(await createSenpiOtlpTransport(input, message)).toBeNull()
      expect(f.requests).toHaveLength(1)
    } finally { await f.close() }
  })
}

test("#given persisted registration backoff #when a new process state starts #then registration is suppressed", async () => {
  const f = fixture()
  f.seed({ endpoint: f.origin, notBefore: Date.now() + 60_000 })
  try {
    expect(await createSenpiOtlpTransport({ env: f.env, consent: () => true }, message)).toBeNull()
    expect(f.requests).toEqual([])
  } finally { await f.close() }
})

test("#given a hanging registration body #when the short deadline expires #then OTLP refuses for the process", async () => {
  const f = fixture(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"key":')) },
  }), { headers: { "content-type": "application/json" } }))
  try {
    const input = { env: f.env, consent: () => true }
    expect(await createSenpiOtlpTransport(input, message)).toBeNull()
    expect(await createSenpiOtlpTransport(input, message)).toBeNull()
    expect(f.requests).toHaveLength(1)
  } finally { await f.close() }
}, 2_000)

test("#given a network failure #when OTLP starts again #then registration is not retried", async () => {
  const f = fixture(() => {
    // Closing the client connection simulates a network failure, not an HTTP rejection.
    f.disconnect()
    return new Response()
  })
  try {
    const input = { env: f.env, consent: () => true }
    expect(await createSenpiOtlpTransport(input, message)).toBeNull()
    expect(await createSenpiOtlpTransport(input, message)).toBeNull()
    expect(f.requests).toHaveLength(1)
  } finally { await f.close() }
})

test("#given an explicit env key #when a cached key exists #then the explicit key wins without registering", async () => {
  const f = fixture()
  f.seed({ endpoint: f.origin, key })
  try {
    const transport = await createSenpiOtlpTransport({
      env: { ...f.env, OMO_TELEMETRY_INGEST_KEY: "explicit-key" }, consent: () => true,
    }, message)
    transport?.capture(message)
    await transport?.flush?.()
    await transport?.shutdown()
    expect(f.requests.map(row => row.path)).toEqual(["/v1/logs"])
    expect(f.requests[0]?.key).toBe("explicit-key")
    expect(f.read().key).toBe(key)
  } finally { await f.close() }
})

for (const [label, env, consent] of [
  ["consent off", {}, () => false],
  ["consent throws", {}, () => { throw new Error("unavailable") }],
  ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }, () => true],
  ["SDK disabled", { OTEL_SDK_DISABLED: "true" }, () => true],
  ["product disabled", { OMO_SENPI_DISABLE_POSTHOG: "1" }, () => true],
] as const) {
  test(`#given ${label} #when no key exists #then registration never runs`, async () => {
    const f = fixture()
    try {
      expect(await createSenpiOtlpTransport({ env: { ...f.env, ...env }, consent }, message)).toBeNull()
      expect(f.requests).toEqual([])
      expect(existsSync(f.path)).toBe(false)
    } finally { await f.close() }
  })
}

test("#given a cached key #when the collector rejects it with 401 bad_key #then the next run can register again", async () => {
  const f = fixture(undefined, 401)
  f.seed({ endpoint: f.origin, key })
  try {
    const input = { env: f.env, consent: () => true }
    const transport = await createSenpiOtlpTransport(input, message)
    expect(transport).not.toBeNull()
    transport?.capture(message)
    await transport?.flush?.()
    await transport?.shutdown()
    // Rejection accounting can itself produce a collector diagnostic log.
    expect(f.requests.length).toBeGreaterThan(0)
    expect(f.requests.every(row => row.path === "/v1/logs")).toBe(true)
    expect(existsSync(f.path)).toBe(false)
    // A refusal is final for this process; invalidation is not an immediate registration retry.
    expect(await createSenpiOtlpTransport(input, message)).toBeNull()
  } finally { await f.close() }
})

test("#given concurrent first starts #when no key is cached #then exactly one registration runs", async () => {
  const f = fixture(async () => { await Bun.sleep(20); return Response.json({ key }) })
  try {
    const input = { env: f.env, consent: () => true }
    const transports = await Promise.all([1, 2, 3].map(() => createSenpiOtlpTransport(input, message)))
    expect(transports.every(transport => transport !== null)).toBe(true)
    await Promise.all(transports.map(transport => transport?.shutdown()))
    expect(f.requests.filter(row => row.path === "/v1/register")).toHaveLength(1)
  } finally { await f.close() }
})

test("#given an explicitly empty env key #when OTLP starts #then it stays off and never registers", async () => {
  const f = fixture()
  try {
    const transport = await createSenpiOtlpTransport({ env: { ...f.env, OMO_TELEMETRY_INGEST_KEY: " " }, consent: () => true }, message)
    expect(transport).toBeNull()
    expect(f.requests).toHaveLength(0)
  } finally { await f.close() }
})

test("#given a huge Retry-After #when registration is throttled #then the backoff is capped at 24 hours", async () => {
  const f = fixture(() => new Response(null, { status: 429, headers: { "retry-after": String(365 * 24 * 3600) } }))
  try {
    const before = Date.now()
    expect(await createSenpiOtlpTransport({ env: f.env, consent: () => true }, message)).toBeNull()
    expect(f.read().notBefore).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000 - 5_000)
    expect(f.read().notBefore).toBeLessThanOrEqual(before + 24 * 3600 * 1000 + 5_000)
  } finally { await f.close() }
})

test("#given a path-prefixed endpoint #when registering #then register uses the same base path as logs", async () => {
  const f = fixture()
  try {
    const env = { ...f.env, OMO_TELEMETRY_ENDPOINT: `${f.origin}/prefix` }
    await (await createSenpiOtlpTransport({ env, consent: () => true }, message))?.shutdown()
    expect(f.requests[0]?.path).toBe("/prefix/v1/register")
  } finally { await f.close() }
})

test("#given the collector rejects the key with 401 #when captures and flush intervals follow #then OTLP stops without spool writes", async () => {
  const f = fixture(undefined, 401)
  f.seed({ endpoint: f.origin, key })
  const intervalSpy = spyOn(globalThis, "setInterval")
  const cancelSpy = spyOn(globalThis, "clearInterval")
  let transport: Awaited<ReturnType<typeof createSenpiOtlpTransport>> | undefined
  try {
    transport = await createSenpiOtlpTransport({ env: f.env, consent: () => true }, message)
    expect(transport).not.toBeNull()
    transport?.capture(message)
    await transport?.flush?.()
    const spool = join(f.env.OMO_CODING_AGENT_DIR, "omo-senpi", "otlp")
    const snapshot = () => ({
      files: readdirSync(spool).sort(),
      modified: statSync(spool, { bigint: true }).mtimeNs,
    })
    const before = snapshot()
    expect(intervalSpy.mock.calls.filter(([, ms]) => ms === 10_000)).toHaveLength(1)
    const interval = intervalSpy.mock.calls.findIndex(([, ms]) => ms === 10_000)
    const run = intervalSpy.mock.calls[interval]?.[0]
    if (typeof run !== "function") throw new Error("OTLP flush interval was not scheduled")
    for (let cycle = 0; cycle < 3; cycle++) {
      transport?.capture(message)
      expect(snapshot()).toEqual(before)
      run()
      await transport?.flush?.()
      expect(snapshot()).toEqual(before)
    }
    expect(f.requests.filter(row => row.path === "/v1/logs")).toHaveLength(1)
    const scheduled = intervalSpy.mock.results[interval]
    if (scheduled === undefined) throw new Error("OTLP flush interval has no handle")
    expect(cancelSpy).toHaveBeenCalledWith(scheduled.value)
  } finally {
    await transport?.shutdown()
    intervalSpy.mockRestore()
    cancelSpy.mockRestore()
    await f.close()
  }
})

test("#given an automatic install key gets 401 #when more events arrive #then PostHog keeps delivering", async () => {
  const f = fixture(undefined, 401)
  f.seed({ endpoint: f.origin, key })
  const transport = createSenpiTelemetryTransportFactory({ env: f.env, consent: () => true })("synthetic-posthog-key", {
    host: f.origin, disableGeoip: false, enableExceptionAutocapture: false,
    enableLocalEvaluation: false, strictLocalEvaluation: true, disableRemoteConfig: true,
    flushAt: 20, flushInterval: 0,
  })
  try {
    transport.capture(message)
    await transport.flush?.()
    const batches = f.requests.filter(row => row.path === "/batch/").length
    expect(batches).toBeGreaterThan(0)
    transport.capture(message)
    await transport.flush?.()
    expect(f.requests.filter(row => row.path === "/batch/")).toHaveLength(batches + 1)
    expect(f.requests.filter(row => row.path === "/v1/logs")).toHaveLength(1)
  } finally {
    await transport.shutdown()
    await f.close()
  }
})
