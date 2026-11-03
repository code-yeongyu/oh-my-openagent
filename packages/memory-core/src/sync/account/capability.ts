// The body-diff capability advertisement (PR #12295 review). Every batch this build seals carries one
// manifest-update record (payload type 2, sync-design "manifest update") adding the entry
// `<author principal>\x1fbody-line/1` = true to the space manifest's add-only set `capabilities`. Builds
// before it read only type-1 item records (verifier.ts spaceItems), so they skip the record and apply the
// same items. The update is built on a fresh doc under a peer derived from (principal, token), so it is
// byte-identical every time: re-sending it adds no ops, and a later capability is a new token, a new key
// and a new peer, never a rewrite. The marker describes the author's build, so the receiver reads it
// from any space's record.

import { createHash } from "node:crypto"

import { loadLoroRuntime } from "../../crdt/loro-runtime"

export const MANIFEST_RECORD = 2 as const
const CAPABILITIES = "capabilities"
const BODY_LINE = "body-line/1"
/** The real record is about 105 bytes; a larger body is never decoded on the verification path. */
const MAX_ADVERTISEMENT_BYTES = 4096

const entryKey = (principal: string): string => `${principal}\x1f${BODY_LINE}`

function capabilityPeer(principal: string): bigint {
  const digest = createHash("sha256").update(`omo-sync/v1/capability-peer\0${principal}\0${BODY_LINE}`).digest()
  const peer = digest.readBigUInt64BE(0)
  return peer === 0n ? 1n : peer
}

export async function bodyLineAdvertisement(principal: string): Promise<Uint8Array> {
  const { LoroDoc } = await loadLoroRuntime()
  const doc = new LoroDoc()
  try {
    doc.setPeerId(capabilityPeer(principal))
    doc.setRecordTimestamp(false)
    doc.getMap(CAPABILITIES).set(entryKey(principal), true)
    doc.commit()
    return doc.export({ mode: "update" })
  } finally {
    doc.free()
  }
}

/** Whether one of these manifest-update bodies advertises the body line diff for `author`. */
export async function advertisesBodyLine(bodies: readonly Uint8Array[], author: string): Promise<boolean> {
  const { LoroDoc } = await loadLoroRuntime()
  for (const body of bodies) {
    const doc = new LoroDoc()
    try {
      if (
        body.byteLength <= MAX_ADVERTISEMENT_BYTES &&
        imported(doc, body) &&
        doc.getMap(CAPABILITIES).get(entryKey(author)) === true
      )
        return true
    } finally {
      doc.free()
    }
  }
  return false
}

// Manifest bytes are untrusted wire data: a body Loro cannot import advertises nothing, and the batch's
// items still apply, as every type-2 record did before this marker existed.
function imported(doc: { import(bytes: Uint8Array): unknown }, body: Uint8Array): boolean {
  try {
    doc.import(body)
    return true
  } catch {
    return false
  }
}
