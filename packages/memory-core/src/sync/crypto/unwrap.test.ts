import { describe, expect, test } from "bun:test"
import { createCipheriv, createHmac, createPublicKey, diffieHellman, generateKeyPairSync } from "node:crypto"
import { createDeviceKeyring, type DeviceKeyring, type WrapBinding } from "../keyring-port.ts"
import type { ChainState } from "./chain.ts"
import type { WrapEntry } from "./entry.ts"
import { openHistory, openWrap } from "./unwrap.ts"
import { newDeviceKeyring, verifiedGenesisFor } from "./testing/genesis.ts"
import { ACCOUNT, keys, readBytes } from "./testing/sync-v1.test-support.ts"
import { b64urlEncode, type JsonValue, jcsBytes } from "./vendor/sync-format/jcs.ts"

type WrapsFixture = {
  readonly account: string
  readonly wraps: ReadonlyArray<{
    readonly name: string
    readonly epoch: number
    readonly id: string
    readonly wrap: string
    readonly key_material: JsonValue
    readonly history_plaintext: ReadonlyArray<{ readonly epoch: number; readonly origin: string; readonly key: string }>
  }>
}

const fixture: WrapsFixture = JSON.parse(new TextDecoder().decode(readBytes("wraps.json")))

// A test-side §8.1 sender (RFC 9180 base mode, info "omo-sync/v1/wrap\0", AAD = JCS{account,
// epoch, id}), so the receive path below is exercised only through keyring.unseal.
const sealToPort = (recipient: string, plaintext: Uint8Array, binding: WrapBinding): Uint8Array => {
  const ephemeral = generateKeyPairSync("x25519")
  const enc = Buffer.from(ephemeral.publicKey.export({ format: "jwk" }).x ?? "", "base64url")
  const dh = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: createPublicKey({ key: { kty: "OKP", crv: "X25519", x: recipient }, format: "jwk" }) })
  const kem = Buffer.concat([Buffer.from("KEM"), Buffer.from([0, 32])])
  const suite = Buffer.concat([Buffer.from("HPKE"), Buffer.from([0, 32, 0, 1, 0, 2])])
  const info = Buffer.concat([Buffer.from("omo-sync/v1/wrap"), Buffer.from([0])])
  const extract = (id: Buffer, label: string, value: Uint8Array, salt = Buffer.alloc(0)) =>
    createHmac("sha256", salt).update(Buffer.concat([Buffer.from("HPKE-v1"), id, Buffer.from(label), value])).digest()
  const expand = (id: Buffer, label: string, key: Buffer, data: Uint8Array, length: number) =>
    createHmac("sha256", key).update(Buffer.concat([Buffer.from([0, length]), Buffer.from("HPKE-v1"), id, Buffer.from(label), data])).update(Buffer.from([1])).digest().subarray(0, length)
  const secret = expand(kem, "shared_secret", extract(kem, "eae_prk", dh), Buffer.concat([enc, Buffer.from(recipient, "base64url")]), 32)
  const context = Buffer.concat([Buffer.from([0]), extract(suite, "psk_id_hash", Buffer.alloc(0)), extract(suite, "info_hash", info)])
  const schedule = extract(suite, "secret", Buffer.alloc(0), secret)
  const cipher = createCipheriv("aes-256-gcm", expand(suite, "key", schedule, context, 32), expand(suite, "base_nonce", schedule, context, 12))
  cipher.setAAD(jcsBytes({ account: binding.account, epoch: binding.epoch, id: binding.id }))
  return Buffer.concat([enc, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

const keyMaterial = async (account: string, epoch: number, id: string, history: ReadonlyArray<JsonValue>) => {
  const current = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey("raw", current, "AES-GCM", false, ["encrypt"])
  const additionalData = jcsBytes({ account, epoch, id, version: 1 })
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData }, key, jcsBytes(history)))
  return { version: 1, current_key: b64urlEncode(current), history: { nonce: b64urlEncode(nonce), ciphertext: b64urlEncode(ciphertext) } }
}

