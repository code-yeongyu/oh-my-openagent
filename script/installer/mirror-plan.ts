export const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/
export const KEEP_BETAS = 20
const MIRRORED_ASSET = /^(?:omo-(?:darwin|linux|windows)-[a-z0-9-]+(?:\.exe)?|SHA256SUMS|senpi-desktop-engine-[A-Za-z0-9._-]+)$/
const BINARY = /^omo-(?:darwin|linux|windows)-/
const HEX64 = /^[0-9a-f]{64}$/

export class MirrorPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MirrorPlanError"
  }
}

export interface ReleaseAsset {
  readonly name: string
  readonly size: number
  readonly digest: string | null
}

export interface MirrorAsset {
  readonly name: string
  readonly size: number
  readonly sha256: string
}

export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) sums.set(match[2], match[1].toLowerCase())
  }
  return sums
}

function githubSha256(asset: ReleaseAsset): string | null {
  const hex = asset.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length).toLowerCase() : null
  return hex !== null && HEX64.test(hex) ? hex : null
}

/**
 * Every mirrored asset must carry a GitHub sha256 digest; every omo binary must also appear in SHA256SUMS
 * with the same hash, and SHA256SUMS may not list a binary the release does not have.
 */
export function planMirrorAssets(assets: readonly ReleaseAsset[], sums: ReadonlyMap<string, string>): MirrorAsset[] {
  const mirrored = assets.filter((asset) => MIRRORED_ASSET.test(asset.name))
  const binaries = mirrored.filter((asset) => BINARY.test(asset.name))
  if (binaries.length === 0) throw new MirrorPlanError("release has no omo binaries to mirror")
  if (!mirrored.some((asset) => asset.name === "SHA256SUMS")) throw new MirrorPlanError("release has no SHA256SUMS")
  for (const name of sums.keys()) {
    if (BINARY.test(name) && !binaries.some((asset) => asset.name === name)) {
      throw new MirrorPlanError(`SHA256SUMS lists ${name} but the release has no such asset`)
    }
  }
  return mirrored.map((asset) => {
    const digest = githubSha256(asset)
    if (digest === null) throw new MirrorPlanError(`${asset.name} has no GitHub sha256 digest`)
    const listed = sums.get(asset.name)
    if (BINARY.test(asset.name) && listed === undefined) throw new MirrorPlanError(`${asset.name} is missing from SHA256SUMS`)
    if (listed !== undefined && listed !== digest) {
      throw new MirrorPlanError(`${asset.name}: SHA256SUMS says ${listed} but GitHub says ${digest}`)
    }
    return { name: asset.name, size: asset.size, sha256: digest }
  })
}

type Parsed = { readonly core: readonly [number, number, number]; readonly pre: readonly string[] }

function parseVersion(version: string): Parsed {
  const match = VERSION_PATTERN.exec(version)
  if (match === null) throw new MirrorPlanError(`invalid version ${version}`)
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index++) {
    const diff = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  if (a.pre.length === 0 || b.pre.length === 0) return Math.sign(b.pre.length - a.pre.length)
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index]
    const y = b.pre[index]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y)
    return numeric ? Math.sign(Number(x) - Number(y)) : x < y ? -1 : 1
  }
  return 0
}

export function isPrerelease(version: string): boolean {
  return parseVersion(version).pre.length > 0
}

/** A channel never moves backwards unless forced (a backfill of an older version must not demote it). */
export function shouldMoveChannel(current: string | null, next: string, force: boolean): boolean {
  return force || current === null || compareVersions(next, current) >= 0
}

/** Stable versions are kept forever; only pre-releases beyond the newest `keep` are pruned, never a pinned one. */
export function betasToPrune(versions: readonly string[], protectedVersions: ReadonlySet<string>, keep: number = KEEP_BETAS): string[] {
  const betas = [...new Set(versions.filter((version) => VERSION_PATTERN.test(version) && isPrerelease(version)))]
  betas.sort((left, right) => compareVersions(right, left))
  return betas.slice(keep).filter((version) => !protectedVersions.has(version))
}
