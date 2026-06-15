import * as fs from "node:fs"
import * as path from "node:path"

import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { getOpenCodeConfigDir } from "../../shared"

interface OpencodeConfigWithSkills {
  skills?: { paths?: unknown; urls?: unknown }
}

export interface HostSkillConfigShape {
  paths?: string[]
  urls?: string[]
}

function getConfigPaths(directory: string): string[] {
  const globalConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  return [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(globalConfigDir, "opencode.json"),
    path.join(globalConfigDir, "opencode.jsonc"),
  ]
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function readOpencodeConfigSkills(directory: string): HostSkillConfigShape | undefined {
  const paths: string[] = []
  const urls: string[] = []

  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const parseResult = parseJsoncSafe<OpencodeConfigWithSkills>(content)
      if (!parseResult.data?.skills) continue

      for (const p of toStringArray(parseResult.data.skills.paths)) {
        if (!paths.includes(p)) paths.push(p)
      }
      for (const u of toStringArray(parseResult.data.skills.urls)) {
        if (!urls.includes(u)) urls.push(u)
      }
    } catch (error) {
      if (error instanceof Error) {
        continue
      }
      continue
    }
  }

  if (paths.length === 0 && urls.length === 0) return undefined
  return { paths, urls }
}
