import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync } from "node:crypto"
import { keyringFor } from "../testing/sync-v1.test-support.ts"
import pin from "./PIN.json"
import corpus from "./strict-ed25519-corpus.json"
import { strictEd25519VerifyReference } from "../testing/strict-ed25519-oracle.test-support.ts"
import { checkSharedSecret, strictEd25519Key, strictEd25519Precheck, strictEd25519Verify, strictX25519Key } from "./strict-ed25519.ts"

// Vendored copy of the shared strict-ed25519 helper and corpus (#10742), taken byte-identical from
// the relay-proto package that owns them. Any rule change happens there; this copy must keep the
// source's sha256 and runs the corpus on Bun, the runtime the sync client ships on.
const SOURCE_SHA256 = { "strict-ed25519.ts": pin.module, "strict-ed25519-corpus.json": pin.corpus, "../testing/strict-ed25519-oracle.test-support.ts": pin.oracle } as const

const bytes = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(hex, "hex"))
const sha256 = async (name: string): Promise<string> =>
  createHash("sha256").update(new Uint8Array(await Bun.file(`${import.meta.dir}/${name}`).arrayBuffer())).digest("hex")
const nativeVerify = async (key: string, sig: string, msg: string): Promise<boolean> => {
  const imported = await crypto.subtle.importKey("raw", bytes(key), { name: "Ed25519" }, false, ["verify"])
  return crypto.subtle.verify({ name: "Ed25519" }, imported, bytes(sig), bytes(msg))
}

describe("vendored strict-ed25519", () => {
  test.each(Object.entries(SOURCE_SHA256))("%s is byte-identical to the source", async (name, expected) => {
    expect(await sha256(name)).toBe(expected)
  })

  test.each(corpus.ed25519)("Ed25519 $id $name", async (c) => {
    expect(strictEd25519Key(bytes(c.key))).toBe(c.keyValid)
    const verdict = await strictEd25519Verify(bytes(c.key), bytes(c.sig), bytes(c.msg))
    expect(verdict.ok ? "ok" : verdict.refusal).toBe(c.verdict)
    const reference = await strictEd25519VerifyReference(bytes(c.key), bytes(c.sig), bytes(c.msg))
    expect(reference.ok ? "ok" : reference.refusal).toBe(c.verdict)
    expect(strictEd25519Precheck(bytes(c.key), bytes(c.sig)).ok).toBe(c.verdict !== "malformed")
  })

  test("every case marked nativeBun is a forgery Bun's own verifier accepts, so the precheck is what refuses it", async () => {
    const forgeries = corpus.ed25519.filter((c) => "nativeBun" in c && c.nativeBun === true)
    expect(forgeries.length).toBeGreaterThan(0)
    for (const c of forgeries) {
      expect(await nativeVerify(c.key, c.sig, c.msg)).toBe(true)
      expect(strictEd25519Precheck(bytes(c.key), bytes(c.sig)).ok).toBe(false)
    }
  })

  test.each(corpus.x25519.keys)("X25519 key $name", (c) => {
    expect(strictX25519Key(bytes(c.key))).toBe(c.valid)
  })

  test.each(corpus.x25519.sharedSecrets)("shared secret $name", (c) => {
    expect(checkSharedSecret(bytes(c.bytes))).toBe(c.valid)
  })

  test("the sync fixture's keys and freshly generated keys stay valid", () => {
    for (const device of ["owner", "recovered"] as const) {
      expect(strictEd25519Key(new Uint8Array(Buffer.from(keyringFor(device).publicKeys().signing, "base64url")))).toBe(true)
    }
    for (let i = 0; i < 20; i++) {
      const x = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x ?? ""
      expect(strictEd25519Key(new Uint8Array(Buffer.from(x, "base64url")))).toBe(true)
    }
  })
})
