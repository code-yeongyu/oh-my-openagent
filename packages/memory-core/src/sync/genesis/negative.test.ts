import { describe, expect, mock, test } from "bun:test"
import { recordPayload, taggedHash, verifyRecordSig } from "../crypto/signatures.ts"
import { b64urlDecode, b64urlEncode, jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import { signFramed } from "../crypto/vendor/sync-format/keys.ts"
import { signedAppend } from "../recovery/keyring-append.ts"
import { buildGenesis } from "./build.ts"
import { bytes } from "./seal.test-support.ts"
import { ACCOUNT, deviceKeyring, EMPTY_HEAD, entryOf, vector, walk } from "./vector.test-support.ts"

describe("isolated genesis rejection vectors", () => {
  test("rejects a different creator anchor after accepting the valid signature", async () => {
    const v = await vector()
    const entry = await entryOf(v.built.request, v.keyring)
    expect(await verifyRecordSig(v.keyring.publicKeys().signing, entry)).toBe(true)
    const result = await walk(v.built.request, v.keyring, await deviceKeyring(41))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("anchor_mismatch")
  })

  test.each([
    ["reversed wraps", "noncanonical_order"],
    ["missing recovery", "bad_wrap_set"],
    ["single-wrap digest", "wraps_digest_mismatch"],
    ["wrong countersign domain", "bad_countersign"],
    ["tampered recovery ciphertext", "bad_countersign"],
  ] as const)("rejects %s for its own rule after recomputing unrelated signatures", async (mutation, expected) => {
    const v = await vector()
    const [device, recovery] = v.prepared.wraps
    const ciphertext = b64urlDecode(recovery.wrap)
    ciphertext[ciphertext.length - 1] = (ciphertext.at(-1) ?? 0) ^ 1
    const wraps = mutation === "reversed wraps" ? [recovery, device]
      : mutation === "missing recovery" ? [device]
      : mutation === "tampered recovery ciphertext" ? [device, { ...recovery, wrap: b64urlEncode(ciphertext) }]
      : [device, recovery]
    const digest = await sha256B64(jcsBytes(mutation === "single-wrap digest" ? [device] : wraps))
    const payload = {
      t: "omo-sync/v1/recovery-countersign", account: ACCOUNT,
      custody_root: v.prepared.body.custody_root, predecessor: "", wraps_digest: digest,
    }
    // Tampering models an attacker with the device key, not the recovery signing key.
    const countersign = mutation === "tampered recovery ciphertext" ? v.prepared.body.countersign
      : await signFramed(mutation === "wrong countersign domain" ? "omo-sync/v1/record" : payload.t, payload, v.recovery.signSeed)
    const body = { ...v.prepared.body, wraps_digest: digest, countersign }
    const request = await signedAppend(v.keyring, EMPTY_HEAD, body, wraps)
    const entry = await entryOf(request, v.keyring)
    expect(await verifyRecordSig(v.keyring.publicKeys().signing, entry)).toBe(true)
    const result = await walk(request, v.keyring)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe(expected)
  })

  test("refuses prepared ciphertext tampering before invoking the device signer", async () => {
    const v = await vector()
    const [device, recovery] = v.prepared.wraps
    const changed = { ...recovery, wrap: device.wrap }
    const wraps = [device, changed] as const
    const prepared = { body: { ...v.prepared.body, wraps_digest: await sha256B64(jcsBytes(wraps)) }, wraps }
    let signed = false
    const keyring = { ...v.keyring, sign: async () => { signed = true; throw new Error("must not sign") } }
    await expect(buildGenesis(ACCOUNT, keyring, prepared)).rejects.toMatchObject({ reason: "bad_countersign" })
    expect(signed).toBe(false)
  })

  test("refuses a prepared wraps digest that disagrees with its wraps, though countersigned, before device signing", async () => {
    const v = await vector()
    const [device] = v.prepared.wraps
    const wraps_digest = await sha256B64(jcsBytes([device]))
    const countersign = await v.capabilities.countersign({
      t: "omo-sync/v1/recovery-countersign", account: ACCOUNT, custody_root: v.prepared.body.custody_root,
      predecessor: "", wraps_digest,
    })
    const prepared = { ...v.prepared, body: { ...v.prepared.body, wraps_digest, countersign } }
    const sign = mock(v.keyring.sign)
    await expect(buildGenesis(ACCOUNT, { ...v.keyring, sign }, prepared)).rejects.toMatchObject({ reason: "wraps_digest_mismatch" })
    expect(sign).toHaveBeenCalledTimes(0)
  })

  test("rejects a device signature under the recovery domain with correct record fields", async () => {
    const v = await vector()
    const entry = await entryOf(v.built.request, v.keyring)
    const request = {
      ...v.built.request,
      record_sig: await signFramed("omo-sync/v1/recovery-countersign", recordPayload(entry), bytes(32, 1)),
    }
    const result = await walk(request, v.keyring)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("bad_signature")
  })

  test.each([
    ["account", "account_mismatch"],
    ["sealing key", "principal_mismatch"],
    ["signing key", "principal_mismatch"],
    ["device id", "principal_mismatch"],
    ["nonce length", "bad_bootstrap"],
    ["extra bootstrap", "bad_record"],
    ["extra recovery", "bad_record"],
    ["non-NFC RP", "bad_bootstrap"],
  ] as const)(
    "refuses prepared %s mismatch before device signing",
    async (mutation, reason) => {
      const v = await vector()
      const bootstrap = v.prepared.body.bootstrap
      const first = bootstrap.first_device
      const recovery = bootstrap.recovery_key
      const changed = {
        ...bootstrap,
        ...(mutation === "account" ? { account: "another-account" } : {}),
        ...(mutation === "nonce length" ? { custody_nonce: b64urlEncode(bytes(32, 5)) } : {}),
        ...(mutation === "extra bootstrap" ? { extra: true } : {}),
        first_device: {
          ...first,
          ...(mutation === "device id" ? { id: b64urlEncode(bytes(16, 99)) } : {}),
          ...(mutation === "sealing key" ? { sealing_public_key: recovery.sealing_public_key } : {}),
          ...(mutation === "signing key" ? { signing_public_key: recovery.signing_public_key } : {}),
        },
        recovery_key: {
          ...recovery,
          ...(mutation === "extra recovery" ? { extra: true } : {}),
          ...(mutation === "non-NFC RP" ? { rp_id: "e\u0301.test" } : {}),
        },
      }
      const custody_root = await taggedHash("omo-sync/v1/custody-root", changed)
      const countersign = await v.capabilities.countersign({
        t: "omo-sync/v1/recovery-countersign", account: ACCOUNT, custody_root,
        predecessor: "", wraps_digest: v.prepared.body.wraps_digest,
      })
      const prepared = {
        ...v.prepared,
        body: { ...v.prepared.body, bootstrap: changed, custody_root, countersign },
      }
      const sign = mock(v.keyring.sign)
      await expect(buildGenesis(ACCOUNT, { ...v.keyring, sign }, prepared)).rejects.toMatchObject({ reason })
      expect(sign).toHaveBeenCalledTimes(0)
    },
  )
})
