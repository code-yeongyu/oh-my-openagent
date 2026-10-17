export const GITHUB_REPOSITORY = "code-yeongyu/oh-my-openagent"
export const CHANNELS = ["latest", "beta"] as const
export type Channel = (typeof CHANNELS)[number]

// Same shape as script/release-latest-flag.ts: X.Y.Z with an optional dotted pre-release.
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/
// Every asset a release attaches: the compiled omo binaries, SHA256SUMS, and the desktop engines.
const BINARY = /^omo-(?:darwin|linux|windows)-(?:x64|arm64)(?:-musl)?(?:-baseline)?(?:\.exe)?$/
const ENGINE = /^senpi-desktop-engine-(?:checksums\.txt|(?:darwin|linux|win32)-(?:x64|arm64)(?:\.exe)?)$/

export type AssetKind = "binary" | "checksums" | "engine"

export function isChannel(value: string): value is Channel {
  return CHANNELS.some((channel) => channel === value)
}

export function isReleaseVersion(value: string): boolean {
  return VERSION.test(value)
}

export function isBetaVersion(version: string): boolean {
  return version.includes("-")
}

export function assetKind(name: string): AssetKind | null {
  if (name === "SHA256SUMS") return "checksums"
  if (BINARY.test(name)) return "binary"
  if (ENGINE.test(name)) return "engine"
  return null
}

export function releaseObjectKey(version: string, asset: string): string {
  return `releases/v${version}/${asset}`
}

export function completionMarkerKey(version: string): string {
  return `releases/v${version}/.complete`
}

export function channelPointerKey(channel: Channel): string {
  return `channels/${channel}`
}

export function githubAssetUrl(version: string, asset: string): string {
  return `https://github.com/${GITHUB_REPOSITORY}/releases/download/v${version}/${asset}`
}

// omo-ai publishes pre-releases as X.Y.Z-0.beta.N; the GitHub tag drops the "0." (compiled-update.ts releaseVersionOf).
export function releaseVersionOfNpmVersion(npmVersion: string): string {
  return npmVersion.replace(/-0\./, "-")
}
