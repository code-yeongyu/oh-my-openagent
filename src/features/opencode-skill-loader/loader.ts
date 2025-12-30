import { existsSync, readdirSync, readFileSync } from "fs"
import { join, basename, dirname } from "path"
import { homedir } from "os"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { resolveSymlink, isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { SkillScope, SkillMetadata, LoadedSkill } from "./types"

/**
 * Load a skill from a markdown file path.
 * 
 * @param skillPath - Path to the skill file (SKILL.md or {name}.md)
 * @param resolvedPath - Directory for file reference resolution (@path references)
 * @param defaultName - Fallback name if not specified in frontmatter
 * @param scope - Source scope for priority ordering
 */
function parseAllowedTools(allowedTools: string | undefined): string[] | undefined {
  if (!allowedTools) return undefined
  return allowedTools.split(/\s+/).filter(Boolean)
}

function loadSkillFromPath(
  skillPath: string,
  resolvedPath: string,
  defaultName: string,
  scope: SkillScope
): LoadedSkill | null {
  try {
    const content = readFileSync(skillPath, "utf-8")
    const { data, body } = parseFrontmatter<SkillMetadata>(content)

    const skillName = data.name || defaultName
    const originalDescription = data.description || ""
    const isOpencodeSource = scope === "opencode" || scope === "opencode-project"
    const formattedDescription = `(${scope} - Skill) ${originalDescription}`

    const wrappedTemplate = `<skill-instruction>
Base directory for this skill: ${resolvedPath}/
File references (@path) in this skill are relative to this directory.

${body.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`

    const definition: CommandDefinition = {
      name: skillName,
      description: formattedDescription,
      template: wrappedTemplate,
      model: sanitizeModelField(data.model, isOpencodeSource ? "opencode" : "claude-code"),
      agent: data.agent,
      subtask: data.subtask,
      argumentHint: data["argument-hint"],
    }

    return {
      name: skillName,
      path: skillPath,
      resolvedPath,
      definition,
      scope,
      license: data.license,
      compatibility: data.compatibility,
      metadata: data.metadata,
      allowedTools: parseAllowedTools(data["allowed-tools"]),
    }
  } catch {
    return null
  }
}

/**
 * Load skills from a directory, supporting BOTH patterns:
 * - Directory with SKILL.md: skill-name/SKILL.md
 * - Directory with {SKILLNAME}.md: skill-name/{SKILLNAME}.md
 * - Direct markdown file: skill-name.md
 */
function loadSkillsFromDir(skillsDir: string, scope: SkillScope): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return []
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
  const skills: LoadedSkill[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    const entryPath = join(skillsDir, entry.name)

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const resolvedPath = resolveSymlink(entryPath)
      const dirName = entry.name

      const skillMdPath = join(resolvedPath, "SKILL.md")
      if (existsSync(skillMdPath)) {
        const skill = loadSkillFromPath(skillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      }

      const namedSkillMdPath = join(resolvedPath, `${dirName}.md`)
      if (existsSync(namedSkillMdPath)) {
        const skill = loadSkillFromPath(namedSkillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      }

      continue
    }

    if (isMarkdownFile(entry)) {
      const skillName = basename(entry.name, ".md")
      const skill = loadSkillFromPath(entryPath, skillsDir, skillName, scope)
      if (skill) skills.push(skill)
    }
  }

  return skills
}

function skillsToRecord(skills: LoadedSkill[]): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const skill of skills) {
    result[skill.name] = skill.definition
  }
  return result
}

/**
 * Load skills from Claude Code user directory (~/.claude/skills/)
 */
export function loadUserSkills(): Record<string, CommandDefinition> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  const skills = loadSkillsFromDir(userSkillsDir, "user")
  return skillsToRecord(skills)
}

/**
 * Load skills from Claude Code project directory (.claude/skills/)
 */
export function loadProjectSkills(): Record<string, CommandDefinition> {
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")
  const skills = loadSkillsFromDir(projectSkillsDir, "project")
  return skillsToRecord(skills)
}

