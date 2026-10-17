import { describe, expect, test } from "bun:test"
import { createInMemoryDeviceKeyring } from "../keyring-port.ts"
import { BatchInputError, buildBatch } from "./build.ts"
import { type BatchBinding, openBatch } from "./open.ts"
import { createRejectionCounter } from "./rejection.ts"
import { b64, deviceId, epochKey, keyringFor, type ManifestObject, objects, readBytes } from "./testing/sync-v1.test-support.ts"
import { b64urlDecode } from "./vendor/sync-format/jcs.ts"

type CorruptedCase = { readonly file: string; readonly base: string; readonly expect: string }

const corrupted: { readonly cases: ReadonlyArray<CorruptedCase> } = JSON.parse(new TextDecoder().decode(readBytes("corrupted/corrupted.json")))

const recordsOf = (entry: ManifestObject) =>
  entry.payload.map((row) => ({ type: row.type, spaceId: b64urlDecode(row.space_id), itemKey: row.item_key, body: b64urlDecode(row.body_base64url) }))

const objectNamed = (file: string): ManifestObject => {
  const entry = objects.objects.find((candidate) => candidate.file === file)
  if (entry === undefined) throw new Error(`fixture object ${file} is missing`)
  return entry
}

const bindingFor = async (entry: ManifestObject, bytes: Uint8Array<ArrayBuffer>, digest = entry.sha256): Promise<BatchBinding> => ({
  account: objects.account,
  epoch: entry.epoch,
  authorId: deviceId(entry.author),
  signingPublicKey: keyringFor(entry.author).publicKeys().signing,
  digest,
  kind: entry.kind,
  ...(entry.chunk === undefined ? {} : { chunk: entry.chunk }),
})

const rebuild = (entry: ManifestObject, account = objects.account) =>
  buildBatch({
    account,
    kind: entry.kind,
    epoch: entry.epoch,
    epochKey: epochKey(entry.epoch) ?? new Uint8Array(32),
    keyring: keyringFor(entry.author),
    peers: entry.peers,
    batchId: b64urlDecode(entry.batch_id),
    salt: b64urlDecode(entry.salt),
    createdAt: entry.created_at,
    ...(entry.chunk === undefined ? {} : { chunk: entry.chunk }),
    records: recordsOf(entry),
  })

describe("buildBatch: the client encoder", () => {
  // The golden objects carry hand-built stored deflate blocks (omo-service fixtures regenerate
  // byte-identically on any runtime), while the client compresses with the runtime's deflate-raw,
  // so whole-object bytes are not a format property. What is: the canonical header, a valid
  // object signature by the author's DeviceKeyring, and a payload that opens to the same records.
  test.each(objects.objects.map((entry) => [entry.file, entry] as const))("rebuilds %s: same header, signed by its author, opens to its records", async (file, entry) => {
    const built = await rebuild(entry)
    const golden = readBytes(`objects/${file}`)
    const headerOf = (bytes: Uint8Array<ArrayBuffer>) => b64(bytes.subarray(10, 10 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(6, false)))
    expect(headerOf(built)).toBe(headerOf(golden))
    const opened = await openBatch(built, await bindingFor(entry, built, b64(new Uint8Array(await crypto.subtle.digest("SHA-256", built)))), epochKey(entry.epoch) ?? new Uint8Array(32), createRejectionCounter())
    expect(opened.ok && opened.records.map((r) => ({ type: r.type, space_id: b64(r.spaceId), item_key: r.itemKey, body_base64url: b64(r.body) }))).toEqual([...entry.payload])
  })

  test("a batch from a fresh in-memory keyring opens with its records intact", async () => {
    const keyring = createInMemoryDeviceKeyring("device-under-test")
    const key = crypto.getRandomValues(new Uint8Array(32))
    const body = new TextEncoder().encode("alpha")
    const built = await buildBatch({
      account: "roundtrip-account",
      kind: "ops",
      epoch: 7,
      epochKey: key,
      keyring,
      peers: ["9001"],
      batchId: crypto.getRandomValues(new Uint8Array(16)),
      salt: crypto.getRandomValues(new Uint8Array(32)),
      createdAt: 1760000000000,
      records: [{ type: 1, spaceId: new Uint8Array(16).fill(3), itemKey: "notes/a.md", body }],
    })
    const rejections = createRejectionCounter()
    const binding: BatchBinding = {
      account: "roundtrip-account",
      epoch: 7,
      authorId: "device-under-test",
      signingPublicKey: keyring.publicKeys().signing,
      digest: b64(new Uint8Array(await crypto.subtle.digest("SHA-256", built))),
      kind: "ops",
    }
    const opened = await openBatch(built, binding, new Uint8Array(key), rejections)
    expect(opened.ok && opened.records.map((record) => new TextDecoder().decode(record.body))).toEqual(["alpha"])
    expect(rejections.count()).toBe(0)
  })

  test("input the payload framing cannot carry is rejected, never padded or wrapped and then signed", async () => {
    const keyring = createInMemoryDeviceKeyring("device-under-test")
    const signed: unknown[] = []
    const watched = { ...keyring, sign: (request: Parameters<typeof keyring.sign>[0]) => { signed.push(request); return keyring.sign(request) } }
    const input = (record: { readonly spaceId: Uint8Array; readonly itemKey: string }) => ({
      account: "framing-account",
      kind: "ops" as const,
      epoch: 1,
      epochKey: new Uint8Array(32),
      keyring: watched,
      peers: [],
      batchId: new Uint8Array(16),
      salt: new Uint8Array(32),
      createdAt: 1760000000000,
      records: [{ type: 1 as const, ...record, body: new Uint8Array([1]) }],
    })
    for (const record of [
      { spaceId: new Uint8Array(15), itemKey: "a" },
      { spaceId: new Uint8Array(17), itemKey: "a" },
      { spaceId: new Uint8Array(16), itemKey: "k".repeat(65536) },
    ]) {
      await expect(buildBatch(input(record))).rejects.toBeInstanceOf(BatchInputError)
    }
    expect(signed).toEqual([])
    expect(await buildBatch(input({ spaceId: new Uint8Array(16), itemKey: "k".repeat(65535) }))).toBeInstanceOf(Uint8Array)
  })
})

