import { afterEach, expect, test } from "bun:test"

import {
  b64urlOfHex,
  createHttpTransport,
  hexOfB64url,
  SyncAuthError,
  SyncHttpError,
  SyncNetworkError,
} from "./http-transport"
import { SYNC_CAPABILITIES, SYNC_CONTRACT_VERSION, syncRequestHeaders } from "../../contract-version"
import { startWireServer, type WireServer } from "./wire-server.test-support"

const servers: WireServer[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop()
})

async function pair() {
  const server = startWireServer({ token: "tok", devices: { a: "dev-a", b: "dev-b" } })
  servers.push(server)
  const a = createHttpTransport({ baseUrl: server.url, token: () => server.tokenOf("a") })
  const b = createHttpTransport({ baseUrl: server.url, token: () => server.tokenOf("b") })
  return { server, a, b }
}

const pushedIds: string[] = []
const sha256Hex = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
const batchId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")

async function pushOne(t: ReturnType<typeof createHttpTransport>, bytes: Uint8Array, baseSeq: number) {
  const digest = sha256Hex(bytes)
  const uploadId = await t.reserve(bytes.byteLength, digest)
  await t.upload(uploadId, bytes)
  const id = batchId()
  const result = await t.append({
    uploadId,
    digest,
    baseSeq,
    batchId: id,
    epoch: 1,
    link: "A".repeat(43),
    recordSig: "S".repeat(86),
  })
  pushedIds.push(id)
  return result
}

test("digests travel as 43-character base64url and come back as the same hex", () => {
  const hex = sha256Hex(new TextEncoder().encode("x"))
  expect(b64urlOfHex(hex)).toHaveLength(43)
  expect(hexOfB64url(b64urlOfHex(hex))).toBe(hex)
})

test("reserve, upload and append land a batch the other device pulls and downloads byte for byte", async () => {
  const { a, b } = await pair()
  const bytes = new TextEncoder().encode("sealed batch")
  expect(await pushOne(a, bytes, 0)).toEqual({ ok: true, seq: 1 })
  const page = await b.pull(0, 500)
  expect(page.more).toBe(false)
  expect(page.snapshot).toBeNull()
  expect(page.entries).toHaveLength(1)
  const [entry] = page.entries
  if (entry === undefined) throw new Error("no entry")
  expect(entry).toMatchObject({
    seq: 1,
    kind: "batch",
    digest: sha256Hex(bytes),
    author: "device:dev-a",
    batchId: pushedIds.at(-1),
  })
  expect(entry.batchId).toMatch(/^[A-Za-z0-9_-]{22}$/)
  expect(await b.download(entry.objectId)).toEqual(bytes)
})

