import { describe, expect, test } from "bun:test"
import { gunzipSync, gzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// #14916: install.ps1's release-signature contract, checkable without PowerShell on this host. The embedded
// verifier payload must decompress to the vendored MinisignEd25519.cs byte for byte (drift), the script must
// carry the empty generated constants while signing is inactive, and the H1/H2 flow calls must exist in the
// install path. Runtime execution (Add-Type + the shared vectors) is proven on the CI [pwsh, powershell] matrix.
const script = readFileSync(join(import.meta.dir, "..", "scripts", "install.ps1"), "utf8")
const cs = readFileSync(join(import.meta.dir, "..", "scripts", "MinisignEd25519.cs"))
const BEGIN = "# >>> omo release-signature verifier payload (#14916) >>>"
const END = "# <<< omo release-signature verifier payload (#14916) <<<"

const payloadBlock = script.slice(script.indexOf(BEGIN) + BEGIN.length, script.indexOf(END))
const payloadB64 = payloadBlock
  .split("\n")
  .filter((line) => line !== "$OmoVerifierPayload = @'" && line !== "'@" && line.trim().length > 0)
  .join("")

describe("install.ps1 release-signature embedding (#14916)", () => {
  test("the here-string payload gunzips to exactly the vendored MinisignEd25519.cs", () => {
    expect(gunzipSync(Buffer.from(payloadB64, "base64")).equals(cs)).toBe(true)
  })

  test("re-gzipping the source reproduces the same payload (deterministic embed)", () => {
    expect(gzipSync(cs, { level: 9 }).toString("base64")).toBe(payloadB64)
  })

  test("the vendored C# keeps its upstream provenance header and the single public type", () => {
    const csText = cs.toString("utf8")
    expect(csText).toContain("Chaos.NaCl")
    expect(csText).toContain("public static class MinisignEd")
    expect(csText).toContain("public static bool Verify(byte[] publicKey32, byte[] signature64, byte[] message)")
    expect(csText).toContain("public static byte[] Blake2b512(byte[] data)")
  })

  test("the generated constants ship inactive and the verification flow is wired", () => {
    expect(script).toContain("$script:OmoReleaseKeys = @()")
    expect(script).toContain("$script:OmoReleaseVSign = ''")
    expect(script).toContain("Test-OmoReleaseSignature $sums $sig $version ($channel -eq 'pinned')")
    expect(script).toContain("Test-OmoSignedHeader $sums $version $want")
    expect(script).toContain("release signature missing (SHA256SUMS.sig); refusing to install")
    expect(script).toContain("signed release version mismatch")
    expect(script).toContain("only ED is accepted")
  })
})
