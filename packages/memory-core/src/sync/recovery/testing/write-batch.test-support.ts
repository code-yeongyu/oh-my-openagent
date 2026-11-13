import { buildBatch, signRecord } from "../../crypto/build.ts"
import { nextLink } from "../../crypto/links.ts"
import { b64urlEncode, sha256B64 } from "../../crypto/vendor/sync-format/jcs.ts"
import { ownMaterial } from "../keyring-append.ts"
import { committedWrap, expectedHistory } from "../served-chain.ts"
import type { StoredBatchRow } from "./fake-server.test-support.ts"
import { authorOf, type Device, headOrThrow, verified, type World } from "./world.test-support.ts"

/**
 * Writes one encrypted batch at the current epoch and keeps its bytes as the object store would.
 * The stored row carries the id sealed into the batch header, as the service's `sync_entries` row does.
 */
export const writeBatch = async (world: World, text: string, by: Device = world.owner): Promise<void> => {
  const state = await verified(world, by)
  const authority = state.authority
  const head = headOrThrow(state)
  if (authority === null) throw new Error("no authority")
  const wrap = committedWrap(state, authority.epoch, `device:${by.principal.id}`)
  const material =
    wrap === null
      ? null
      : await ownMaterial(by.keyring, world.account, wrap, expectedHistory(authority, authority.epoch))
  if (material === null) throw new Error("the writer cannot open its own wrap")
  const batchId = crypto.getRandomValues(new Uint8Array(16))
  const bytes = await buildBatch({
    account: world.account,
    kind: "ops",
    epoch: authority.epoch,
    epochKey: material.current,
    keyring: by.keyring,
    peers: ["1"],
    batchId,
    salt: crypto.getRandomValues(new Uint8Array(32)),
    createdAt: 1_700_000_000_000,
    records: [
      {
        type: 1,
        spaceId: new Uint8Array(16),
        itemKey: "notes/a.md",
        body: new TextEncoder().encode(text),
      },
    ],
  })
  const digest = await sha256B64(bytes)
  const link = await nextLink(head.link, digest)
  if (link === null) throw new Error("link")
  const fields = {
    account: world.account,
    base_seq: head.seq,
    digest,
    epoch: authority.epoch,
    link,
    keyring_link: null,
  }
  const row: StoredBatchRow = {
    ...fields,
    seq: head.seq + 1,
    kind: "batch",
    author: authorOf(by),
    record_sig: await signRecord(by.keyring, fields),
    batch_id: b64urlEncode(batchId),
  }
  world.server.chain(world.account).push(row)
  world.objects.set(digest, { bytes, text })
}
