// Builds an operator-darwin staging directory for the verifier tests: synthetic thin Mach-O engines carrying a
// real __OMO_META,__build section, omo binaries that embed their engine and trust helper, .sha256 files, a
// manifest, and rcodesign reports shaped like rcodesign 0.29's print-signature-info output.
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ARTIFACTS, MANIFEST, TEAM_ID } from "../../.github/workflows/operator-darwin-verify.ts"

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

export type SignatureFields = {
  readonly identifier: string
  readonly team: string
  readonly flags: string
  readonly cdSha256: string
  readonly leafTeam: string
  readonly leafProfile: string
  readonly chains: boolean
  readonly signerDigest: string
}

export function signatureReport(file: string, fields: SignatureFields): string {
  return [
    `- path: ${file}`,
    "  entity:",
    "    mach_o:",
    "      signature:",
    "        blobs:",
    "        - slot: CodeDirectory (0)",
    `          sha256: ${fields.cdSha256}`,
    "        code_directory:",
    `          flags: CodeSignatureFlags(${fields.flags})`,
    `          identifier: ${fields.identifier}`,
    `          team_name: ${fields.team}`,
    "        cms:",
    "          certificates:",
    "          - subject: CN=Developer ID Certification Authority, OU=G2, O=Apple Inc., C=US",
    "            chains_to_apple_root_ca: true",
    "            apple_team_id: G2",
    `          - subject: 'CN=Developer ID Application: Fixture (${fields.leafTeam}), OU=${fields.leafTeam}'`,
    `            chains_to_apple_root_ca: ${fields.chains}`,
    `            apple_certificate_profile: ${fields.leafProfile}`,
    `            apple_team_id: ${fields.leafTeam}`,
    "          signers:",
    `          - message_digest: ${fields.signerDigest}`,
    "",
  ].join("\n")
}

export type Fixture = {
  readonly dir: string
  readonly files: Map<string, Uint8Array>
  /** The signature each artifact carries; tests replace one entry to forge a single defect. */
  readonly signatures: Map<string, SignatureFields>
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
    files.set(`omo-${platform}`, new Uint8Array([...text(`omo-${platform}:`), ...engine, ...helper]))
  }
  return files
}

/** Writes the staging dir for `files`; `manifest` overrides top-level manifest fields. */
export function writeFixture(files = buildFiles(), manifest: Record<string, unknown> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "operator-darwin-"))
  const sha256: Record<string, string> = {}
  const signatures = new Map<string, SignatureFields>()
  for (const [name, bytes] of files) {
    const digest = createHash("sha256").update(bytes).digest("hex")
    sha256[name] = digest
    writeFileSync(join(dir, name), bytes)
    writeFileSync(join(dir, `${name}.sha256`), `${digest}  ${name}\n`)
    const cd = createHash("sha256").update(`cd:${name}`).digest("hex")
    signatures.set(name, {
      identifier: ARTIFACTS[name]?.identifier ?? "",
      team: TEAM_ID,
      flags: "RUNTIME",
      cdSha256: cd,
      leafTeam: TEAM_ID,
      leafProfile: "developer-id-application",
      chains: true,
      signerDigest: cd,
    })
  }
  writeFileSync(
    join(dir, MANIFEST),
    JSON.stringify({ schema: "omo-darwin-operator-manifest/1", source_sha: SOURCE_SHA, version: VERSION, operator: "fixture-operator", sha256, ...manifest }),
  )
  return { dir, files, signatures }
}
