import { releaseAssetName, ENGINE_RELEASE_HOSTS } from "./release-assets.ts"

export type ChecksumsParse =
  | { readonly kind: "parsed"; readonly digests: ReadonlyMap<string, string> }
  | { readonly kind: "invalid"; readonly detail: string }

const LINE = /^([a-f0-9]{64}) {2}([A-Za-z0-9.-]+)$/
const KNOWN_ASSETS: ReadonlySet<string> = new Set(ENGINE_RELEASE_HOSTS.map((host) => releaseAssetName(host) ?? ""))

/** `sha256sum` output naming only published engine assets, each once, lowercase hex. */
export function parseChecksums(text: string): ChecksumsParse {
  const digests = new Map<string, string>()
  for (const line of text.trimEnd().split(/\r?\n/)) {
    const match = LINE.exec(line)
    const digest = match?.[1]
    const asset = match?.[2]
    if (digest === undefined || asset === undefined || !KNOWN_ASSETS.has(asset)) {
      return {
        kind: "invalid",
        detail: `not a checksum line for an engine asset: ${JSON.stringify(line.slice(0, 120))}`,
      }
    }
    if (digests.has(asset)) return { kind: "invalid", detail: `duplicate checksum for ${asset}` }
    digests.set(asset, digest)
  }
  return { kind: "parsed", digests }
}
