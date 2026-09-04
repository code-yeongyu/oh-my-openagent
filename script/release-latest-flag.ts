#!/usr/bin/env bun

export const RELEASE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/

export type LatestFlag = "--latest" | "--latest=false"

function toReleaseVersion(tag: string): string | null {
  const version = tag.trim().replace(/^v/, "")
  return RELEASE_VERSION_PATTERN.test(version) ? version : null
}

export function resolveLatestFlag(version: string, releasedTags: readonly string[]): LatestFlag {
  const target = toReleaseVersion(version)
  if (target === null) {
    throw new TypeError(`Not a release version: ${version}`)
  }
  const outranked = releasedTags.some((tag) => {
    const published = toReleaseVersion(tag)
    return published !== null && Bun.semver.order(published, target) > 0
  })
  return outranked ? "--latest=false" : "--latest"
}

async function main(): Promise<void> {
  const version = process.argv[2]
  if (version === undefined) {
    console.error("usage: gh release list --exclude-drafts --json tagName --jq '.[].tagName' | bun script/release-latest-flag.ts <version>")
    process.exit(2)
  }
  const releasedTags = (await Bun.stdin.text()).split("\n").filter((line) => line.trim().length > 0)
  console.log(resolveLatestFlag(version, releasedTags))
}

if (import.meta.main) {
  await main()
}
