import * as fs from "node:fs/promises"
import { join } from "node:path"
import type { DiscoveredProjectDirectory } from "../../shared/project-discovery-dirs"
import type { LoadedSkill, SkillScope } from "./types"
import { inferSkillNameFromFileName, loadSkillFromPath } from "./loaded-skill-from-path"
import {
  checkSkillPath, reportSkillLoadError, skillProvenance,
  type SkillProvenance, type SkillDiagnosticSink,
} from "./skill-provenance"

export async function loadSkillsFromDir(options: {
  skillsDir: string | DiscoveredProjectDirectory
  scope: SkillScope
  namePrefix?: string
  depth?: number
  maxDepth?: number
  skipMalformedFrontmatter?: boolean
  provenance?: SkillProvenance
  onDiagnostic?: SkillDiagnosticSink
  ancestry?: ReadonlySet<string>
}): Promise<LoadedSkill[]> {
  const directory = typeof options.skillsDir === "string" ? undefined : options.skillsDir
  const discovered = typeof options.skillsDir === "string" ? options.skillsDir : options.skillsDir.discovered
  const provenance = skillProvenance(discovered, options.scope, options.provenance ?? (
    directory ? { kind: "project-auto", selectedRoot: directory.discovered, projectRoot: directory.projectRoot } : undefined
  ))
  const namePrefix = options.namePrefix ?? ""
  const depth = options.depth ?? 0
  const maxDepth = options.maxDepth ?? 2
  const skillMap = new Map<string, LoadedSkill>()
  try {
    const canonical = checkSkillPath(discovered, provenance, true)
    if (options.ancestry?.has(canonical)) return []
    const ancestry = new Set([...(options.ancestry ?? []), canonical])
    const entries = await fs.readdir(discovered, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const path = join(discovered, entry.name)
      try {
        const entryProvenance = skillProvenance(path, options.scope, provenance)
        const resolved = checkSkillPath(path, entryProvenance, true)
        const stat = await fs.stat(resolved)
        if (stat.isDirectory()) {
          if (ancestry.has(resolved)) continue
          const candidates = [join(path, "SKILL.md"), join(path, `${entry.name}.md`)]
          let found = false
          for (const skillPath of candidates) {
            try { await fs.lstat(skillPath) } catch (error) {
              if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
              reportSkillLoadError(error, skillPath, options.onDiagnostic)
              found = true
              break
            }
            found = true
            const skill = await loadSkillFromPath({
              skillPath, resolvedPath: resolved, defaultName: entry.name, scope: options.scope,
              namePrefix, provenance: entryProvenance, onDiagnostic: options.onDiagnostic,
              skipMalformedFrontmatter: options.skipMalformedFrontmatter,
            })
            if (skill && !skillMap.has(skill.name)) skillMap.set(skill.name, skill)
            break
          }
          if (!found && depth < maxDepth) {
            const nested = await loadSkillsFromDir({
              ...options, skillsDir: path, provenance: entryProvenance, ancestry,
              namePrefix: namePrefix ? `${namePrefix}/${entry.name}` : entry.name, depth: depth + 1,
            })
            for (const skill of nested) if (!skillMap.has(skill.name)) skillMap.set(skill.name, skill)
          }
        } else if (stat.isFile() && path.toLowerCase().endsWith(".md")) {
          const skill = await loadSkillFromPath({
            skillPath: path, resolvedPath: canonical, defaultName: inferSkillNameFromFileName(path),
            scope: options.scope, namePrefix, provenance: entryProvenance, onDiagnostic: options.onDiagnostic,
            skipMalformedFrontmatter: options.skipMalformedFrontmatter,
          })
          if (skill && !skillMap.has(skill.name)) skillMap.set(skill.name, skill)
        }
      } catch (error) {
        reportSkillLoadError(error, path, options.onDiagnostic)
      }
    }
  } catch (error) {
    reportSkillLoadError(error, discovered, options.onDiagnostic)
  }
  return [...skillMap.values()]
}
