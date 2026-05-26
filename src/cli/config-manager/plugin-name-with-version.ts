import { PLUGIN_NAME } from "../../shared"
import { fetchNpmDistTags } from "./npm-dist-tags"

const DEFAULT_PACKAGE_NAME = PLUGIN_NAME
const PRIORITIZED_TAGS = ["latest", "beta", "next"] as const

export interface PluginInstallReference {
  entry: string
  channel: string
}

function getFallbackChannel(version: string): string {
  const prereleaseMatch = version.match(/-([a-zA-Z][a-zA-Z0-9-]*)(?:\.|$)/)
  if (prereleaseMatch) {
    return prereleaseMatch[1]
  }

  return "latest"
}

export async function resolvePluginInstallReference(
  currentVersion: string,
  packageName: string = DEFAULT_PACKAGE_NAME
): Promise<PluginInstallReference> {
  const distTags = await fetchNpmDistTags(packageName)
  let channel = getFallbackChannel(currentVersion)

  if (distTags) {
    const allTags = new Set([...PRIORITIZED_TAGS, ...Object.keys(distTags)])
    for (const tag of allTags) {
      if (distTags[tag] === currentVersion) {
        channel = tag
        break
      }
    }
  }

  return {
    entry: `${packageName}@${currentVersion}`,
    channel,
  }
}

export async function getPluginNameWithVersion(
  currentVersion: string,
  packageName: string = DEFAULT_PACKAGE_NAME
): Promise<string> {
  const { entry } = await resolvePluginInstallReference(currentVersion, packageName)
  return entry
}
