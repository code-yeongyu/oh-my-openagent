import { describe, expect, test } from "bun:test"
import { appendEntries } from "./chain.ts"
import { createRejectionCounter } from "./rejection.ts"
import { importSnapshot, type SnapshotRecord } from "./snapshot.ts"
import { ACCOUNT, appendBatch, deviceId, epochKey, keyringFor, keys, mainChain, objects, principalKeys, readBytes, fixtureAnchor } from "./testing/sync-v1.test-support.ts"
import { b64urlDecode } from "./vendor/sync-format/jcs.ts"
import { signFramed } from "./vendor/sync-format/keys.ts"
import { snapshotPreimage } from "./vendor/sync-format/snapshot.ts"

const chunks = () => objects.snapshot.chunks.map((file) => readBytes(`objects/${file}`))

const coverHead = () => {
  const last = mainChain().at(-1)
  if (last === undefined) throw new Error("empty fixture chain")
  return last
}

const snapshotBy = async (device: "owner" | "recovered", overrides: Partial<SnapshotRecord> = {}): Promise<SnapshotRecord> => {
  const head = coverHead()
  const unsigned: SnapshotRecord = {
    account: ACCOUNT,
    author: { kind: "device", id: deviceId(device), ...principalKeys(keyringFor(device)) },
    covers_seq: head.seq,
    digest: objects.snapshot.digest,
    link: head.link,
    keyring_head: head.keyring_link,
    record_sig: "",
    ...overrides,
  }
  const record_sig = await signFramed("omo-sync/v1/snapshot", snapshotPreimage(unsigned), b64urlDecode(keys.devices[device].signing_seed))
  return { ...unsigned, record_sig }
}

describe("snapshot import after compaction, verified from genesis", () => {
  test("a device with no earlier chain imports the snapshot and continues the chain", async () => {
    const rejections = createRejectionCounter()
    const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), mainChain(), await snapshotBy("owner"), chunks(), epochKey, rejections)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.records.map((record) => record.itemKey)).toEqual(["snapshot part 0", "snapshot part 1"])
    expect(imported.state.head?.seq).toBe(coverHead().seq)
    expect([...(imported.state.authority?.members.keys() ?? [])].sort()).toEqual([deviceId("owner"), deviceId("joining")].sort())
    const head = imported.state.head
    if (head === null) return
    const digest = objects.objects.find((entry) => entry.file === "batch-c-epoch3.omob")?.sha256 ?? ""
    const later = await appendEntries(imported.state, [await appendBatch(head, digest, 3, keyringFor("owner"))], rejections)
    expect(later.ok).toBe(true)
    expect(rejections.count()).toBe(0)
  })

  test("a snapshot whose keyring head names a record the served prefix hides is refused", async () => {
    const rejections = createRejectionCounter()
    const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), mainChain().slice(0, 6), await snapshotBy("owner"), chunks(), epochKey, rejections)
    expect(imported).toEqual({ ok: false, reason: "bad_keyring_head" })
    expect(rejections.count()).toBe(1)
  })

  test("a snapshot signed by a device the chain rotated out is refused", async () => {
    const rejections = createRejectionCounter()
    const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), mainChain(), await snapshotBy("recovered"), chunks(), epochKey, rejections)
    expect(imported).toEqual({ ok: false, reason: "not_member" })
    expect(rejections.count()).toBe(1)
  })

  test("a chunk set missing a chunk is refused before any record is returned", async () => {
    const rejections = createRejectionCounter()
    const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), mainChain(), await snapshotBy("owner"), chunks().slice(0, 1), epochKey, rejections)
    expect(imported).toEqual({ ok: false, reason: "chunk_refused" })
    expect(rejections.count()).toBe(1)
  })

  test("a snapshot whose served author keys differ from the signed ones fails its signature", async () => {
    const rejections = createRejectionCounter()
    const signed = await snapshotBy("owner")
    const swapped = { ...signed, author: { ...signed.author, sealing_public_key: keyringFor("joining").publicKeys().sealing } }
    const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), mainChain(), swapped, chunks(), epochKey, rejections)
    expect(imported).toEqual({ ok: false, reason: "bad_signature" })
  })
})
