// Reads what a darwin release artifact carries: rcodesign's signature report per Mach-O slice, and the operator
// build's source stamp section. Pure parsing; operator-darwin-verify.ts decides what is acceptable.
export type Slice = {
  readonly identifier: string
  readonly team: string
  readonly runtime: boolean
  readonly cdSha256: string
  readonly leafTeam: string | null
  readonly leafProfile: string | null
  readonly chainsToApple: boolean
  readonly signerDigest: string | null
}

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

/** Every embedded signature in rcodesign's report (one per Mach-O slice). */
export function parseSlices(report: string): Slice[] {
  const slices: Slice[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    const object = record(node)
    if ("code_directory" in object && "blobs" in object) {
      const cd = record(object.code_directory)
      const blobs = Array.isArray(object.blobs) ? object.blobs.map(record) : []
      const cdBlob = blobs.find((blob) => String(blob.slot ?? "").startsWith("CodeDirectory ("))
      const cms = record(object.cms)
      const certificates = Array.isArray(cms.certificates) ? cms.certificates.map(record) : []
      const leaf = certificates.find((certificate) => certificate.apple_certificate_profile !== undefined)
      const signer = Array.isArray(cms.signers) ? record(cms.signers[0]) : {}
      slices.push({
        identifier: String(cd.identifier ?? ""),
        team: String(cd.team_name ?? ""),
        runtime: /\bRUNTIME\b/.test(String(cd.flags ?? "")),
        cdSha256: String(cdBlob?.sha256 ?? ""),
        leafTeam: leaf ? String(leaf.apple_team_id ?? "") : null,
        leafProfile: leaf ? String(leaf.apple_certificate_profile ?? "") : null,
        chainsToApple: leaf?.chains_to_apple_root_ca === true,
        signerDigest: signer.message_digest === undefined ? null : String(signer.message_digest),
      })
      return
    }
    Object.values(object).forEach(walk)
  }
  walk(Bun.YAML.parse(report))
  return slices
}

/** The `__OMO_META,__build` section of a thin 64-bit little-endian Mach-O, or null. */
export function readBuildMeta(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 32 || view.getUint32(0, true) !== 0xfeedfacf) return null
  const name = (offset: number) => new TextDecoder().decode(bytes.subarray(offset, offset + 16)).replace(/\0.*$/s, "")
  let command = 32
  for (let index = 0, count = view.getUint32(16, true); index < count; index++) {
    if (command + 8 > bytes.byteLength) return null
    const size = view.getUint32(command + 4, true)
    if (view.getUint32(command, true) === 0x19 && name(command + 8) === "__OMO_META") {
      for (let section = 0, sections = view.getUint32(command + 64, true); section < sections; section++) {
        const at = command + 72 + section * 80
        if (name(at) !== "__build" || name(at + 16) !== "__OMO_META") continue
        const length = Number(view.getBigUint64(at + 40, true))
        const offset = view.getUint32(at + 48, true)
        if (offset + length > bytes.byteLength) return null
        return new TextDecoder().decode(bytes.subarray(offset, offset + length))
      }
    }
    if (size === 0) return null
    command += size
  }
  return null
}

