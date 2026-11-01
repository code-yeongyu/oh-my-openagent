import { isSemver } from "./version.ts"

// The files of one device service release directory. checksums.txt is the signed index: one line per file, lowercase
// sha256, two spaces, the file name, LF-terminated; checksums.txt.sig is the raw 64-byte Ed25519 signature over its
// exact bytes; latest.json names the release's version and the oldest engine it runs with.
export const CHECKSUMS = "checksums.txt"
export const SIGNATURE = "checksums.txt.sig"
export const MANIFEST = "latest.json"
export const SIGNATURE_BYTES = 64
export const CHECKSUMS_MAX_BYTES = 64 * 1024
export const MANIFEST_MAX_BYTES = 4 * 1024
export const BINARY_MAX_BYTES = 512 * 1024 * 1024

const DEVICE_SERVICE_HOSTS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64", "windows-arm64"] as const
export type DeviceServiceHost = (typeof DEVICE_SERVICE_HOSTS)[number]

export const deviceServiceAssetName = (host: DeviceServiceHost): string =>
  host.startsWith("windows-") ? `omo-device-service-${host}.exe` : `omo-device-service-${host}`

const RELEASE_FILES: ReadonlySet<string> = new Set([MANIFEST, ...DEVICE_SERVICE_HOSTS.map(deviceServiceAssetName)])
const CHECKSUM_LINE = /^([0-9a-f]{64}) {2}([A-Za-z0-9.-]+)$/

const strictUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** The name -> sha256 index of a signed checksums.txt, or undefined when any line breaks the grammar. */
export const parseChecksums = (bytes: Uint8Array): ReadonlyMap<string, string> | undefined => {
  const text = strictUtf8(bytes)
  if (text === undefined || !text.endsWith("\n")) return undefined
  const digests = new Map<string, string>()
  for (const line of text.slice(0, -1).split("\n")) {
    const match = CHECKSUM_LINE.exec(line)
    const digest = match?.[1]
    const name = match?.[2]
    if (digest === undefined || name === undefined || !RELEASE_FILES.has(name) || digests.has(name)) return undefined
    digests.set(name, digest)
  }
  return digests
}

export type ReleaseManifest = { readonly version: string; readonly min_engine_version: string }

/** latest.json: exactly `version` and `min_engine_version`, both semantic versions. */
export const parseManifest = (bytes: Uint8Array): ReleaseManifest | undefined => {
  const text = strictUtf8(bytes)
  if (text === undefined) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  if (Object.keys(value).toSorted().join(",") !== "min_engine_version,version") return undefined
  const version: unknown = Reflect.get(value, "version")
  const engine: unknown = Reflect.get(value, "min_engine_version")
  if (typeof version !== "string" || typeof engine !== "string" || !isSemver(version) || !isSemver(engine)) return undefined
  return { version, min_engine_version: engine }
}
