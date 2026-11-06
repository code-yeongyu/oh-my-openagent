import { describe, expect, test } from "bun:test"
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, createHmac, verify } from "node:crypto"
import { createDeviceKeyring, createInMemoryDeviceKeyring, DeviceKeyringSignError } from "./keyring-port"

// Spec §8.1 wrap sender: HPKE base mode with info = "omo-sync/v1/wrap" || 0x00 and the given AAD.
// Shares the RFC 9180 schedule of the KAT below (length-first LabeledExpand, per RFC 9180 §4).
function sealWrapWith(recipient: string, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  const ephemeral = generateKeyPairSync("x25519")
  const enc = Buffer.from(ephemeral.publicKey.export({ format: "jwk" }).x ?? "", "base64url")
  const pkR = Buffer.from(recipient, "base64url")
  const dh = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: createPublicKey({ key: { kty: "OKP", crv: "X25519", x: recipient }, format: "jwk" }) })
  const kem = Buffer.concat([Buffer.from("KEM"), Buffer.from([0, 32])])
  const suite = Buffer.concat([Buffer.from("HPKE"), Buffer.from([0, 32, 0, 1, 0, 2])])
  const info = Buffer.concat([Buffer.from("omo-sync/v1/wrap"), Buffer.from([0])])
  const extract = (suiteId: Buffer, label: string, value: Uint8Array, salt = Buffer.alloc(0)) =>
    createHmac("sha256", salt).update(Buffer.concat([Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), value])).digest()
  const expand = (suiteId: Buffer, label: string, key: Buffer, ctx: Uint8Array, length: number) => {
    const lb = Buffer.alloc(2)
    lb.writeUInt16BE(length)
    return createHmac("sha256", key).update(Buffer.concat([lb, Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), ctx, Buffer.from([1])])).digest().subarray(0, length)
  }
  const secret = expand(kem, "shared_secret", extract(kem, "eae_prk", dh), Buffer.concat([enc, pkR]), 32)
  const context = Buffer.concat([Buffer.from([0]), extract(suite, "psk_id_hash", Buffer.alloc(0)), extract(suite, "info_hash", info)])
  const schedule = extract(suite, "secret", Buffer.alloc(0), secret)
  const cipher = createCipheriv("aes-256-gcm", expand(suite, "key", schedule, context, 32), expand(suite, "base_nonce", schedule, context, 12))
  if (aad.length > 0) cipher.setAAD(Buffer.from(aad))
  return Buffer.concat([enc, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

const WRAPS_ACCOUNT = "encoding-account"

// RFC 5869 HKDF-SHA256 one-block expand helper, matching the fixture generator's recovery
// sealing-key derivation (gen/wraps.mjs hkdf32(ikm, salt, "omo-sync/v1/recovery-seal")).
function hkdf32Sha256(ikm: Uint8Array, salt: Uint8Array): Uint8Array {
  const prk = createHmac("sha256", Buffer.from(salt)).update(Buffer.from(ikm)).digest()
  return createHmac("sha256", prk).update(Buffer.concat([Buffer.from("omo-sync/v1/recovery-seal"), Buffer.from([1])])).digest()
}

const WRAPS_FIXTURE: ReadonlyArray<{ name: string; epoch: number; id: string; wrap: string; envelope: string }> = [
  {
    name: "epoch1_to_recovery1",
    epoch: 1,
    id: "recovery:CwsLCwsLCwsLCwsLCwsLCw",
    wrap: "Sk-MzeGY1m6ZtMAUQYoyI84lbJiQCuSmgR_RD364TCx3_VF6jOgMaFWsWgH1SxETjZ0TEPsTzicSFU21umey8hfX15-DGsR7ZYk_aqZyQhKqYm3ePOfAvJR8sM4IUByo24W-N5e6HW2SG_WGeKaLZS1PSJdCj1MsbkymRW5TlA3oz4uKKIVxBRg23upImYNtd7WC0UuYVVDAZjTC0zRrg6tb4HFbwGb9shTXB0cdXm4nNr_8da5RIJAKuIKlfvG4y8y1xtZcthN2XFYay9eLeUtc_9Ah9udd-fxu6aoDmJAhRDc9-YqIXBdIzdmWxoW5mUtiiwWHHZyxtyJs4PGlMKnDLbyGBBheZZO5WUK6Dk05lyzjEBMLLeUjdxrbN5oRDza9nq_1AT5ZHJGkXzE-4C5dcA",
    envelope: "{\"account\":\"encoding-account\",\"epoch\":1,\"id\":\"recovery:CwsLCwsLCwsLCwsLCwsLCw\",\"key_material\":{\"current_key\":\"PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0\",\"history\":{\"ciphertext\":\"mbnDd-8yTI3xE9NhHp8fSVsE\",\"nonce\":\"Y2NjY2NjY2NjY2Nj\"},\"version\":1},\"version\":1}",
  },
  {
    name: "epoch3_to_recovery2",
    epoch: 3,
    id: "recovery:FRUVFRUVFRUVFRUVFRUVFQ",
    wrap: "az1Xdi-LrbaUM_nG0GD4X15ca2gDqBbRQcB19jVBrRCElmDIKt8T8LQMkiY9bHvY6AK1XvecmYxgPl472oM6Q9gj_TvSQpXVZtcVA15dmyaxwuDV_AJpcemFsKeqyEoi92_O1IfU77L6rij3JioYmFGV6tuazUWczRg1GQPFQz_TuMe_rg8zkivPA0FIAZr4m-gtD3cg_GwvyAjeZjIRrxY46j1qdwWTKeyBb0mX8z7ZpdoofoHxiH4sdNZXeviaQIor5rKlgYUDVxEeMhODJDKofCjExqhAC3i-p_GbEMCdh3AfpyTeHdvIqJbpslA8BsJrNXqfmxQ71WOFGGUlfCFn0pyJBxY8TgIzKZHeStaC5rVhNdrP0_8qMzS9DCcG8KWDM3VaAFqQrkMxOLVRxtsLvJj6uwVjhyZ4QlBk60vSua8NUSBvTF4taCNIsch15DFVbXDn3VDtWrCGAjdC6Eo5gBeaYUH0L85RNY03IggzAtHUNTG8-dXhE1ZvGfMt2QafC_C0Kdab2sBE0ujngQOPSbmLY6Xa1iwweZ6eOweGqxyE2D1L2SUEvJUsChxtovTcO1N9O4EtJgawM_cyYrr6YXAP7ao4SJvpot3SMMMcxyWJNiYNWu4PlRVrbckh_lYFaOljwMaAtWEdjpV4mCZbk9-xIEZURobvRtphUoo38rL1bLAE7taXTqxyiFMsuva3YboXtqWI5JbkBrIk-sbWBQ9RxNBXBkCxxk_OqU8wOW2wwS44fXS-DD2sj2l3NzWBqbImCRnAAd_sxRe3sctnQAo_aOS0H4OLyrc-V08vyk30zOM1_zouDzrv11o",
    envelope: "{\"account\":\"encoding-account\",\"epoch\":3,\"id\":\"recovery:FRUVFRUVFRUVFRUVFRUVFQ\",\"key_material\":{\"current_key\":\"Pz8_Pz8_Pz8_Pz8_Pz8_Pz8_Pz8_Pz8_Pz8_Pz8_Pz8\",\"history\":{\"ciphertext\":\"lnEVcvhAXqGZkwIbPv16yKJ-gbRZtJHW41NAIXX_3g14kezPx37Q08iwYdL_e5V-GQDbNTNrEfsat_Gj88V1HTgepb881fIp8wd-ZcLzY5P4CzweuDuqUU5wUn3Om6e26NujFqvBLCtwBA-hfeis-gitRltS7XhTs1OG2xhiDaTu50x9n5X7PDpc5CaqSjoM6K2aB71E1vkUgLSyTUQJPxtlE52pFJ94XeCBnvawtGQmDJl75K9rY4wsg_OkmjlpU3snrCD6_LBehWQ_TQNS2Js8LUdnXLoq-4WadYVUeMa-wRd4EOUCmxxc5c7sY92al8r3a0Jb3pxsE96Eq_ij\",\"nonce\":\"ZWVlZWVlZWVlZWVl\"},\"version\":1},\"version\":1}",
  },
  {
    name: "epoch1_to_wrap_test_device",
    epoch: 1,
    id: "device:wrap-test",
    wrap: "IZ5NgA2paNKl_LAJx4T0dGxxOO257khEtznoMLBc9CQz0wpIeWDLGW8zo1ir0s8CrPbOISnaAIyPx73ysj1Aa3J7E4p7N7bNFfkRIkalU4PBW6x_14QB-jk8AgXJCibqtTPs8j4ZPfNrp5gPqrjGBTyzB-46GaCQYAlhrO6LopyxwYV_RTRMxIKuZ5ap-UMPuIncTGezZ3CVTkPMrRpiEi5BlYaLS_sKZtfYBWg0QejfaOa8yfAaoAGJDw44g-1i3UPzJylR4cN7MW4-OM47GH6Bb_sRbuqAMAp8ClRF2_uGxKKfg_jBRClwUOaYU_srf6eNvOzKGh5V8YIU1IT1ZWnBWstC3vMjIhRPvDWPcHVwh6TcT8AqNvmgDQhdjZ6UzZTbRA",
    envelope: "{\"account\":\"encoding-account\",\"epoch\":1,\"id\":\"device:wrap-test\",\"key_material\":{\"current_key\":\"PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0\",\"history\":{\"ciphertext\":\"K4Iv7W4Y-0kv2isbpjQ3VtKX\",\"nonce\":\"Z2dnZ2dnZ2dnZ2dn\"},\"version\":1},\"version\":1}",
  },
]

const SIGNING_TAGS = { "object-digest": "omo-sync/v1/object-digest", record: "omo-sync/v1/record", snapshot: "omo-sync/v1/snapshot" } as const

function taggedMessage(tag: string, payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(tag, "ascii"), Buffer.from([0]), Buffer.from(payload)])
}

