import { describe, expect, test } from "bun:test"

import { loadLoroRuntime } from "../../crdt/loro-runtime"
import { buildBatch } from "../crypto/build.ts"
import { openBatch } from "../crypto/open.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { b64, deviceId, epochKey, keyringFor, objects } from "../crypto/testing/sync-v1.test-support.ts"
import { b64urlDecode } from "../crypto/vendor/sync-format/jcs.ts"
import { advertisesBodyLine, bodyLineAdvertisement, MANIFEST_RECORD } from "./capability.ts"
import { OPS_RECORD, spaceItems } from "./verifier.ts"

// PR #12295 review: the body line diff is advertised by a manifest-update record (payload type 2) in
// every batch. Protocol contracts guarded here: the record is byte-stable, it names exactly its author,
// and a receiver that reads only item records (every build before it) gets the same items with it.

const garbage = new Uint8Array([1, 2, 3])

async function bindingOnlyManifest(): Promise<Uint8Array> {
  const { LoroDoc } = await loadLoroRuntime()
  const doc = new LoroDoc()
  doc.getMap("bindings").set("git:example", true)
  doc.commit()
  const update = doc.export({ mode: "update" })
  doc.free()
  return update
}

describe("the body line advertisement", () => {
  test("is byte-identical every time it is built", async () => {
    expect(
      Buffer.from(await bodyLineAdvertisement("dev-a")).equals(Buffer.from(await bodyLineAdvertisement("dev-a"))),
    ).toBe(true)
  })

  test("advertises for its author only", async () => {
    const forA = await bodyLineAdvertisement("dev-a")
    expect(await advertisesBodyLine([forA], "dev-a")).toBe(true)
    expect(await advertisesBodyLine([forA], "dev-b")).toBe(false)
    expect(await advertisesBodyLine([await bindingOnlyManifest()], "dev-a")).toBe(false)
    expect(await advertisesBodyLine([garbage, forA], "dev-a")).toBe(true)
    expect(await advertisesBodyLine([garbage], "dev-a")).toBe(false)
  })

  test("is not decoded from a body over the size cap", async () => {
    const padded = new Uint8Array(8192)
    padded.set(await bodyLineAdvertisement("dev-a"))
    expect(await advertisesBodyLine([padded], "dev-a")).toBe(false)
  })
})

describe("a sealed batch carrying the advertisement", () => {
  const entry = objects.objects.find((candidate) => candidate.kind === "ops")
  if (entry === undefined) throw new Error("the sync-v1 fixtures hold no ops object")
  const space = new Uint8Array(16).fill(7)
  const other = new Uint8Array(16).fill(8)
  const item = { type: OPS_RECORD, spaceId: space, itemKey: "notes/a.md", body: new Uint8Array([9, 8, 7]) } as const
  const seal = async (records: Parameters<typeof buildBatch>[0]["records"]) => {
    const key = epochKey(entry.epoch) ?? new Uint8Array(32)
    const bytes = await buildBatch({
      account: objects.account,
      kind: "ops",
      epoch: entry.epoch,
      epochKey: key,
      keyring: keyringFor(entry.author),
      peers: [],
      batchId: b64urlDecode(entry.batch_id),
      salt: b64urlDecode(entry.salt),
      createdAt: entry.created_at,
      records,
    })
    const digest = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    const binding = {
      account: objects.account,
      epoch: entry.epoch,
      authorId: deviceId(entry.author),
      signingPublicKey: keyringFor(entry.author).publicKeys().signing,
      digest,
      kind: "ops" as const,
    }
    const opened = await openBatch(bytes, binding, key, createRejectionCounter())
    if (!opened.ok) throw new Error(`the batch does not open: ${opened.reason}`)
    return opened.records
  }

  test("opens to the same item records as the batch without it, for a reader of item records only", async () => {
    const author = deviceId(entry.author)
    const marker = {
      type: MANIFEST_RECORD,
      spaceId: space,
      itemKey: "",
      body: new Uint8Array(await bodyLineAdvertisement(author)),
    }
    const plain = spaceItems(await seal([item]), space, OPS_RECORD)
    const marked = await seal([item, marker])
    expect(spaceItems(marked, space, OPS_RECORD)).toEqual(plain)
    expect(
      await advertisesBodyLine(
        marked.filter((r) => r.type === MANIFEST_RECORD).map((r) => r.body),
        author,
      ),
    ).toBe(true)
  })

  test("is heard from a record that names another space: the marker belongs to the author's build", async () => {
    const author = deviceId(entry.author)
    const elsewhere = await seal([
      { type: MANIFEST_RECORD, spaceId: other, itemKey: "", body: new Uint8Array(await bodyLineAdvertisement(author)) },
    ])
    expect(spaceItems(elsewhere, space, OPS_RECORD)).toEqual({ items: [] })
    expect(
      await advertisesBodyLine(
        elsewhere.filter((r) => r.type === MANIFEST_RECORD).map((r) => r.body),
        author,
      ),
    ).toBe(true)
  })
})
