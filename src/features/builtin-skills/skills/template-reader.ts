import { existsSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { parseFrontmatter } from "../../../shared/frontmatter"

const builtinSkillRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceSkillRoot = join(builtinSkillRoot, "..", "..", "..", "src", "features", "builtin-skills")
const builtinSkillTemplateCache = new Map<string, string>()

export function readBuiltinSkillTemplate(skillDir: string): string {
  const cached = builtinSkillTemplateCache.get(skillDir)
  if (cached) return cached

  const candidatePaths = [
    join(builtinSkillRoot, skillDir, "SKILL.md"),
    join(sourceSkillRoot, skillDir, "SKILL.md"),
  ]

  for (const skillPath of candidatePaths) {
    if (!existsSync(skillPath)) continue
    const content = readFileSync(skillPath, "utf-8")
    const { body } = parseFrontmatter(content)
    const template = body.trim()
    builtinSkillTemplateCache.set(skillDir, template)
    return template
  }

  return ""
}
