/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readSignatures } from "../.github/workflows/operator-darwin-macho.ts"
import { machoSigned } from "./fixtures/operator-darwin-signing"

/**
 * Release security contract (#13921): the verifier recomputes every code page and special-slot hash of each slice
 * itself, so no byte before the signature and no requirements/entitlements blob can change after signing, and it
 * computes the cdhash it asks Apple's ticket service about from the CodeDirectory it just checked.
 */

const code = new Uint8Array(9000).map((_, index) => index % 251)
const refusal = (bytes: Uint8Array) => {
  try {
    readSignatures(bytes)
    return "ACCEPTED"
  } catch (error) {
    return `REFUSED: ${(error as Error).message}`
  }
}

describe("operator darwin Mach-O signature layout", () => {
  test("reads identifier, team, hardened runtime, hashed range and the self-computed cdhash", () => {
    const { file, codeDirectory } = machoSigned({ code, cms: new Uint8Array([0x30, 0x00]) })
    const [slice] = readSignatures(file)
    expect(slice).toMatchObject({
      identifier: "ai.sisyphuslabs.fixture",
      team: "523JNR86LZ",
      runtime: true,
      start: 0,
      hashedEnd: 48 + code.byteLength,
      cdhash: createHash("sha256").update(codeDirectory).digest("hex").slice(0, 40),
    })
    expect(slice?.cms).toEqual(new Uint8Array([0x30, 0x00]))
  })

  test("#13964 LOW-2: reads the cpu subtype without its capability bits, so arm64e is told apart from arm64", () => {
    const subtype = (cpu: readonly [number, number]) => readSignatures(machoSigned({ code, cpu }).file)[0]?.cpuSubtype
    expect(subtype([0x0100000c, 0])).toBe(0)
    expect(subtype([0x0100000c, 0x80000002])).toBe(2)
    expect(subtype([0x01000007, 3])).toBe(3)
  })

  test("an ad-hoc slice (empty CMS blob) carries no CMS for the signer check to accept", () => {
    expect(readSignatures(machoSigned({ code }).file)[0]?.cms).toBeNull()
  })

  test("refuses a changed code byte", () => {
    const { file } = machoSigned({ code })
    file[5000] = (file[5000] ?? 0) ^ 1
    expect(refusal(file)).toBe("REFUSED: code page 1 does not match its hash")
  })

  test("refuses a changed requirements blob", () => {
    const { file } = machoSigned({ code })
    const requirements = Buffer.from(file).indexOf(Buffer.from([0xfa, 0xde, 0x0c, 0x01]))
    file[requirements + 9] = 1
    expect(refusal(file)).toBe("REFUSED: special slot 2 (requirements) does not match")
  })

  test("refuses an entitlements blob the CodeDirectory does not hash", () => {
    const entitlements = new Uint8Array([0xfa, 0xde, 0x71, 0x71, 0, 0, 0, 12, 1, 2, 3, 4])
    expect(refusal(machoSigned({ code, extraBlobs: [[5, entitlements]] }).file)).toBe(
      "REFUSED: special slot 5 (entitlements) does not match",
    )
  })

  test("refuses an alternate CodeDirectory", () => {
    expect(
      refusal(machoSigned({ code, extraBlobs: [[0x1000, new Uint8Array([0xfa, 0xde, 0x0c, 0x02, 0, 0, 0, 8])]] }).file),
    ).toBe("REFUSED: unsupported signature blob type 0x1000 (alternate CodeDirectories are refused)")
  })

  test("refuses a file with no code signature", () => {
    const { file } = machoSigned({ code })
    new DataView(file.buffer).setUint32(32, 0x19, true)
    expect(refusal(file)).toBe("REFUSED: no code signature")
  })

  test("refuses a 32-bit or foreign file", () => {
    expect(refusal(new Uint8Array(64))).toBe("REFUSED: not a 64-bit Mach-O file")
  })
})
