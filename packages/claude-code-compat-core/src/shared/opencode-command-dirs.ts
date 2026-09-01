import { basename, dirname, join } from "node:path"

import { getOpenCodeConfigDirs } from "./opencode-config-dir"
import type { OpenCodeConfigDirOptions } from "./opencode-config-dir-types"

function getParentOpencodeConfigDir(configDir: string): string | null {
  const parentDir = dirname(configDir)
  if (basename(parentDir) !== "profiles") {
    return null
  }

  return dirname(parentDir)
}

export function getOpenCodeCommandDirs(options: OpenCodeConfigDirOptions): string[] {
  const configDirs = getOpenCodeConfigDirs(options)
  return Array.from(
    new Set([
      ...configDirs.flatMap((configDir) => {
        const parentConfigDir = getParentOpencodeConfigDir(configDir)
        return [
          join(configDir, "commands"),
          join(configDir, "command"),
          ...(parentConfigDir ? [join(parentConfigDir, "commands"), join(parentConfigDir, "command")] : []),
        ]
      }),
    ]),
  )
}
