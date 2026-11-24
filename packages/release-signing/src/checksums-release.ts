// #14916, H2 (keyring read): the signed object is the release checksum list with a FROZEN header line that names
// the version and channel, so a mirror cannot replay an older signed release as a newer one. The first token is the
// domain tag (M3): every verifier requires its own kind, and any future grammar change ships as `omo-release-v2`.
// The grammar: line 1 `# omo-release-v1 version=<X.Y.Z[-pre]> channel=<stable|beta>`, then one line per asset
// `<64 lowercase hex><two spaces><asset name>`, LF-only, a trailing LF, no duplicate names, no unexpected names.
export const RELEASE_HEADER_PREFIX = "# omo-release-v1"
const HEADER_RE = /^# omo-release-v1 version=(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?) channel=(stable|beta)$/
export const RELEASE_CHANNELS = ["stable", "beta"] as const
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]
const ASSET_LINE_RE = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/
export const CHECKSUMS_MAX_BYTES = 65_536

export type ChecksumsRefusal =
  | "not_utf8"
  | "too_large"
  | "bad_terminator"
  | "bad_header"
  | "bad_asset_line"
  | "duplicate_name"
  | "empty"
export type ChecksumsParseVerdict =
  | { readonly ok: true; version: string; channel: ReleaseChannel; readonly entries: ReadonlyMap<string, string> }
  | { readonly ok: false; refusal: ChecksumsRefusal; reason: string }

export const parseChecksumsRelease = (bytes: Uint8Array): ChecksumsParseVerdict => {
  if (bytes.length === 0) return { ok: false, refusal: "empty", reason: "checksums file is empty" }
  if (bytes.length > CHECKSUMS_MAX_BYTES) return { ok: false, refusal: "too_large", reason: "checksums file exceeds the size cap" }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, refusal: "not_utf8", reason: "checksums file is not valid UTF-8" }
  }
  if (text.includes("\r")) return { ok: false, refusal: "bad_terminator", reason: "checksums must use LF line endings only" }
  if (!text.endsWith("\n")) return { ok: false, refusal: "bad_terminator", reason: "checksums must end with a trailing LF" }
  const lines = text.slice(0, -1).split("\n")
  const header = HEADER_RE.exec(lines[0] ?? "")
  if (header === null)
    return { ok: false, refusal: "bad_header", reason: "line 1 must be '# omo-release-v1 version=<semver> channel=<stable|beta>'" }
  const entries = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const match = ASSET_LINE_RE.exec(line)
    if (match === null) return { ok: false, refusal: "bad_asset_line", reason: `asset line is not '<sha256>  <name>': ${line.slice(0, 80)}` }
    if (entries.has(match[2])) return { ok: false, refusal: "duplicate_name", reason: `duplicate entry for ${match[2]}` }
    entries.set(match[2], match[1])
  }
  if (entries.size === 0) return { ok: false, refusal: "empty", reason: "checksums file lists no assets" }
  return { ok: true, version: header[1], channel: header[2] as ReleaseChannel, entries }
}

export const buildChecksumsRelease = (version: string, channel: ReleaseChannel, entries: readonly (readonly [name: string, sha256: string])[]): Uint8Array => {
  const assetLines = entries.map(([name, sha256]) => `${sha256}  ${name}`)
  for (const line of assetLines) {
    if (ASSET_LINE_RE.exec(line) === null) throw new Error(`cannot emit malformed asset line: ${line.slice(0, 80)}`)
  }
  return new TextEncoder().encode(`${RELEASE_HEADER_PREFIX} version=${version} channel=${channel}\n${assetLines.join("\n")}\n`)
}

const prereleaseOf = (version: string): readonly string[] | undefined => {
  const at = version.indexOf("-")
  return at === -1 ? undefined : version.slice(at + 1).split(".")
}

const numeric = (part: string | undefined): number => Number.parseInt(part ?? "0", 10)

/** Semver ordering per the release grammar: numeric on major/minor/patch, a release outranks its prereleases. */
export const compareReleaseVersion = (left: string, right: string): number => {
  const l = /^(\d+)\.(\d+)\.(\d+)/.exec(left)
  const r = /^(\d+)\.(\d+)\.(\d+)/.exec(right)
  if (l === null || r === null) throw new Error(`not a release version: ${l === null ? left : right}`)
  for (const i of [1, 2, 3] as const) {
    const cmp = numeric(l[i]) - numeric(r[i])
    if (cmp !== 0) return cmp
  }
  const lp = prereleaseOf(left)
  const rp = prereleaseOf(right)
  if (lp === undefined && rp === undefined) return 0
  if (lp === undefined) return 1
  if (rp === undefined) return -1
  for (let i = 0; i < Math.max(lp.length, rp.length); i += 1) {
    const a = lp[i]
    const b = rp[i]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const an = Number.parseInt(a, 10)
    const bn = Number.parseInt(b, 10)
    if (Number.isNaN(an) || Number.isNaN(bn)) {
      const cmp = a < b ? -1 : a > b ? 1 : 0
      if (cmp !== 0) return cmp
    } else {
      const cmp = an - bn
      if (cmp !== 0) return cmp
    }
  }
  return 0
}
