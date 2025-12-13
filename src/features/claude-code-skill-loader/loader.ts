import { existsSync, readdirSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { resolveSymlink } from "../../shared/file-utils"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { SkillScope, SkillMetadata, LoadedSkillAsCommand } from "./types"

function loadSkillsFromDir(skillsDir: string, scope: SkillScope): LoadedSkillAsCommand[] {
  if (!existsSync(skillsDir)) {
    return []
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
  const skills: LoadedSkillAsCommand[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    const skillPath = join(skillsDir, entry.name)

    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

    const resolvedPath = resolveSymlink(skillPath)

    const skillMdPath = join(resolvedPath, "SKILL.md")
    if (!existsSync(skillMdPath)) continue

    try {
      const content = readFileSync(skillMdPath, "utf-8")
      const { data, body } = parseFrontmatter<SkillMetadata>(content)

      const skillName = data.name || entry.name
      const originalDescription = data.description || ""
      const formattedDescription = `(${scope} - Skill) ${originalDescription}`

      const wrappedTemplate = `<skill-instruction>
${body.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`

      const definition: CommandDefinition = {
        name: skillName,
        description: formattedDescription,
        template: wrappedTemplate,
        model: sanitizeModelField(data.model),
      }

      skills.push({
        name: skillName,
        path: resolvedPath,
        definition,
        scope,
      })
    } catch {
      continue
    }
  }

  return skills
}

export function loadUserSkillsAsCommands(): Record<string, CommandDefinition> {
  const userSkillsDir = join(homedir(), ".claude", "skills")
  const skills = loadSkillsFromDir(userSkillsDir, "user")
  return skills.reduce((acc, skill) => {
    acc[skill.name] = skill.definition
    return acc
  }, {} as Record<string, CommandDefinition>)
}

export function loadProjectSkillsAsCommands(): Record<string, CommandDefinition> {
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")
  const skills = loadSkillsFromDir(projectSkillsDir, "project")
  return skills.reduce((acc, skill) => {
    acc[skill.name] = skill.definition
    return acc
  }, {} as Record<string, CommandDefinition>)
}
