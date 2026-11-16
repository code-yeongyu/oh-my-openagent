/** The engine binary, its per-host release assets and the checksums asset the publisher writes. */
const ENGINE_BINARY = "omo-computer-engine"
export const ENGINE_CHECKSUMS_ASSET = "omo-computer-engine-checksums.txt"

/** Hosts a release publishes an engine for. musl Linux is not one of them. */
export const ENGINE_RELEASE_HOSTS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
] as const

type ReleaseHost = (typeof ENGINE_RELEASE_HOSTS)[number]

function isReleaseHost(host: string): host is ReleaseHost {
  return ENGINE_RELEASE_HOSTS.some((known) => known === host)
}

/** `omo-computer-engine-<host>[.exe]`, or `null` for a host no release publishes. */
export function releaseAssetName(host: string): string | null {
  if (!isReleaseHost(host)) return null
  return host.startsWith("win32-") ? `${ENGINE_BINARY}-${host}.exe` : `${ENGINE_BINARY}-${host}`
}

export function engineFileName(platform: string): string {
  return platform === "win32" ? `${ENGINE_BINARY}.exe` : ENGINE_BINARY
}
