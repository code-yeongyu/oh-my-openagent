import { basename } from "path"
import { fileURLToPath } from "url"

export function derivePluginNameFromKey(pluginKey: string): string {
  const keyWithoutSource = pluginKey.startsWith("npm:") ? pluginKey.slice(4) : pluginKey

  let versionSeparator: number
  if (keyWithoutSource.startsWith("@")) {
    const scopeEnd = keyWithoutSource.indexOf("/")
    versionSeparator = scopeEnd > 0 ? keyWithoutSource.indexOf("@", scopeEnd) : -1
  } else {
    versionSeparator = keyWithoutSource.lastIndexOf("@")
  }
  const keyWithoutVersion = versionSeparator > 0 ? keyWithoutSource.slice(0, versionSeparator) : keyWithoutSource

  if (keyWithoutVersion.startsWith("file://")) {
    try {
      return basename(fileURLToPath(keyWithoutVersion))
    } catch (error) {
      if (error instanceof Error) return basename(keyWithoutVersion)
      return basename(keyWithoutVersion)
    }
  }

  if (keyWithoutVersion.startsWith("@") && keyWithoutVersion.includes("/")) {
    return keyWithoutVersion
  }

  if (keyWithoutVersion.includes("/") || keyWithoutVersion.includes("\\")) {
    return basename(keyWithoutVersion)
  }

  return keyWithoutVersion
}
