import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createDeviceKeyring, type DeviceKeyring } from "../../keyring-port.ts"
import { type BootstrapAnchor, creatorAnchor } from "../anchor.ts"
import { signRecord } from "../build.ts"
import type { BatchEntry, Head, KeyringBody, KeyringEntry, SyncAuthor, WrapEntry } from "../entry.ts"
import { nextLink } from "../links.ts"
import { recordPayload } from "../signatures.ts"
import { b64urlDecode, b64urlEncode, jcsBytes, sha256B64 } from "../vendor/sync-format/jcs.ts"
import { hkdfSha256, signFramed } from "../vendor/sync-format/keys.ts"

export const FIXTURES = resolve(import.meta.dir, "../vendor/fixtures/sync-v1")

export const readBytes = (path: string): Uint8Array<ArrayBuffer> => {
  const buffer = readFileSync(resolve(FIXTURES, path))
  const bytes = new Uint8Array(buffer.length)
  bytes.set(buffer)
  return bytes
}

type DeviceName = "owner" | "joining" | "recovered" | "recovered2"

type KeysFixture = {
  readonly account: string
  readonly devices: Record<
    DeviceName,
    {
      readonly signing_seed: string
      readonly sealing_private: string
      readonly principal: { readonly id: string }
    }
  >
  readonly wrap_test_device: { readonly sealing_private: string; readonly sealing_public: string }
  readonly recovery: Record<"key1" | "key2", { readonly prf_output: string; readonly enrollment_nonce: string }>
  readonly epochs: Record<string, string>
}

type RawRecord = Omit<KeyringEntry, "wraps">

type ChainFixture = {
  readonly account: string
  readonly main: ReadonlyArray<string>
  readonly branches: { readonly recovery2: ReadonlyArray<string> }
  readonly records: Record<string, RawRecord>
  readonly wraps: Record<string, ReadonlyArray<WrapEntry>>
}

export type ManifestObject = {
  readonly file: string
  readonly batch_id: string
  readonly kind: "ops" | "snapshot"
  readonly epoch: number
  readonly author: DeviceName
  readonly author_principal: { readonly kind: "device"; readonly id: string }
  readonly salt: string
  readonly peers: ReadonlyArray<string>
  readonly chunk?: { readonly index: number; readonly count: number }
  readonly created_at: number
  readonly sha256: string
  readonly payload: ReadonlyArray<{ readonly type: 1 | 2 | 3; readonly space_id: string; readonly item_key: string; readonly body_base64url: string }>
}

type ObjectsFixture = {
  readonly account: string
  readonly objects: ReadonlyArray<ManifestObject>
  readonly snapshot: { readonly chunks: ReadonlyArray<string>; readonly digest: string }
  readonly canaries: ReadonlyArray<string>
}

const readJson = <T>(path: string): T => {
  const parsed: T = JSON.parse(readFileSync(resolve(FIXTURES, path), "utf8"))
  return parsed
}

export const keys = readJson<KeysFixture>("keys.json")
export const chain = readJson<ChainFixture>("chain.json")
export const objects = readJson<ObjectsFixture>("objects/objects.json")
export const ACCOUNT = chain.account

export const record = (name: string): KeyringEntry => {
  const raw = chain.records[name]
  if (raw === undefined) throw new Error(`fixture record ${name} is missing`)
  return { ...raw, wraps: chain.wraps[`${name}_wraps`] ?? [] }
}

export const mainChain = (): ReadonlyArray<KeyringEntry> => chain.main.map(record)

/** The fixture account as its creator (the owner device) walks it: every fixture chain is walked under this anchor. */
export const fixtureAnchor = (account: string = ACCOUNT): BootstrapAnchor => creatorAnchor(account, keyringFor("owner"))

export const epochKey = (epoch: number): Uint8Array<ArrayBuffer> | null => {
  const key = keys.epochs[String(epoch)]
  return key === undefined ? null : b64urlDecode(key)
}

const pkcs8 = (prefixHex: string, raw: string): string =>
  Buffer.concat([Buffer.from(prefixHex, "hex"), Buffer.from(raw, "base64url")]).toString("base64url")

export const keyringFor = (device: DeviceName): DeviceKeyring => {
  const fixture = keys.devices[device]
  return createDeviceKeyring(fixture.principal.id, {
    signingPrivatePkcs8: pkcs8("302e020100300506032b657004220420", fixture.signing_seed),
    sealingPrivatePkcs8: pkcs8("302e020100300506032b656e04220420", fixture.sealing_private),
  })
}