describe("openBatch: object receiver checks", () => {
  test.each(objects.objects.map((entry) => [entry.file, entry] as const))("opens %s and returns exactly the manifest records", async (file, entry) => {
    const bytes = readBytes(`objects/${file}`)
    const rejections = createRejectionCounter()
    const opened = await openBatch(bytes, await bindingFor(entry, bytes), epochKey(entry.epoch) ?? new Uint8Array(32), rejections)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.records.map((record) => b64(record.body))).toEqual(entry.payload.map((row) => row.body_base64url))
    expect(rejections.count()).toBe(0)
  })

  test.each(corrupted.cases.filter((row) => row.file.endsWith(".omob")).map((row) => [row.file, row] as const))(
    "%s is refused with its typed reason, no records, one content-free rejection",
    async (file, row) => {
      const base = objectNamed(row.base)
      const bytes = readBytes(`corrupted/${file}`)
      const logged: string[] = []
      const rejections = createRejectionCounter((line) => logged.push(line))
      const binding = await bindingFor(base, bytes, b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))))
      const opened = await openBatch(bytes, binding, epochKey(base.epoch) ?? new Uint8Array(32), rejections)
      expect({ ok: opened.ok, reason: opened.ok ? "" : opened.reason }).toEqual({ ok: false, reason: row.expect })
      expect(rejections.count()).toBe(1)
      expect(logged).toEqual([`sync.batch.rejected ${row.expect}`])
      for (const canary of objects.canaries) expect(logged.join("\n")).not.toContain(canary)
      expect(logged.join("\n")).not.toContain(objects.account)
    },
  )

  test("a batch whose associated data names another account fails to open", async () => {
    const entry = objectNamed("batch-a-epoch1.omob")
    const foreign = await rebuild(entry, "another-account")
    const rejections = createRejectionCounter()
    const binding = await bindingFor(entry, foreign, b64(new Uint8Array(await crypto.subtle.digest("SHA-256", foreign))))
    const opened = await openBatch(foreign, binding, epochKey(1) ?? new Uint8Array(32), rejections)
    expect(opened).toEqual({ ok: false, reason: "account_mismatch" })
    expect(rejections.count()).toBe(1)
  })

  test("a genuine object served under another entry's digest is refused before decryption", async () => {
    const entry = objectNamed("batch-a-epoch1.omob")
    const bytes = readBytes("objects/batch-a-epoch1.omob")
    const rejections = createRejectionCounter()
    const binding = await bindingFor(entry, bytes, objectNamed("batch-b-epoch1.omob").sha256)
    expect(await openBatch(bytes, binding, epochKey(1) ?? new Uint8Array(32), rejections)).toEqual({ ok: false, reason: "digest_mismatch" })
  })
})
