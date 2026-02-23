import { fetchNpmDistTags } from "./npm-dist-tags"

const PACKAGE_NAME = "oh-my-opencode"
const PRIORITIZED_TAGS = ["latest", "beta", "next"] as const

export async function getPluginNameWithVersion(currentVersion: string): Promise<string> {
  const distTags = await fetchNpmDistTags(PACKAGE_NAME)

  if (distTags) {
    const allTags = new Set([...PRIORITIZED_TAGS, ...Object.keys(distTags)])
    for (const tag of allTags) {
      if (distTags[tag] === currentVersion) {
        return `${PACKAGE_NAME}@${tag}`
      }
    }
  }

  const prereleaseChannel = extractPrereleaseChannel(currentVersion)
  if (prereleaseChannel) {
    return `${PACKAGE_NAME}@${prereleaseChannel}`
  }

  return PACKAGE_NAME
}

function extractPrereleaseChannel(version: string): string | null {
  const match = version.match(/^\d+\.\d+\.\d+-([a-z]+)/)
  return match ? match[1] : null
}