/**
 * Seals a well-formed envelope to `sealTo`'s key, addressed to `addressee`; `envelopeAccount` is
 * the account the envelope names, while the AEAD always binds the chain's account.
 */
const sealedWrap = async (sealTo: DeviceKeyring, addressee: DeviceKeyring, envelopeAccount: string = ACCOUNT): Promise<string> => {
  const id = `device:${addressee.principal().id}`
  const material = await keyMaterial(envelopeAccount, 1, id, [])
  const envelope = { version: 1, account: envelopeAccount, epoch: 1, id, key_material: material }
  return b64urlEncode(sealToPort(sealTo.publicKeys().sealing, jcsBytes(envelope), { account: ACCOUNT, epoch: 1, id }))
}

const deviceWrapOf = (state: ChainState, keyring: DeviceKeyring) => {
  const wrap = state.received[0]?.wraps.find((candidate) => candidate.id === `device:${keyring.principal().id}`)
  if (wrap === undefined) throw new Error("test genesis carries no device wrap")
  return wrap
}

const committedTo = async (keyring: DeviceKeyring, wrap: Promise<string>) => deviceWrapOf(await verifiedGenesisFor(keyring, await wrap), keyring)

/** The committed wraps.json entry sealed to the wrap-test device, opened with that device's key. */
const wrapTestKeyring = (): DeviceKeyring => {
  const raw = Buffer.from(keys.wrap_test_device.sealing_private, "base64url")
  const sealingPrivatePkcs8 = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), raw]).toString("base64url")
  const signing = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url")
  return createDeviceKeyring("wrap-test", { signingPrivatePkcs8: signing, sealingPrivatePkcs8 })
}
const committedWrap = (): WrapEntry => {
  const wrap = fixture.wraps.find((candidate) => candidate.name === "epoch1_to_wrap_test_device")
  if (wrap === undefined) throw new Error("fixture missing epoch1_to_wrap_test_device")
  return { epoch: wrap.epoch, id: wrap.id, wrap: wrap.wrap }
}

describe("openHistory: the epoch-history layer of a wrap's key material", () => {
  test.each(fixture.wraps.map((wrap) => [wrap.name, wrap] as const))("opens the %s fixture bundle to its committed history", async (_name, wrap) => {
    const expected = new Map(wrap.history_plaintext.map((row) => [row.epoch, row.origin]))
    const opened = await openHistory(wrap.key_material, { account: fixture.account, epoch: wrap.epoch, id: wrap.id }, expected)
    expect([...(opened?.history.entries() ?? [])].map(([epoch, key]) => ({ epoch, key: b64urlEncode(key) }))).toEqual(
      wrap.history_plaintext.map((row) => ({ epoch: row.epoch, key: row.key })),
    )
  })

  test("a bundle carrying a cancelled or unproven origin is refused", async () => {
    const wrap = fixture.wraps.find((candidate) => candidate.name === "epoch3_to_recovery2")
    if (wrap === undefined) throw new Error("fixture missing")
    const withoutEpoch2 = new Map(wrap.history_plaintext.filter((row) => row.epoch !== 2).map((row) => [row.epoch, row.origin]))
    expect(await openHistory(wrap.key_material, { account: fixture.account, epoch: 3, id: wrap.id }, withoutEpoch2)).toBeNull()
  })

  test("a bundle moved to another recipient fails its AEAD", async () => {
    const wrap = fixture.wraps.find((candidate) => candidate.name === "epoch1_to_recovery1")
    if (wrap === undefined) throw new Error("fixture missing")
    expect(await openHistory(wrap.key_material, { account: fixture.account, epoch: 1, id: "device:someone-else" }, new Map())).toBeNull()
  })
})

