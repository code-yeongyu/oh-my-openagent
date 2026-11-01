import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { join } from "node:path"
import pin from "../../src/strict-ed25519/PIN.json"
import corpus from "../../src/strict-ed25519/strict-ed25519-corpus.json"
import {
  checkSharedSecret,
  strictEd25519Key,
  strictEd25519Precheck,
  strictEd25519Verify,
  strictX25519Key,
} from "../../src/strict-ed25519/strict-ed25519.ts"
import { nativeEd25519Verify } from "./native-control.ts"

// The device service client verifies release signatures through a byte-identical copy of the repository's canonical
// strict Ed25519 helper. The copy never changes on its own: it must keep PIN.json's sha256 values and stay equal to
// the copy the sync client ships (packages/memory-core), and the shared corpus must pass on the runtime omo ships on.
const VENDORED = join(import.meta.dir, "../../src/strict-ed25519")
const CANONICAL = join(import.meta.dir, "../../../memory-core/src/sync/crypto/strict-ed25519")
const FILES = { "strict-ed25519.ts": pin.module, "strict-ed25519-corpus.json": pin.corpus } as const

const bytes = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(hex, "hex"))
const fileBytes = async (path: string): Promise<Uint8Array> => new Uint8Array(await Bun.file(path).arrayBuffer())
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex")

describe("vendored strict-ed25519 in the device service client", () => {
  test.each(Object.entries(FILES))("%s matches its pinned sha256 and the canonical copy byte for byte", async (name, expected) => {
    const vendored = await fileBytes(join(VENDORED, name))
    expect(sha256(vendored)).toBe(expected)
    expect(Buffer.compare(vendored, await fileBytes(join(CANONICAL, name)))).toBe(0)
  })

  test.each(corpus.ed25519)("Ed25519 $id $name", async (c) => {
    expect(strictEd25519Key(bytes(c.key))).toBe(c.keyValid)
    const verdict = await strictEd25519Verify(bytes(c.key), bytes(c.sig), bytes(c.msg))
    expect(verdict.ok ? "ok" : verdict.refusal).toBe(c.verdict)
    expect(strictEd25519Precheck(bytes(c.key), bytes(c.sig)).ok).toBe(c.verdict !== "malformed")
  })

  test("every case marked nativeBun is a forgery the runtime's own verifier accepts, so the precheck is what refuses it", async () => {
    const forgeries = corpus.ed25519.filter((c) => "nativeBun" in c && c.nativeBun === true)
    expect(forgeries.length).toBeGreaterThan(0)
    for (const c of forgeries) {
      expect(await nativeEd25519Verify(bytes(c.key), bytes(c.sig), bytes(c.msg))).toBe(true)
      expect(strictEd25519Precheck(bytes(c.key), bytes(c.sig)).ok).toBe(false)
    }
  })

  test.each(corpus.x25519.keys)("X25519 key $name", (c) => {
    expect(strictX25519Key(bytes(c.key))).toBe(c.valid)
  })

  test.each(corpus.x25519.sharedSecrets)("shared secret $name", (c) => {
    expect(checkSharedSecret(bytes(c.bytes))).toBe(c.valid)
  })
})
