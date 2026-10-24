import { existsSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { parseFrontmatter } from "@oh-my-opencode/utils"
import { readSkillFileChecked } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/checked-skill-read"
import {
  checkSkillPath, SkillLinkBlockedError, reportSkillLoadError, type SkillProvenance,
} from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/skill-provenance"
import type { LoadedSkill } from "./types"

export type CheckedProjectSkills = {
  readonly skills: ReadonlyMap<string, LoadedSkill>
  readonly blocked: readonly SkillLinkBlockedError[]
  readonly errors: readonly { path: string; error: Error }[]
}

export function readProjectSkills(dir: string, provenance: SkillProvenance): CheckedProjectSkills {
  const skills = new Map<string, LoadedSkill>()
  const blocked: SkillLinkBlockedError[] = []
  const errors: { path: string; error: Error }[] = []
  function walk(path: string, ancestry: ReadonlySet<string>, root = false, markdown = false): void {
    try {
      const canonical = checkSkillPath(path, provenance, true)
      if (statSync(canonical).isDirectory()) {
        if (ancestry.has(canonical)) return
        const next = new Set([...ancestry, canonical])
        const entries = readdirSync(path, { withFileTypes: true })
        if (entries.some((entry) => entry.name === "SKILL.md" && !entry.isDirectory())) {
          walk(join(path, "SKILL.md"), next)
          return
        }
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue
          if (entry.isDirectory() || entry.isSymbolicLink() || (root && entry.name.endsWith(".md"))) {
            walk(join(path, entry.name), next, false, root)
          }
        }
      } else if (basename(path) === "SKILL.md" || (markdown && path.endsWith(".md"))) {
        const raw = readSkillFileChecked(path, provenance)
        const { data, body } = parseFrontmatter<{ name?: string }>(raw)
        const name = data.name ?? (basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path, ".md"))
        if (!skills.has(name)) skills.set(name, { name, content: body.trim(), location: path })
      }
    } catch (error) {
      if (error instanceof SkillLinkBlockedError) blocked.push(error)
      else {
        reportSkillLoadError(error, path)
        if (error instanceof Error) errors.push({ path, error })
      }
    }
  }
  if (existsSync(dir)) walk(dir, new Set(), true)
  return { skills, blocked, errors }
}