/**
 * Load skills from OpenCode global directory (~/.config/opencode/skill/)
 */
export function loadOpencodeGlobalSkills(): Record<string, CommandDefinition> {
  const opencodeSkillsDir = join(homedir(), ".config", "opencode", "skill")
  const skills = loadSkillsFromDir(opencodeSkillsDir, "opencode")
  return skillsToRecord(skills)
}

/**
 * Load skills from OpenCode project directory (.opencode/skill/)
 */
export function loadOpencodeProjectSkills(): Record<string, CommandDefinition> {
  const opencodeProjectDir = join(process.cwd(), ".opencode", "skill")
  const skills = loadSkillsFromDir(opencodeProjectDir, "opencode-project")
  return skillsToRecord(skills)
}

/**
 * Discover all skills from all sources with priority ordering.
 * Priority order: opencode-project > project > opencode > user
 * 
 * @returns Array of LoadedSkill objects for use in slashcommand discovery
 */
export function discoverAllSkills(): LoadedSkill[] {
  const opencodeProjectDir = join(process.cwd(), ".opencode", "skill")
  const projectDir = join(process.cwd(), ".claude", "skills")
  const opencodeGlobalDir = join(homedir(), ".config", "opencode", "skill")
  const userDir = join(getClaudeConfigDir(), "skills")

  const opencodeProjectSkills = loadSkillsFromDir(opencodeProjectDir, "opencode-project")
  const projectSkills = loadSkillsFromDir(projectDir, "project")
  const opencodeGlobalSkills = loadSkillsFromDir(opencodeGlobalDir, "opencode")
  const userSkills = loadSkillsFromDir(userDir, "user")

  return [...opencodeProjectSkills, ...projectSkills, ...opencodeGlobalSkills, ...userSkills]
}

export interface DiscoverSkillsOptions {
  includeClaudeCodePaths?: boolean
}

/**
 * Discover skills with optional filtering.
 * When includeClaudeCodePaths is false, only loads from OpenCode paths.
 */
export function discoverSkills(options: DiscoverSkillsOptions = {}): LoadedSkill[] {
  const { includeClaudeCodePaths = true } = options

  const opencodeProjectDir = join(process.cwd(), ".opencode", "skill")
  const opencodeGlobalDir = join(homedir(), ".config", "opencode", "skill")

  const opencodeProjectSkills = loadSkillsFromDir(opencodeProjectDir, "opencode-project")
  const opencodeGlobalSkills = loadSkillsFromDir(opencodeGlobalDir, "opencode")

  if (!includeClaudeCodePaths) {
    return [...opencodeProjectSkills, ...opencodeGlobalSkills]
  }

  const projectDir = join(process.cwd(), ".claude", "skills")
  const userDir = join(getClaudeConfigDir(), "skills")

  const projectSkills = loadSkillsFromDir(projectDir, "project")
  const userSkills = loadSkillsFromDir(userDir, "user")

  return [...opencodeProjectSkills, ...projectSkills, ...opencodeGlobalSkills, ...userSkills]
}

/**
 * Get a skill by name from all available sources.
 */
export function getSkillByName(name: string, options: DiscoverSkillsOptions = {}): LoadedSkill | undefined {
  const skills = discoverSkills(options)
  return skills.find(s => s.name === name)
}

export function discoverUserClaudeSkills(): LoadedSkill[] {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  return loadSkillsFromDir(userSkillsDir, "user")
}

export function discoverProjectClaudeSkills(): LoadedSkill[] {
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")
  return loadSkillsFromDir(projectSkillsDir, "project")
}

export function discoverOpencodeGlobalSkills(): LoadedSkill[] {
  const opencodeSkillsDir = join(homedir(), ".config", "opencode", "skill")
  return loadSkillsFromDir(opencodeSkillsDir, "opencode")
}

export function discoverOpencodeProjectSkills(): LoadedSkill[] {
  const opencodeProjectDir = join(process.cwd(), ".opencode", "skill")
  return loadSkillsFromDir(opencodeProjectDir, "opencode-project")
}