export const deviceId = (device: DeviceName): string => keys.devices[device].principal.id

/** The recovery signing seed derived from the fixture PRF output (section 7 HKDF labels). */
export const recoverySigningSeed = (key: "key1" | "key2"): Promise<Uint8Array<ArrayBuffer>> =>
  hkdfSha256(
    b64urlDecode(keys.recovery[key].prf_output),
    b64urlDecode(keys.recovery[key].enrollment_nonce),
    new TextEncoder().encode("omo-sync/v1/recovery-sign"),
  )

export type Signer = { readonly keyring: DeviceKeyring } | { readonly recoverySeed: Uint8Array<ArrayBuffer>; readonly credentialId: string }

/** Every device principal the fixture chain registers (genesis, approvals, joins), by id. */
const registered = (): ReadonlyMap<string, { readonly sealing_public_key: string; readonly signing_public_key: string }> => {
  const found = new Map<string, { readonly sealing_public_key: string; readonly signing_public_key: string }>()
  for (const raw of Object.values(chain.records)) {
    const body = raw.body
    const bootstrap: unknown = Reflect.get(Object(body), "bootstrap")
    for (const candidate of [Reflect.get(Object(bootstrap), "first_device"), Reflect.get(Object(body), "principal")]) {
      const id: unknown = Reflect.get(Object(candidate), "id")
      const sealing: unknown = Reflect.get(Object(candidate), "sealing_public_key")
      const signing: unknown = Reflect.get(Object(candidate), "signing_public_key")
      if (typeof id === "string" && typeof sealing === "string" && typeof signing === "string") {
        found.set(id, { sealing_public_key: sealing, signing_public_key: signing })
      }
    }
  }
  return found
}

/**
 * A device principal's public keys as the chain registered them (the fixture's sealing keys are
 * synthetic, so a keyring's own derived key would not match), else the keyring's keys.
 */
export const principalKeys = (keyring: DeviceKeyring) =>
  registered().get(keyring.principal().id) ?? {
    sealing_public_key: keyring.publicKeys().sealing,
    signing_public_key: keyring.publicKeys().signing,
  }

const authorOf = (signer: Signer): SyncAuthor =>
  "keyring" in signer
    ? { kind: "device", id: signer.keyring.principal().id, ...principalKeys(signer.keyring) }
    : { kind: "recovery", credential_id: signer.credentialId }

const signFields = async (signer: Signer, fields: Parameters<typeof signRecord>[1]): Promise<string> =>
  "keyring" in signer ? signRecord(signer.keyring, fields) : signFramed("omo-sync/v1/record", recordPayload(fields), signer.recoverySeed)

const linkOrThrow = async (prior: string, digest: string): Promise<string> => {
  const link = await nextLink(prior, digest)
  if (link === null) throw new Error("fixture digest does not decode")
  return link
}

/** A keyring record appended after `head`, signed by `signer` exactly as a client would. */
export const appendKeyring = async (head: Head, body: KeyringBody, signer: Signer, wraps: ReadonlyArray<WrapEntry> = []): Promise<KeyringEntry> => {
  const digest = await sha256B64(jcsBytes(body))
  const link = await linkOrThrow(head.link, digest)
  const keyringLink = await linkOrThrow(head.keyring_link, digest)
  const fields = { account: body.account, base_seq: head.seq, digest, epoch: body.epoch, link, keyring_link: keyringLink }
  return { ...fields, seq: head.seq + 1, kind: "keyring", author: authorOf(signer), body, record_sig: await signFields(signer, fields), wraps }
}

/** A batch entry appended after `head`, its record_sig made through the author's DeviceKeyring. */
export const appendBatch = async (head: Head, digest: string, epoch: number, keyring: DeviceKeyring): Promise<BatchEntry> => {
  const link = await linkOrThrow(head.link, digest)
  const fields = { account: ACCOUNT, base_seq: head.seq, digest, epoch, link, keyring_link: null }
  return { ...fields, seq: head.seq + 1, kind: "batch", author: { kind: "device", id: keyring.principal().id, ...principalKeys(keyring) }, record_sig: await signRecord(keyring, fields) }
}

export const headOf = (entry: { readonly seq: number; readonly link: string; readonly keyring_link: string | null }, keyringLink: string): Head => ({
  seq: entry.seq,
  link: entry.link,
  keyring_link: entry.keyring_link ?? keyringLink,
})

export const digestOf = (bytes: Uint8Array<ArrayBuffer>): Promise<string> => sha256B64(bytes)

export const b64 = (bytes: Uint8Array): string => b64urlEncode(bytes)
