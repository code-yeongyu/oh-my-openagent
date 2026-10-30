import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto"
import { createDeviceKeyring, type DeviceKeyring, generateDeviceKeyMaterial } from "../../keyring-port.ts"
import { creatorAnchor } from "../anchor.ts"
import { appendEntries, type ChainState, emptyChain } from "../chain.ts"
import type { Head, KeyringBody, KeyringEntry, WrapEntry } from "../entry.ts"
import { createRejectionCounter } from "../rejection.ts"
import { wrapSetDigest } from "../links.ts"
import { isObject, type JsonObject, type Principal } from "../parse.ts"
import { deviceIdOf, taggedHash } from "../signatures.ts"
import { compareWrapEntries } from "../vendor/sync-format/canonical.ts"
import { b64urlEncode } from "../vendor/sync-format/jcs.ts"
import { signFramed } from "../vendor/sync-format/keys.ts"
import { ACCOUNT, appendKeyring, record, recoverySigningSeed } from "./sync-v1.test-support.ts"

export const newDevice = async (): Promise<{ readonly keyring: DeviceKeyring; readonly signingSeed: Uint8Array<ArrayBuffer> }> => {
  const material = generateDeviceKeyMaterial()
  const id = await deviceIdOf(material.publicKeys.signing)
  if (id === null) throw new Error("generated signing key does not decode")
  const der = Buffer.from(material.signingPrivatePkcs8, "base64url")
  return { keyring: createDeviceKeyring(id, material), signingSeed: new Uint8Array(der.subarray(der.length - 32)) }
}

export const newDeviceKeyring = async (): Promise<DeviceKeyring> => (await newDevice()).keyring

export type RecoveryCredential = { readonly seed: Uint8Array<ArrayBuffer>; readonly key: JsonObject }

const random = (length: number): string => b64urlEncode(crypto.getRandomValues(new Uint8Array(length)))

/** A recovery key made from scratch, as a forger (the server) would make its own. */
export const newRecoveryCredential = (): RecoveryCredential => {
  const seed = crypto.getRandomValues(new Uint8Array(32))
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)])
  const signing = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).export({ format: "jwk" }).x ?? ""
  const sealing = generateKeyPairSync("x25519").publicKey.export({ format: "jwk" }).x ?? ""
  const key = { credential_id: random(16), rp_id: "omo.dev", enrollment_nonce: random(32), sealing_public_key: sealing, signing_public_key: signing, survivable: "synced" }
  return { seed, key }
}

export const fixtureRecoveryCredential = async (): Promise<RecoveryCredential> => {
  const bootstrap = record("genesis").body["bootstrap"]
  if (!isObject(bootstrap) || !isObject(bootstrap["recovery_key"])) throw new Error("fixture genesis has no recovery key")
  return { seed: await recoverySigningSeed("key1"), key: bootstrap["recovery_key"] }
}

export const principalOf = (keyring: DeviceKeyring): Principal => ({
  kind: "device",
  id: keyring.principal().id,
  sealing_public_key: keyring.publicKeys().sealing,
  signing_public_key: keyring.publicKeys().signing,
})

const committedWraps = async (wraps: ReadonlyArray<WrapEntry>) => {
  const sorted = [...wraps].sort(compareWrapEntries)
  const set = await wrapSetDigest(sorted)
  if (!set.ok) throw new Error("wrap set")
  return { sorted, digest: set.digest }
}

export const genesisEntry = async (account: string, keyring: DeviceKeyring, deviceWrap: string, recovery: RecoveryCredential): Promise<KeyringEntry> => {
  const firstDevice = principalOf(keyring)
  const { sorted, digest } = await committedWraps([
    { epoch: 1, id: `device:${firstDevice.id}`, wrap: deviceWrap },
    { epoch: 1, id: `recovery:${String(recovery.key["credential_id"])}`, wrap: "R".repeat(43) },
  ])
  const bootstrap = { account, custody_nonce: random(32), first_device: firstDevice, recovery_key: recovery.key }
  const custodyRoot = await taggedHash("omo-sync/v1/custody-root", bootstrap)
  const countersign = await signFramed(
    "omo-sync/v1/recovery-countersign",
    { t: "omo-sync/v1/recovery-countersign", account, custody_root: custodyRoot, predecessor: "", wraps_digest: digest },
    recovery.seed,
  )
  const body: KeyringBody = { kind: "genesis", account, epoch: 1, bootstrap, custody_root: custodyRoot, countersign, wraps_digest: digest }
  return appendKeyring({ seq: 0, link: "", keyring_link: "" }, body, { keyring }, sorted)
}

export type PairingTranscript = { readonly commitment: string; readonly joining_nonce: string; readonly approver_nonce: string }

/** The transcript the joining device's ceremony produced: its commitment over its own keys and nonce, plus both nonces. */
export const pairingTranscript = async (account: string, joining: DeviceKeyring): Promise<PairingTranscript> => {
  const joiningNonce = random(16)
  const commitment = await taggedHash("omo-sync/v1/approval-commitment", {
    account,
    sealing_public_key: joining.publicKeys().sealing,
    signing_public_key: joining.publicKeys().signing,
    nonce: joiningNonce,
  })
  return { commitment, joining_nonce: joiningNonce, approver_nonce: random(16) }
}

export const approvalEntry = async (
  head: Head,
  account: string,
  approver: DeviceKeyring,
  joining: DeviceKeyring,
  transcript: PairingTranscript,
  joiningWrap: string,
): Promise<KeyringEntry> => {
  const principal = principalOf(joining)
  const { sorted, digest } = await committedWraps([{ epoch: 1, id: `device:${principal.id}`, wrap: joiningWrap }])
  const body: KeyringBody = { kind: "approval", account, epoch: 1, principal, wraps_digest: digest, pairing: { ...transcript } }
  return appendKeyring(head, body, { keyring: approver }, sorted)
}

export const headAfter = (entry: KeyringEntry): Head => ({ seq: entry.seq, link: entry.link, keyring_link: entry.keyring_link })

/** A one-record chain the device itself created (creator anchor), committing `deviceWrap` as its epoch-1 wrap. */
export const verifiedGenesisFor = async (keyring: DeviceKeyring, deviceWrap: string): Promise<ChainState> => {
  const genesis = await genesisEntry(ACCOUNT, keyring, deviceWrap, await fixtureRecoveryCredential())
  const outcome = await appendEntries(emptyChain(ACCOUNT, creatorAnchor(ACCOUNT, keyring)), [genesis], createRejectionCounter())
  if (!outcome.ok) throw new Error(`test genesis refused: ${outcome.reason}`)
  return outcome.state
}
