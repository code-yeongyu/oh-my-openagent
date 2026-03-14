import { basename, dirname, join } from "node:path"
import { getOpenCodeConfigDir } from "./opencode-config-dir"
import type { OpenCodeConfigDirOptions } from "./opencode-config-dir-types"

function getParentOpencodeConfigDir(configDir: string): string | null {
  const parentDir = dirname(configDir)
  if (basename(parentDir) !== "profiles") {
    return null
  }

  return dirname(parentDir)
}

export function getOpenCodeCommandDirs(options: OpenCodeConfigDirOptions): string[] {
  const configDir = getOpenCodeConfigDir(options)
  const parentConfigDir = getParentOpencodeConfigDir(configDir)

  return Array.from(
    new Set([
      join(configDir, "command"),
      ...(parentConfigDir ? [join(parentConfigDir, "command")] : []),
    ])
  )
}

export function getOpenCodeSkillDirs(options: OpenCodeConfigDirOptions): string[] {
  const configDir = getOpenCodeConfigDir(options)
  const parentConfigDir = getParentOpencodeConfigDir(configDir)

  return Array.from(
    new Set([
      join(configDir, "skills"),
      ...(parentConfigDir ? [join(parentConfigDir, "skills")] : []),
    ])
  )
}
