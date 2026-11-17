// Builds an operator-darwin staging directory for the verifier tests: synthetic thin Mach-O engines carrying a
// real __OMO_META,__build section, omo binaries that embed their engine and trust helper, .sha256 files, a
// manifest, and the per-slice signature facts the real inspector would report for a valid signature.
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ARTIFACTS, MANIFEST, type SliceFacts, TEAM_ID } from "../../.github/workflows/operator-darwin-verify.ts"

export const SOURCE_SHA = "1111111111111111111111111111111111111111"
export const PREPARED_SHA = "2222222222222222222222222222222222222222"
export const VERSION = "5.1.73"
export const TAG = `operator-darwin-${SOURCE_SHA.slice(0, 12)}`

/** A thin 64-bit little-endian Mach-O with one LC_SEGMENT_64 `__OMO_META` holding section `__build`. */
export function machoWithMeta(meta: string, body: string): Uint8Array {
  const payload = new TextEncoder().encode(meta)
  const filler = new TextEncoder().encode(body)
  const commandSize = 72 + 80
  const dataOffset = 32 + commandSize
  const bytes = new Uint8Array(dataOffset + payload.length + filler.length)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset)
  view.setUint32(0, 0xfeedfacf, true)
  view.setUint32(16, 1, true)
  view.setUint32(20, commandSize, true)
  view.setUint32(32, 0x19, true)
  view.setUint32(36, commandSize, true)
  ascii(40, "__OMO_META")
  view.setUint32(32 + 64, 1, true)
  const section = 32 + 72
  ascii(section, "__build")
  ascii(section + 16, "__OMO_META")
  view.setBigUint64(section + 40, BigInt(payload.length), true)
  view.setUint32(section + 48, dataOffset, true)
  bytes.set(payload, dataOffset)
  bytes.set(filler, dataOffset + payload.length)
  return bytes
}

export type Fixture = {
  readonly dir: string
  /** sha256 of the written manifest: what the maintainer pins at dispatch. */
  readonly manifestSha256: string
  readonly files: Map<string, Uint8Array>
  /** The verified signature facts of each artifact; tests replace one entry to forge a single defect. */
  readonly signatures: Map<string, SliceFacts[]>
}

export function engineMeta(host: string, rustTarget: string, overrides: Record<string, string> = {}): string {
  return JSON.stringify({ schema: "omo-darwin-operator-build/1", source_sha: SOURCE_SHA, rust_target: rustTarget, host, version: VERSION, ...overrides })
}

export function buildFiles(): Map<string, Uint8Array> {
  const text = (value: string) => new TextEncoder().encode(value)
  const files = new Map<string, Uint8Array>()
  files.set("senpi-desktop-engine-darwin-arm64", machoWithMeta(engineMeta("darwin-arm64", "aarch64-apple-darwin"), "engine-arm64"))
  files.set("senpi-desktop-engine-darwin-x64", machoWithMeta(engineMeta("darwin-x64", "x86_64-apple-darwin"), "engine-x64"))
  files.set("omo-engine-trust-helper-darwin-arm64", text("trust-helper-arm64"))
  files.set("omo-engine-trust-helper-darwin-x64", text("trust-helper-x64"))
  files.set("omo-keychain-darwin-universal", text("keychain-helper-universal"))
  for (const platform of ["darwin-arm64", "darwin-x64", "darwin-x64-baseline"]) {
    const host = platform === "darwin-arm64" ? "darwin-arm64" : "darwin-x64"
    const engine = files.get(`senpi-desktop-engine-${host}`) ?? new Uint8Array()
    const helper = files.get(`omo-engine-trust-helper-${host}`) ?? new Uint8Array()
    const keychain = files.get("omo-keychain-darwin-universal") ?? new Uint8Array()
    files.set(`omo-${platform}`, new Uint8Array([...text(`omo-${platform}:`), ...engine, ...helper, ...keychain]))
  }
  return files
}

/** Writes the staging dir for `files`; `manifest` overrides top-level manifest fields. */
export function writeFixture(files = buildFiles(), manifest: Record<string, unknown> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "operator-darwin-"))
  const sha256: Record<string, string> = {}
  const signatures = new Map<string, SliceFacts[]>()
  for (const [name, bytes] of files) {
    const digest = createHash("sha256").update(bytes).digest("hex")
    sha256[name] = digest
    writeFileSync(join(dir, name), bytes)
    writeFileSync(join(dir, `${name}.sha256`), `${digest}  ${name}\n`)
    const keychain = ARTIFACTS[name]?.keychain
    const slice = ([cpuType, cpuSubtype]: readonly [number, number]): SliceFacts => ({
      identifier: ARTIFACTS[name]?.identifier ?? "",
      team: TEAM_ID,
      signerTeam: TEAM_ID,
      runtime: true,
      cpuType,
      cpuSubtype,
      requirementsSha256: keychain?.requirementsSha256 ?? createHash("sha256").update(`requirements:${name}`).digest("hex"),
      entitlements: false,
      cdhash: createHash("sha256").update(`cd:${name}:${cpuType}`).digest("hex").slice(0, 40),
      start: 0,
      hashedEnd: bytes.byteLength,
    })
    signatures.set(name, keychain ? keychain.architectures.map(slice) : [slice(name.includes("arm64") ? [0x0100000c, 0] : [0x01000007, 3])])
  }
  const manifestText = JSON.stringify({ schema: "omo-darwin-operator-manifest/1", source_sha: SOURCE_SHA, version: VERSION, operator: "fixture-operator", sha256, ...manifest })
  writeFileSync(join(dir, MANIFEST), manifestText)
  return { dir, manifestSha256: createHash("sha256").update(manifestText).digest("hex"), files, signatures }
}