describe("DeviceKeyring.unseal: the section 8.1 construction against the committed vector", () => {
  test("the committed wraps.json wrap unseals to an envelope whose history opens to the epoch-1 key", async () => {
    const wrap = committedWrap()
    const binding = { account: fixture.account, epoch: wrap.epoch, id: wrap.id }
    const envelope: unknown = JSON.parse(new TextDecoder().decode(await wrapTestKeyring().unseal(Buffer.from(wrap.wrap, "base64url"), binding)))
    const opened = await openHistory(Reflect.get(Object(envelope), "key_material"), binding, new Map())
    expect(opened === null ? null : b64urlEncode(opened.current)).toBe(keys.epochs["1"] ?? "")
  })

  test("the same genuine wrap bound to another account or epoch fails its AEAD", async () => {
    const wrap = committedWrap()
    const sealed = Buffer.from(wrap.wrap, "base64url")
    for (const binding of [{ account: "another-account", epoch: wrap.epoch, id: wrap.id }, { account: fixture.account, epoch: 2, id: wrap.id }]) {
      await expect(wrapTestKeyring().unseal(sealed, binding)).rejects.toThrow()
    }
  })
})

describe("openWrap: only a wrap from a verified chain entry, only through the DeviceKeyring", () => {
  test("a wrap committed in a verified chain opens to its epoch keys", async () => {
    const keyring = await newDeviceKeyring()
    const opened = await openWrap(keyring, await committedTo(keyring, sealedWrap(keyring, keyring)), ACCOUNT, new Map())
    expect(opened.ok && opened.keys.current.length).toBe(32)
  })

  test("a bare wrap that no verified entry produced is refused before anything is unsealed", async () => {
    const keyring = await newDeviceKeyring()
    const unsealed: unknown[] = []
    const watched = { ...keyring, unseal: (wrap: Uint8Array, binding: WrapBinding) => { unsealed.push(binding); return keyring.unseal(wrap, binding) } }
    const bare: WrapEntry = { epoch: 1, id: `device:${keyring.principal().id}`, wrap: await sealedWrap(keyring, keyring) }
    // @ts-expect-error a bare WrapEntry carries no proof that a verified entry committed it
    expect(await openWrap(watched, bare, ACCOUNT, new Map())).toEqual({ ok: false, reason: "unverified_wrap" })
    const verified = await committedTo(keyring, sealedWrap(keyring, keyring))
    expect(await openWrap(watched, { ...verified, epoch: 2 }, ACCOUNT, new Map())).toEqual({ ok: false, reason: "unverified_wrap" })
    expect(unsealed).toEqual([])
  })

  test("a verified wrap opened for another account is refused", async () => {
    const keyring = await newDeviceKeyring()
    const wrap = await committedTo(keyring, sealedWrap(keyring, keyring))
    expect(await openWrap(keyring, wrap, "another-account", new Map())).toEqual({ ok: false, reason: "envelope_mismatch" })
  })

  test("an envelope naming another account under a correct binding is refused", async () => {
    const keyring = await newDeviceKeyring()
    const wrap = await committedTo(keyring, sealedWrap(keyring, keyring, "another-account"))
    expect(await openWrap(keyring, wrap, ACCOUNT, new Map())).toEqual({ ok: false, reason: "envelope_mismatch" })
  })

  test("a wrap addressed to another device is never unsealed", async () => {
    const keyring = await newDeviceKeyring()
    const other = await newDeviceKeyring()
    const wrap = await committedTo(other, sealedWrap(other, other))
    expect(await openWrap(keyring, wrap, ACCOUNT, new Map())).toEqual({ ok: false, reason: "not_addressed_to_device" })
  })

  test("a committed wrap this device cannot unseal is refused", async () => {
    const keyring = await newDeviceKeyring()
    const stranger = await newDeviceKeyring()
    const wrap = await committedTo(keyring, sealedWrap(stranger, keyring))
    expect(await openWrap(keyring, wrap, ACCOUNT, new Map())).toEqual({ ok: false, reason: "wrap_refused" })
  })
})