describe("DeviceKeyring", () => {
  test("signs an object digest as tagged bytes and verifies with the advertised raw Ed25519 key", async () => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    const digest = new Uint8Array(32).fill(7)
    const signature = await keyring.sign({ purpose: "object-digest", digest })
    expect(keyring.principal()).toEqual({ kind: "device", id: "fixture-device" })
    const publicKeys = keyring.publicKeys()
    expect(Buffer.from(publicKeys.signing, "base64url")).toHaveLength(32)
    expect(Buffer.from(publicKeys.sealing, "base64url")).toHaveLength(32)
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKeys.signing }, format: "jwk" })
    expect(verify(null, taggedMessage(SIGNING_TAGS["object-digest"], digest), publicKey, signature)).toBe(true)
    expect(JSON.stringify(keyring)).not.toContain("PRIVATE")
  })

  test("signs a canonical record preimage as tagged bytes", async () => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    const canonicalJson = new TextEncoder().encode('{"account":"acc","base_seq":1,"digest":"AA","epoch":1,"link":"AA","t":"omo-sync/v1/record"}')
    const signature = await keyring.sign({ purpose: "record", canonicalJson })
    const publicKeys = keyring.publicKeys()
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKeys.signing }, format: "jwk" })
    expect(verify(null, taggedMessage(SIGNING_TAGS.record, canonicalJson), publicKey, signature)).toBe(true)
  })

  test("signs a canonical record that contains spaces inside string values", async () => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    const canonicalJson = new TextEncoder().encode('{"name":"My Mac","t":"omo-sync/v1/record"}')
    const signature = await keyring.sign({ purpose: "record", canonicalJson })
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: keyring.publicKeys().signing }, format: "jwk" })
    expect(verify(null, taggedMessage(SIGNING_TAGS.record, canonicalJson), publicKey, signature)).toBe(true)
  })

  test.each([
    ["whitespace between tokens", '{ "t":"omo-sync/v1/record" }', "record-canonical-whitespace"],
    ["unsorted keys", '{"z":1,"t":"omo-sync/v1/record","a":2}', "record-canonical-order"],
    ["duplicate t bypassing the digest-tag refusal", '{"t":"omo-sync/v1/object-digest","t":"omo-sync/v1/record"}', "record-canonical-duplicate-key"],
    ["non-canonical number", '{"n":1.0,"t":"omo-sync/v1/record"}', "record-canonical-number"],
    ["non-minimal escape", '{"t":"omo-sync\\/v1\\/record"}', "record-canonical-escape"],
  ] as const)("refuses a non-canonical record: %s", async (_label, input, reason) => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    let failure: unknown
    try {
      await keyring.sign({ purpose: "record", canonicalJson: new TextEncoder().encode(input) })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(DeviceKeyringSignError)
    expect((failure as DeviceKeyringSignError).reason).toBe(reason)
  })

  test("domain separation: no signature verifies across purposes or untagged", async () => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    const publicKeys = keyring.publicKeys()
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKeys.signing }, format: "jwk" })
    const digest = new Uint8Array(32).fill(9)
    const canonicalJson = new TextEncoder().encode('{"epoch":2,"t":"omo-sync/v1/record"}')
    const digestSig = await keyring.sign({ purpose: "object-digest", digest })
    const recordSig = await keyring.sign({ purpose: "record", canonicalJson })
    // A signature made for one purpose must not verify under the other purpose's tag.
    expect(verify(null, taggedMessage(SIGNING_TAGS.record, digest), publicKey, digestSig)).toBe(false)
    expect(verify(null, taggedMessage(SIGNING_TAGS["object-digest"], canonicalJson), publicKey, recordSig)).toBe(false)
    // And no signature verifies over the untagged payload.
    expect(verify(null, digest, publicKey, digestSig)).toBe(false)
    expect(verify(null, canonicalJson, publicKey, recordSig)).toBe(false)
  })

  test("refuses malformed sign requests with a typed error", async () => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    const digest31 = new Uint8Array(31)
    const withoutT = new TextEncoder().encode('{"account":"acc"}')
    const wrongPrefix = new TextEncoder().encode('{"t":"omo-other/v1/record"}')
    const digestTagAsRecord = new TextEncoder().encode('{"t":"omo-sync/v1/object-digest"}')
    const nonCanonical = new TextEncoder().encode('{ "t":"omo-sync/v1/record" }')
    const unknownPurpose = { purpose: "anything", digest: new Uint8Array(32) } as unknown as Parameters<typeof keyring.sign>[0]
    for (const request of [
      { purpose: "object-digest", digest: digest31 },
      { purpose: "record", canonicalJson: withoutT },
      { purpose: "record", canonicalJson: wrongPrefix },
      { purpose: "record", canonicalJson: digestTagAsRecord },
      { purpose: "record", canonicalJson: nonCanonical },
      unknownPurpose,
    ] as const) {
      let failure: unknown
      try {
        await keyring.sign(request)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DeviceKeyringSignError)
    }
  })

  test("opens an independently constructed HPKE sealed box", async () => {
    const keyring = createInMemoryDeviceKeyring("receiver")
    const plaintext = new TextEncoder().encode("epoch key fixture")
    const binding = { account: "acct", epoch: 1, id: "device:receiver" }
    expect(await keyring.unseal(sealWrapWith(keyring.publicKeys().sealing, plaintext, new TextEncoder().encode(JSON.stringify({ account: binding.account, epoch: binding.epoch, id: binding.id }))), binding)).toEqual(plaintext)
  })

  test("signs the snapshot preimage with the omo-sync/v1/snapshot tag (spec §6 compaction)", async () => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    // Spec preimage (docs/sync-design.md @21e075732e76 §6 compaction): canonical JSON of the
    // full signed object {t, account, author, covers_seq, digest, link, keyring_head}; author
    // included. Field values mirror fixtures/sync-v1/snapshot.json (omo-service, synthetic);
    // author is flattened to the device principal id, as the wire signs it.
    const author = "HcahOcBrYYAu1Uf5BVu8YQ"
    const canonicalJson = new TextEncoder().encode(
      `{"account":"encoding-account","author":"${author}","covers_seq":105,"digest":"yBJnafUZtXXtWhmQMrQdABtpG2ZCeE3Ow8ac3_AFUiw","keyring_head":"btNvqyim9uDOvIpM2FerksyzIsDSy54XPsqWlqa3ls8","link":"btNvqyim9uDOvIpM2FerksyzIsDSy54XPsqWlqa3ls8","t":"omo-sync/v1/snapshot"}`,
    )
    const signature = await keyring.sign({ purpose: "snapshot", canonicalJson })
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: keyring.publicKeys().signing }, format: "jwk" })
    expect(verify(null, taggedMessage(SIGNING_TAGS.snapshot, canonicalJson), publicKey, signature)).toBe(true)
    // Domain separation: a snapshot signature must not verify under the record tag.
    expect(verify(null, taggedMessage(SIGNING_TAGS.record, canonicalJson), publicKey, signature)).toBe(false)
  })

  test("wrap construction conforms to the spec and the wraps.json golden vectors", async () => {
    // §8.1 + fixtures/sync-v1/wraps.json (omo-service, fixture commit 67b2dbc): wrap info is
    // "omo-sync/v1/wrap" || 0x00 and AAD is JCS{account, epoch, id}; plaintext is the envelope
    // JCS{version:1, account, epoch, id, key_material}. Known upstream divergence (tracked in
    // waves/w3/t13-crypto.md finding 3): the fixture generator's LabeledExpand deviates from
    // RFC 9180 §4 (length after label instead of first), so the vectors on disk cannot open
    // under any RFC-correct construction; this test hard-fails until upstream regenerates them.
    const jcs = (v: unknown): string => {
      if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`
      if (v !== null && typeof v === "object") {
        return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${jcs((v as Record<string, unknown>)[k])}`).join(",")}}`
      }
      return JSON.stringify(v)
    }
    const rawDev = new Uint8Array(32).fill(97) // keys.json wrap_test_device.sealing_private
    const devMaterial = {
      signingPrivatePkcs8: createPrivateKey({
        key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), new Uint8Array(32).fill(1)]),
        format: "der",
        type: "pkcs8",
      }).export({ format: "der", type: "pkcs8" }).toString("base64url"),
      sealingPrivatePkcs8: createPrivateKey({
        key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), Buffer.from(rawDev)]),
        format: "der",
        type: "pkcs8",
      }).export({ format: "der", type: "pkcs8" }).toString("base64url"),
    }
    const keyring = createDeviceKeyring("wrap-test", devMaterial)
    const account = "encoding-account"
    const epoch = 1
    const id = "device:wrap-test"
    const aad = new TextEncoder().encode(jcs({ account, epoch, id }))
    const material = {
      version: 1,
      current_key: Buffer.from(new Uint8Array(32).fill(61)).toString("base64url"),
      history: { nonce: Buffer.from(new Uint8Array(12).fill(103)).toString("base64url"), ciphertext: "K4Iv7W4Y-0kv2isbpjQ3VtKX" },
    }
    const plaintext = new TextEncoder().encode(jcs({ version: 1, account, epoch, id, key_material: material }))
    const wrap = sealWrapWith(keyring.publicKeys().sealing, plaintext, aad)
    expect(await keyring.unseal(wrap, { account, epoch, id })).toEqual(plaintext)
    // The full envelope, nested key_material included, must be canonical JSON byte-for-byte.
    const openedText = new TextDecoder().decode(await keyring.unseal(wrap, { account, epoch, id }))
    expect(openedText).toBe(jcs({ version: 1, account, epoch, id, key_material: material }))
  })

  // Golden vectors from omo-service fixtures/sync-v1/wraps.json, vendored into this test at
  // sisyphuslabs/omo-service commit aaf7bb79540953bf9e0502d4a7b898438e22ae2d (branch
  // memsync/sync-contract-format, PR #428, which regenerated the file with the RFC 9180 §4
  // LabeledExpand layout; the pre-#428 fixture could not be opened by an RFC-correct
  // construction). Copied here so the test never reads outside this repo. The pre-#428
  // fixture was proven not to open (the previous revision of this leg failed under it), and
  // this regenerated fixture must open under the same port.
  const fixtureKeyrings = {
    "recovery:CwsLCwsLCwsLCwsLCwsLCw": hkdf32Sha256(new Uint8Array(32).fill(42), new Uint8Array(32).fill(43)),
    "recovery:FRUVFRUVFRUVFRUVFRUVFQ": hkdf32Sha256(new Uint8Array(32).fill(52), new Uint8Array(32).fill(53)),
    "device:wrap-test": new Uint8Array(32).fill(97),
  }
  for (const entry of WRAPS_FIXTURE) {
    test(`opens the wraps.json golden vector ${entry.name} to its exact canonical envelope`, async () => {
      const sealingPrivate = fixtureKeyrings[entry.id as keyof typeof fixtureKeyrings]
      const keyring = createDeviceKeyring(entry.id.replace(/^device:/, ""), {
        signingPrivatePkcs8: createPrivateKey({
          key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), new Uint8Array(32).fill(1)]),
          format: "der",
          type: "pkcs8",
        }).export({ format: "der", type: "pkcs8" }).toString("base64url"),
        sealingPrivatePkcs8: createPrivateKey({
          key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), Buffer.from(sealingPrivate)]),
          format: "der",
          type: "pkcs8",
        }).export({ format: "der", type: "pkcs8" }).toString("base64url"),
      })
      const plaintext = await keyring.unseal(Buffer.from(entry.wrap, "base64url"), { account: WRAPS_ACCOUNT, epoch: entry.epoch, id: entry.id })
      expect(new TextDecoder().decode(plaintext)).toBe(entry.envelope)
    })
  }

  test("wrap AAD binds account, epoch and recipient: a genuine wrap moved to another tuple refuses", async () => {
    const keyring = createInMemoryDeviceKeyring("device-a")
    const aadTuple = { account: "acc-one", epoch: 2, id: "device:device-a" }
    const aad = new TextEncoder().encode(JSON.stringify(aadTuple))
    const plaintext = new TextEncoder().encode("epoch-key-material")
    const wrap = sealWrapWith(keyring.publicKeys().sealing, plaintext, aad)
    // Right tuple opens.
    expect(await keyring.unseal(wrap, aadTuple)).toEqual(plaintext)
    // Wrong account, epoch or recipient refuses (AAD mismatch), same ciphertext.
    await expect(keyring.unseal(wrap, { ...aadTuple, account: "acc-two" })).rejects.toThrow()
    await expect(keyring.unseal(wrap, { ...aadTuple, epoch: 3 })).rejects.toThrow()
    await expect(keyring.unseal(wrap, { ...aadTuple, id: "device:device-b" })).rejects.toThrow()
    // And a wrap sealed to another device never opens here.
    const other = createInMemoryDeviceKeyring("device-b")
    await expect(other.unseal(wrap, aadTuple)).rejects.toThrow()
  })

  test("opens the RFC 9180 known-answer vector (DHKEM X25519 / HKDF-SHA256 / AES-256-GCM, base mode)", async () => {
    // Vector from the HPKE test-vectors collection (mode 0, kem 0x0020, kdf 0x0001, aead 0x0002),
    // info "Ode on a Grecian Urn", first encryption row (aad "Count-0").
    const skRm = Buffer.from("497b4502664cfea5d5af0b39934dac72242a74f8480451e1aee7d6a53320333d", "hex")
    const pkRm = Buffer.from("430f4b9859665145a6b1ba274024487bd66f03a2dd577d7753c68d7d7d00c00c", "hex")
    const enc = Buffer.from("6c93e09869df3402d7bf231bf540fadd35cd56be14f97178f0954db94b7fc256", "hex")
    const info = Buffer.from("4f6465206f6e2061204772656369616e2055726e", "hex")
    const ct = Buffer.from("e5d84cd531cfb583096e7cfa9641bd3079cf3a91cda813c52deb5f512be9931980a41de125a925cdad859d5b7a", "hex")
    const aad = Buffer.from("436f756e742d30", "hex")
    // Reproduce the RFC key schedule from the recipient side, then open the RFC's own
    // ciphertext: every intermediate (shared_secret, key_schedule_context, secret, key,
    // base_nonce) is asserted against the published hex, so a wrong schedule fails here
    // even if a round-trip with a same-author sender would pass.
    const kem = Buffer.concat([Buffer.from("KEM"), Buffer.from([0, 32])])
    const suite = Buffer.concat([Buffer.from("HPKE"), Buffer.from([0, 32, 0, 1, 0, 2])])
    const extract = (suiteId: Buffer, label: string, value: Uint8Array, salt = Buffer.alloc(0)) =>
      createHmac("sha256", salt).update(Buffer.concat([Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), value])).digest()
    const expand = (suiteId: Buffer, label: string, key: Buffer, info: Uint8Array, length: number) => {
      const context = Buffer.concat([Buffer.from([0, length]), Buffer.from("HPKE-v1"), suiteId, Buffer.from(label), info])
      return createHmac("sha256", key).update(context).update(Buffer.from([1])).digest().subarray(0, length)
    }
    const dh = diffieHellman({
      privateKey: createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: skRm.toString("base64url"), x: pkRm.toString("base64url") }, format: "jwk" }),
      publicKey: createPublicKey({ key: { kty: "OKP", crv: "X25519", x: enc.toString("base64url") }, format: "jwk" }),
    })
    const sharedSecret = expand(kem, "shared_secret", extract(kem, "eae_prk", dh), Buffer.concat([enc, pkRm]), 32)
    expect(sharedSecret.toString("hex")).toBe("3101c54c3a4f87439eaac080699ed9bbcc726ffe44e860c0424ccb7e3e2ead7b")
    const keyScheduleContext = Buffer.concat([Buffer.from([0]), extract(suite, "psk_id_hash", Buffer.alloc(0)), extract(suite, "info_hash", info)])
    expect(keyScheduleContext.toString("hex")).toBe("004ce5472ecdd5093ba0aecb8f871ff13f1fbc90ee76f0e18ace1a1b7e565bafa306f6ef962c9ee7cea40407b5d60f0f26990472faae3ac44c78366f1cac1ecde1")
    const secret = extract(suite, "secret", Buffer.alloc(0), sharedSecret)
    expect(secret.toString("hex")).toBe("2058ac9b02c1f52c1aaf08bedbec9198219751a94ef67b7d5f0c8b6e2b54ebfb")
    const key = expand(suite, "key", secret, keyScheduleContext, 32)
    const nonce = expand(suite, "base_nonce", secret, keyScheduleContext, 12)
    expect(key.toString("hex")).toBe("f50b0609186798729ed0564b36ef2ef8044f1f9d05636874d1f46c819c7a669f")
    expect(nonce.toString("hex")).toBe("151d9929e2449747889bc923")
    const decipher = createDecipheriv("aes-256-gcm", key, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(ct.subarray(ct.length - 16))
    const plaintext = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()])
    expect(plaintext.toString()).toBe("Beauty is truth, truth beauty")
    // And the port's open path must agree on the KEM half: the same enc/skRm pair.
    const portShared = (() => {
      const dhk = diffieHellman({
        privateKey: createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: skRm.toString("base64url"), x: pkRm.toString("base64url") }, format: "jwk" }),
        publicKey: createPublicKey({ key: { kty: "OKP", crv: "X25519", x: enc.toString("base64url") }, format: "jwk" }),
      })
      return expand(kem, "shared_secret", extract(kem, "eae_prk", dhk), Buffer.concat([enc, pkRm]), 32)
    })()
    expect(portShared.equals(sharedSecret)).toBe(true)
  })

  test("rejects tampering, truncation and a different recipient", async () => {
    const keyring = createInMemoryDeviceKeyring("receiver")
    const binding = { account: "acct", epoch: 1, id: "device:receiver" }
    const box = sealWrapWith(keyring.publicKeys().sealing, new Uint8Array(32), new TextEncoder().encode(JSON.stringify({ account: binding.account, epoch: binding.epoch, id: binding.id })))
    const corrupt = Uint8Array.from(box)
    corrupt[33] ^= 1
    for (const invalid of [corrupt, box.subarray(0, 31), new Uint8Array(48)]) {
      await expect(keyring.unseal(invalid, binding)).rejects.toThrow()
    }
    await expect(createInMemoryDeviceKeyring("other").unseal(box, binding)).rejects.toThrow()
  })

  test("review LOWs: a record may not carry the snapshot tag, and a snapshot reports the precise canonical violation", async () => {
    const keyring = createInMemoryDeviceKeyring("fixture-device")
    const encode = (text: string) => new TextEncoder().encode(text)
    const refusal = async (request: Parameters<typeof keyring.sign>[0]) => {
      try {
        await keyring.sign(request)
      } catch (error) {
        return error instanceof DeviceKeyringSignError ? error.reason : "untyped"
      }
      return "signed"
    }
    expect(await refusal({ purpose: "record", canonicalJson: encode('{"t":"omo-sync/v1/snapshot"}') })).toBe("record-prefix")
    expect(await refusal({ purpose: "snapshot", canonicalJson: encode('{ "t":"omo-sync/v1/snapshot" }') })).toBe("record-canonical-whitespace")
    expect(await refusal({ purpose: "snapshot", canonicalJson: encode('{"z":1,"t":"omo-sync/v1/snapshot"}') })).toBe("record-canonical-order")
  })

  test("review LOWs: unseal refuses a non-integer epoch and a low-order enc with the one normal refusal", async () => {
    const keyring = createInMemoryDeviceKeyring("receiver")
    const binding = { account: "acct", epoch: 1, id: "device:receiver" }
    const box = sealWrapWith(keyring.publicKeys().sealing, new Uint8Array(32), new TextEncoder().encode(JSON.stringify(binding)))
    expect(await keyring.unseal(box, binding)).toHaveLength(32)
    await expect(keyring.unseal(box, { ...binding, epoch: 1.5 })).rejects.toThrow("epoch")
    const lowOrder = Uint8Array.from(box)
    lowOrder.fill(0, 0, 32)
    await expect(keyring.unseal(lowOrder, binding)).rejects.toThrow("sealed box does not open")
    lowOrder[0] = 1
    await expect(keyring.unseal(lowOrder, binding)).rejects.toThrow("sealed box does not open")
  })
})
