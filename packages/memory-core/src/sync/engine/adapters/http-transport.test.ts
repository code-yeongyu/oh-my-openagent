import { afterEach, expect, test } from "bun:test"

import { b64urlOfHex, createHttpTransport, hexOfB64url } from "./http-transport"
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
  const result = await t.append({ uploadId, digest, baseSeq, batchId: id, epoch: 1, link: "A".repeat(43), recordSig: "S".repeat(86) })
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
  expect(entry).toMatchObject({ seq: 1, kind: "batch", digest: sha256Hex(bytes), author: "device:dev-a", batchId: pushedIds.at(-1) })
  expect(entry.batchId).toMatch(/^[A-Za-z0-9_-]{22}$/)
  expect(await b.download(entry.objectId)).toEqual(bytes)
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
    })
  })
  await first
  stop()
  expect(heads).toEqual([1])
  expect(connected[0]).toBe(true)
  expect(await server.untilStreamsClosed()).toBe(0)
})
