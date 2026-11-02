import { z } from "zod"
import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import type { KeyringEntry } from "../crypto/entry.ts"
import { envelopeRefusal } from "../crypto/envelope.ts"
import { nextLink } from "../crypto/links.ts"
import { verifyRecordSig } from "../crypto/signatures.ts"
import { frozenCopy } from "../crypto/frozen.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { ownMaterial } from "../recovery/keyring-append.ts"
import { committedWrap } from "../recovery/served-chain.ts"
import { GenesisEnableError } from "./bridge.ts"
import type { GenesisAppend } from "./types.ts"
import { validatePrepared } from "./validate.ts"

const principal = z.strictObject({ kind: z.literal("device"), id: z.string(), sealing_public_key: z.string(), signing_public_key: z.string() })
const recovery = z.strictObject({
  credential_id: z.string(), rp_id: z.string(), enrollment_nonce: z.string(),
  sealing_public_key: z.string(), signing_public_key: z.string(), survivable: z.enum(["synced", "roaming"]),
})
const wrap = z.strictObject({ epoch: z.literal(1), id: z.string(), wrap: z.string() })
const request = z.strictObject({
  record: z.strictObject({
    kind: z.literal("genesis"), account: z.string(), epoch: z.literal(1),
    bootstrap: z.strictObject({ account: z.string(), custody_nonce: z.string(), first_device: principal, recovery_key: recovery }),
    custody_root: z.string(), countersign: z.string(), wraps_digest: z.string(),
  }),
  base_seq: z.literal(0), link: z.string(), keyring_link: z.string(), record_sig: z.string(),
  wraps: z.tuple([wrap, wrap]),
})
const intentSchema = z.strictObject({
  version: z.literal(1), account: z.string(), serviceOrigin: z.string(), serviceDeviceId: z.string(),
  syncPrincipal: principal, genesisDigest: z.string(), request,
})

export type GenesisIntent = Readonly<Omit<z.infer<typeof intentSchema>, "request">> & { readonly request: GenesisAppend }

/** Check a CAS winner's proof without minting an anchor or trusting it for this device. */
export const verifyCompetingGenesis = async (entry: KeyringEntry, account: string): Promise<void> => {
  const parsed = request.safeParse({
    record: entry.body, base_seq: entry.base_seq, link: entry.link, keyring_link: entry.keyring_link,
    record_sig: entry.record_sig, wraps: entry.wraps,
  })
  if (!parsed.success || envelopeRefusal(entry) !== null || entry.seq !== 1 || entry.account !== account) {
    throw new GenesisEnableError("intent_mismatch")
  }
  const { record, wraps } = parsed.data
  await validatePrepared({ body: record, wraps })
  const digest = await sha256B64(jcsBytes(record))
  const link = await nextLink("", digest)
  const first = record.bootstrap.first_device
  if (record.account !== account || record.bootstrap.account !== account || digest !== entry.digest ||
      link !== entry.link || link !== entry.keyring_link || entry.author.kind !== "device" ||
      entry.author.id !== first.id || entry.author.signing_public_key !== first.signing_public_key ||
      entry.author.sealing_public_key !== first.sealing_public_key ||
      !await verifyRecordSig(first.signing_public_key, entry)) throw new GenesisEnableError("intent_mismatch")
}

export const verifyGenesisRequest = async (account: string, keyring: DeviceKeyring, request: GenesisAppend): Promise<string> => {
  const first = request.record.bootstrap.first_device
  const own = keyring.publicKeys()
  if (first.id !== keyring.principal().id || first.sealing_public_key !== own.sealing || first.signing_public_key !== own.signing ||
      request.record.account !== account || request.record.bootstrap.account !== account) throw new GenesisEnableError("intent_mismatch")
  await validatePrepared({ body: request.record, wraps: request.wraps })
  const digest = await sha256B64(jcsBytes(request.record))
  const entry: KeyringEntry = {
    seq: 1, kind: "keyring", account, epoch: 1, author: first, body: request.record, digest,
    base_seq: request.base_seq, link: request.link, keyring_link: request.keyring_link,
    record_sig: request.record_sig, wraps: request.wraps,
  }
  const walked = await appendEntries(emptyChain(account, creatorAnchor(account, keyring)), [entry], createRejectionCounter())
  if (!walked.ok || !walked.state.anchored) throw new GenesisEnableError("corrupt_intent")
  const ownWrap = committedWrap(walked.state, 1, `device:${first.id}`)
  const material = ownWrap === null ? null : await ownMaterial(keyring, account, ownWrap, [])
  if (material === null) throw new GenesisEnableError("unusable_key")
  material.current.fill(0)
  for (const older of material.history) older.key.fill(0)
  return digest
}

export const parseGenesisIntent = async (raw: string, expected: {
  readonly account: string; readonly serviceOrigin?: string; readonly serviceDeviceId: string; readonly keyring: DeviceKeyring
}): Promise<GenesisIntent> => {
  let value: unknown
  try { value = JSON.parse(raw) } catch (error) { throw new GenesisEnableError("corrupt_intent", { cause: error }) }
  const parsed = intentSchema.safeParse(value)
  if (!parsed.success) throw new GenesisEnableError("corrupt_intent")
  const intent = parsed.data
  const own = expected.keyring.publicKeys()
  if (intent.account !== expected.account || intent.serviceOrigin !== expected.serviceOrigin ||
      intent.serviceDeviceId !== expected.serviceDeviceId || intent.syncPrincipal.id !== expected.keyring.principal().id ||
      intent.syncPrincipal.sealing_public_key !== own.sealing || intent.syncPrincipal.signing_public_key !== own.signing) {
    throw new GenesisEnableError("intent_mismatch")
  }
  if (await verifyGenesisRequest(expected.account, expected.keyring, intent.request) !== intent.genesisDigest) {
    throw new GenesisEnableError("corrupt_intent")
  }
  return frozenCopy(intent, () => false)
}
