import { loadSkillFromPath } from "./loaded-skill-from-path"
import { loadSkillsFromDir } from "./skill-directory-loader"
import { loadMcpJsonFromDir } from "./skill-mcp-config"
import type { LoadedSkill, SkillScope } from "./types"
import type { SkillProvenance } from "./skill-provenance"

export async function mapWithConcurrency<T, R>(
  items: T[], mapper: (item: T) => Promise<R>, concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++
      results[current] = await mapper(items[current])
    }
  }))
  return results
}

export const loadMcpJsonFromDirAsync = loadMcpJsonFromDir

export async function loadSkillFromPathAsync(
  skillPath: string, resolvedPath: string, defaultName: string,
  scope: SkillScope, namePrefix = "", provenance?: SkillProvenance,
): Promise<LoadedSkill | null> {
  return loadSkillFromPath({ skillPath, resolvedPath, defaultName, scope, namePrefix, provenance, skipMalformedFrontmatter: true })
}

export async function discoverSkillsInDirAsync(
  skillsDir: string, scope: SkillScope = "opencode-project", namePrefix = "",
  depth = 0, maxDepth = 2, provenance?: SkillProvenance,
): Promise<LoadedSkill[]> {
  return loadSkillsFromDir({ skillsDir, scope, namePrefix, depth, maxDepth, provenance, skipMalformedFrontmatter: true })
}