test("a token that cannot be refreshed fails the request as SyncAuthError, and a token the server refuses as a 401 (omo #10637)", async () => {
  const { server } = await pair()
  const refused = new Error("refresh refused")
  const unrefreshable = createHttpTransport({ baseUrl: server.url, token: () => Promise.reject(refused) })
  const failure = await unrefreshable.pull(0, 500).then(
    () => null,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(SyncAuthError)
  expect((failure as SyncAuthError).cause).toBe(refused)
  const unknownDevice = createHttpTransport({ baseUrl: server.url, token: () => "not-a-device-token" })
  const refusal = await unknownDevice.pull(0, 500).then(
    () => null,
    (error: unknown) => error,
  )
  expect(refusal).toBeInstanceOf(SyncHttpError)
  expect(refusal).toMatchObject({ code: "unauthorized", status: 401, transient: false })
})

test("a sync service that cannot be reached fails the request as SyncNetworkError, keeping the fetch error (omo #10637)", async () => {
  const refused = new TypeError("fetch failed")
  const unreachable = createHttpTransport({
    baseUrl: "http://sync.invalid",
    token: () => "tok",
    fetch: (() => Promise.reject(refused)) as unknown as typeof fetch,
  })
  const failure = await unreachable.pull(0, 500).then(
    () => null,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(SyncNetworkError)
  expect((failure as SyncNetworkError).cause).toBe(refused)
})

test("a stale base answers stale_base with the server's head", async () => {
  const { a, b } = await pair()
  await pushOne(a, new TextEncoder().encode("one"), 0)
  expect(await pushOne(b, new TextEncoder().encode("two"), 0)).toEqual({ ok: false, error: "stale_base", head: 1 })
})

test("a full page asks for more, and the snapshot comes from the state route", async () => {
  const { server, a, b } = await pair()
  server.pageSize = 2
  for (const n of [0, 1, 2]) await pushOne(a, new TextEncoder().encode(`b${n}`), n)
  const first = await b.pull(0, 500)
  expect([first.entries.map((e) => e.seq), first.more]).toEqual([[1, 2], true])
  const rest = await b.pull(2, 500)
  expect([rest.entries.map((e) => e.seq), rest.more]).toEqual([[3], false])
  server.compactTo(2, ["c1", "c2"])
  const after = await b.pull(0, 500)
  expect(after.snapshot).toEqual({ coversSeq: 2, objectIds: ["c1", "c2"], digest: null })
  expect(after.entries.map((e) => e.seq)).toEqual([3])
})

test("sync off, quota and an update requirement map to their own refusals; a 5xx is a thrown transient error", async () => {
  const { server, a } = await pair()
  server.refuseNext = "entitlement_required"
  await expect(a.reserve(3, sha256Hex(new Uint8Array(3)))).rejects.toMatchObject({ code: "entitlement_required" })
  server.failNext = 503
  await expect(a.pull(0, 500)).rejects.toMatchObject({ code: "unavailable", transient: true })
})

test("the event stream delivers sync.advanced heads and reports the connection", async () => {
  const { server, a, b } = await pair()
  const heads: number[] = []
  const connected: boolean[] = []
  let stop: () => void = () => undefined
  const first = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 10s for sync.advanced, never fired")), 10_000)
    stop = b.subscribe({
      onAdvanced: (head) => {
        heads.push(head)
        clearTimeout(timer)
        resolve()
      },
      onConnected: (up) => {
        connected.push(up)
        if (up) void pushOne(a, new TextEncoder().encode("live"), 0)
      },
      onStateChanged: () => undefined,
    })
  })
  await first
  stop()
  expect(heads).toEqual([1])
  expect(connected[0]).toBe(true)
  expect(await server.untilStreamsClosed()).toBe(0)
})

