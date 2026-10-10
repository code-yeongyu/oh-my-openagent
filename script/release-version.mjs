import { pathToFileURL } from "node:url"

/** Validate the version before any release-state drafting or registry writes. */
export function resolveReleaseVersion(version, lazycodexOnly) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/.exec(version)
  if (!match) throw new Error(`Invalid version: ${version}`)
  const identifiers = match[4]?.split(".") ?? []
  if (identifiers.some((part) => /^0\d+$/.test(part))) throw new Error(`Invalid numeric prerelease identifier: ${version}`)
  const reserved = identifiers.includes("lazycodex")
  if (lazycodexOnly) {
    if (!reserved || !/^(?:[0-9A-Za-z]+\.)*lazycodex\.[1-9]\d*$/.test(match[4] ?? "") || identifiers.filter((part) => part === "lazycodex").length !== 1) {
      throw new Error("LazyCodex-only version must end in lazycodex.N (N >= 1), e.g. 5.0.0-beta.62.lazycodex.1 or 5.0.0-lazycodex.1")
    }
  } else if (reserved) {
    throw new Error("The lazycodex prerelease identifier is reserved for LazyCodex-only releases")
  }
  const distTag = identifiers[0] ?? ""
  if (distTag === "latest") throw new Error("Prereleases must not publish to latest")
  if (distTag && !/^[a-z][a-z0-9-]*$/.test(distTag)) throw new Error(`Invalid dist_tag: ${distTag}`)
  return { version, distTag }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = resolveReleaseVersion(process.argv[2], process.env.LAZYCODEX_ONLY === "true")
    console.log(`version=${result.version}\ndist_tag=${result.distTag}`)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}
