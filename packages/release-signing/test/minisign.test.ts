import { describe, expect, test } from "bun:test"
import vectors from "./vectors/shared-vectors.json"
import { minisignKeyidOf, parseMinisignPublicKey, parseMinisignSignature, verifyMinisignEd } from "../src/minisign.ts"
import { buildMinisignPublicKeyFile, publicKeyOfSeed, signMinisignEd } from "../src/sign.ts"

// The shared vector file is the cross-surface agreement contract (keyring delta read items 2-3): every verifier
// surface must reach the same verdict per case. This is its TS owner; the shell and PowerShell legs run the same
// JSON in CI. Fixture keys are throwaway and never leave this file.
const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"))
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe("minisign ED parsing and verification (shared vectors)", () => {
  const pinned = vectors.verifier_key_sets.normal.map(bytes)

  test.each(vectors.cases)("$name -> $expect", async (c) => {
    const message = "message_override_utf8" in c && c.message_override_utf8 !== undefined ? utf8(c.message_override_utf8) : utf8(vectors.message_utf8)
    const verdict = await verifyMinisignEd(pinned, utf8(c.sig_file), message)
    expect(verdict.ok ? "ok" : `refuse:${verdict.refusal}`).toBe(c.expect)
  })

  test("a pinned key set holding a small-order A refuses as malformed before any math", async () => {
    const verdict = await verifyMinisignEd(vectors.verifier_key_sets.small_order_a.map(bytes), utf8(vectors.cases[0].sig_file), utf8(vectors.message_utf8))
    expect(verdict).toEqual({ ok: false, refusal: "malformed" })
  })

  test("an empty pinned key set refuses as malformed", async () => {
    const verdict = await verifyMinisignEd([], utf8(vectors.cases[0].sig_file), utf8(vectors.message_utf8))
    expect(verdict).toEqual({ ok: false, refusal: "malformed" })
  })
})

describe("minisign file grammar", () => {
  const goodSig = vectors.cases[0].sig_file

  test("parses a well-formed signature into keyid and 64-byte sig", () => {
    const parsed = parseMinisignSignature(goodSig)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.sig.length).toBe(64)
      expect(parsed.value.keyid.length).toBe(8)
      expect(Buffer.from(parsed.value.keyid).equals(Buffer.from(minisignKeyidOf(bytes(vectors.pinned_public_keys_hex[0]))))).toBe(true)
    }
  })

  test("refuses CRLF line endings", () => {
    expect(parseMinisignSignature(goodSig.replace(/\n/g, "\r\n")).ok).toBe(false)
  })

  test("refuses a missing trailing newline", () => {
    expect(parseMinisignSignature(goodSig.slice(0, -1)).ok).toBe(false)
  })

  test("refuses a swapped comment prefix on line 3", () => {
    const lines = goodSig.split("\n")
    lines[2] = lines[2].replace("trusted comment:", "untrusted comment:")
    expect(parseMinisignSignature(lines.join("\n")).ok).toBe(false)
  })

  test("parses a public key file and pins its keyid derivation", () => {
    const parsed = parseMinisignPublicKey(buildMinisignPublicKeyFile(bytes(vectors.primary_seed_hex)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(Buffer.from(parsed.value.pk).equals(Buffer.from(bytes(vectors.pinned_public_keys_hex[0])))).toBe(true)
      expect(Buffer.from(parsed.value.keyid).equals(Buffer.from(minisignKeyidOf(parsed.value.pk)))).toBe(true)
    }
  })
})

describe("signer produces stock-minisign-verifiable output", () => {
  test("the signer's output verifies through the package verifier (round trip)", async () => {
    const message = utf8(vectors.message_utf8)
    const sigFile = signMinisignEd(bytes(vectors.primary_seed_hex), message, "omo round trip")
    const verdict = await verifyMinisignEd(vectors.pinned_public_keys_hex.map(bytes), sigFile, message)
    expect(verdict).toEqual({ ok: true })
  })

  test("refuses to sign with a seed whose key is outside the pinned set", () => {
    const stranger = Buffer.alloc(32, 9)
    expect(() => signMinisignEd(stranger, utf8("x"), "t", vectors.pinned_public_keys_hex.map(bytes))).toThrow("not in the pinned release key set")
    expect(publicKeyOfSeed(stranger).length).toBe(32)
  })
})