test("#given the service's client floor refuses this build #when the event stream opens with a 426 #then it reports the stream down, waits the floor retry instead of 5 s, and reconnects once the floor is lifted (#14483, review L2)", async () => {
  let opened = 0
  const floored = createHttpTransport({
    baseUrl: "http://sync.example",
    token: () => "tok",
    floorRetryMs: 5,
    fetch: (async () => {
      opened += 1
      if (opened === 1)
        return Response.json(
          { error: { code: "client_update_required", message: "update OmO to keep syncing", retryable: false } },
          { status: 426 },
        )
      return new Response(`data: ${JSON.stringify({ type: "sync.advanced", head: { seq: 3 } })}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    }) as unknown as typeof fetch,
  })
  const connected: boolean[] = []
  let stop: () => void = () => undefined
  const heads: number[] = []
  const advanced = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("waited 10s for the stream to come back after the 426, never did")),
      10_000,
    )
    stop = floored.subscribe({
      onAdvanced: (head) => {
        heads.push(head)
        clearTimeout(timer)
        resolve()
      },
      onConnected: (up) => connected.push(up),
      onStateChanged: () => undefined,
    })
  })
  await advanced
  stop()
  expect(connected.slice(0, 2)).toEqual([false, true])
  expect(heads).toEqual([3])
  expect(opened).toBe(2)
})

test("#given repeated 426 floor waits on one subscription #when each wait ends on its timer #then no abort listener is left behind on the subscription's signal (#14483 review M1)", async () => {
  const added: unknown[] = []
  const removed: unknown[] = []
  const realAdd = AbortSignal.prototype.addEventListener
  const realRemove = AbortSignal.prototype.removeEventListener
  AbortSignal.prototype.addEventListener = function (type: string, listener: unknown, options?: unknown) {
    if (type === "abort") added.push(listener)
    return realAdd.call(this, type, listener as EventListener, options as AddEventListenerOptions)
  }
  AbortSignal.prototype.removeEventListener = function (type: string, listener: unknown, options?: unknown) {
    if (type === "abort") removed.push(listener)
    return realRemove.call(this, type, listener as EventListener, options as EventListenerOptions)
  }
  let opened = 0
  let stop: () => void = () => undefined
  try {
    const floored = createHttpTransport({
      baseUrl: "http://sync.example",
      token: () => "tok",
      floorRetryMs: 1,
      fetch: (async () => {
        opened += 1
        return Response.json(
          { error: { code: "client_update_required", message: "update OmO to keep syncing", retryable: false } },
          { status: 426 },
        )
      }) as unknown as typeof fetch,
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waited 10s for 4 floor waits, never reached")), 10_000)
      stop = floored.subscribe({
        onAdvanced: () => undefined,
        onConnected: () => {
          if (opened >= 4) {
            clearTimeout(timer)
            resolve()
          }
        },
        onStateChanged: () => undefined,
      })
    })
  } finally {
    stop()
    AbortSignal.prototype.addEventListener = realAdd
    AbortSignal.prototype.removeEventListener = realRemove
  }
  const finishedWaits = Math.max(0, opened - 1)
  expect(finishedWaits).toBeGreaterThanOrEqual(3)
  expect(removed.filter((listener) => added.includes(listener)).length).toBeGreaterThanOrEqual(finishedWaits)
})

// #12280 R-A9 (wire): a revoke through the real route freezes the account; the stream announces it as
// `sync.state.changed`, the state route shows the flag, and a push is refused `stale_base`.
test("#given a subscribed device #when another device is signed out through the sign-out route #then the stream delivers a state change and pushes are refused stale_base", async () => {
  const { server, a, b } = await pair()
  let stop: () => void = () => undefined
  const changed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 10s for sync.state.changed, never fired")), 10_000)
    stop = a.subscribe({
      onAdvanced: () => undefined,
      onConnected: (up) => {
        if (up)
          void fetch(`${server.url}/v1/session/sign-out`, {
            method: "POST",
            headers: syncRequestHeaders(server.tokenOf("b")),
          })
      },
      onStateChanged: () => {
        clearTimeout(timer)
        resolve()
      },
    })
  })
  await changed
  stop()
  expect(server.freeze.pending).toBe(true)
  expect(await pushOne(a, new TextEncoder().encode("frozen"), 0)).toMatchObject({ ok: false, error: "stale_base" })
  await expect(b.pull(0, 500)).rejects.toMatchObject({ code: "device_revoked", status: 401 })
})

// The service refuses every sync route 426 client_update_required for an account whose keyring holds a
// phrase key unless the request declares the phrase capability; after phrase genesis no engine synced (#13691).
test("every request the engine sends, the event stream included, carries the contract version and the phrase capability, so a phrase account's floor admits it (#13691)", async () => {
  const { server, a, b } = await pair()
  let stop: () => void = () => undefined
  try {
    const advanced = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("waited 5s for sync.advanced over the floor, never fired")),
        5_000,
      )
      stop = b.subscribe({
        onAdvanced: () => {
          clearTimeout(timer)
          resolve()
        },
        onConnected: (up) => {
          if (up) void pushOne(a, new TextEncoder().encode("over the floor"), 0)
        },
        onStateChanged: () => undefined,
      })
    })

    await advanced
    const page = await b.pull(0, 500)
    await b.download(page.entries[0]?.objectId ?? "")
  } finally {
    stop()
  }

  const routes = new Set(
    server.requests.map(
      ({ method, path }) => `${method} ${path.replace(/^(\/v1\/sync\/(?:objects|uploads))\/.+$/, "$1/:id")}`,
    ),
  )
  expect([...routes].sort()).toEqual([
    "GET /v1/me/events",
    "GET /v1/sync/batches",
    "GET /v1/sync/objects/:id",
    "GET /v1/sync/state",
    "POST /v1/sync/batches",
    "POST /v1/sync/uploads",
    "PUT /v1/sync/uploads/:id",
  ])
  for (const request of server.requests)
    expect(request).toMatchObject({ version: SYNC_CONTRACT_VERSION, capabilities: SYNC_CAPABILITIES })
}, 15_000)
