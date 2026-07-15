import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface EnsureCodegraphProjectConfigOptions {
  readonly exclude?: readonly string[]
}

function mergeUniqueStringArrays(...arrays: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const array of arrays) {
    for (const entry of array) {
      const trimmed = entry.trim()
      if (trimmed.length === 0 || seen.has(trimmed)) continue
      seen.add(trimmed)
      result.push(trimmed)
    }
  }

  return result
}

function readExistingProjectConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {}

  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"))
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {}
  } catch {
    return {}
  }
}

function readExistingExclude(existing: Record<string, unknown>): string[] {
  if (!Array.isArray(existing.exclude)) return []
  return existing.exclude.filter((entry): entry is string => typeof entry === "string")
}

export function ensureCodegraphProjectConfig(
  projectRoot: string,
  options: EnsureCodegraphProjectConfigOptions = {},
): boolean {
  const configuredExclude = options.exclude?.map((entry) => entry.trim()).filter((entry) => entry.length > 0) ?? []
  if (configuredExclude.length === 0) return false

  const configPath = join(projectRoot, "codegraph.json")
  const existing = readExistingProjectConfig(configPath)
  const mergedExclude = mergeUniqueStringArrays(readExistingExclude(existing), configuredExclude)
  const next = { ...existing, exclude: mergedExclude }
  const content = `${JSON.stringify(next, null, 2)}\n`

  if (existsSync(configPath) && readFileSync(configPath, "utf8") === content) {
    return false
  }

  writeFileSync(configPath, content, "utf8")
  return true
}
