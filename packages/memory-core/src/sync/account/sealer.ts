// The engine's Sealer over the verified account chain (sync-design sections 6 and 8): the batch is
// encrypted under the current epoch key this device opened from its own wrap, signed by the
// DeviceKeyring, and linked onto the verified link at the base it is appended on. A device that
// holds no current key, or whose chain cannot vouch for the base, refuses to seal.

import { randomBytes } from "node:crypto"

import { buildBatch, signRecord } from "../crypto/build.ts"
import { nextLink } from "../crypto/links.ts"
import { b64urlDecode, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import type { BatchPayload, SealedBatch, Sealer } from "../engine/ports.ts"
import type { AccountChain } from "./account-chain.ts"
import { OPS_RECORD } from "./verifier.ts"

export class SealRefusedError extends Error {
  override readonly name = "SealRefusedError"
  constructor(readonly reason: "no_epoch_key" | "unverified_base" | "not_member") {
    super(`memory sync cannot seal a batch: ${reason}`)
  }
}

export function createChainSealer(input: {
  readonly chain: AccountChain
  readonly keyring: DeviceKeyring
  readonly spaceId: Uint8Array
  readonly peer?: () => string
  readonly now?: () => number
}): Sealer {
  const { chain, keyring, spaceId } = input
  const now = input.now ?? Date.now
  return {
    async seal(batchId: string, baseSeq: number, payload: BatchPayload): Promise<SealedBatch> {
      await chain.reach(baseSeq)
      const authority = chain.state().authority
      if (authority === null || !chain.isMember()) throw new SealRefusedError("not_member")
      const prior = chain.linkAt(baseSeq)
      if (prior === null) throw new SealRefusedError("unverified_base")
      const epoch = authority.epoch
      const epochKey = await chain.epochKey(epoch)
      if (epochKey === null) throw new SealRefusedError("no_epoch_key")
      const bytes = await buildBatch({
        account: chain.account,
        kind: "ops",
        epoch,
        epochKey,
        keyring,
        peers: input.peer === undefined ? [] : [input.peer()],
        batchId: b64urlDecode(batchId),
        salt: new Uint8Array(randomBytes(32)),
        createdAt: now(),
        records: payload.items.map((item) => ({ type: OPS_RECORD, spaceId: new Uint8Array(spaceId), itemKey: item.key, body: new Uint8Array(item.ops) })),
      })
      const digest = await sha256B64(bytes)
      const link = await nextLink(prior, digest)
      if (link === null) throw new SealRefusedError("unverified_base")
      const recordSig = await signRecord(keyring, { account: chain.account, base_seq: baseSeq, digest, epoch, link, keyring_link: null })
      return { bytes, epoch, link, recordSig }
    },
  }
}
