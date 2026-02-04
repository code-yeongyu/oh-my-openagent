import { promises as fs } from "fs"
import { join, basename } from "path"
import yaml from "js-yaml"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { resolveSymlinkAsync, isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { SkillScope, SkillMetadata, LoadedSkill, LazyContentLoader } from "./types"
import type { SkillMcpConfig } from "../skill-mcp-manager/types"

function parseSkillMcpConfigFromFrontmatter(content: string): SkillMcpConfig | undefined {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch) return undefined

  try {
    const parsed = yaml.load(frontmatterMatch[1]) as Record<string, unknown>
    if (parsed && typeof parsed === "object" && "mcp" in parsed && parsed.mcp) {
      return parsed.mcp as SkillMcpConfig
    }
  } catch {
    return undefined
  }
  return undefined
}

async function loadMcpJsonFromDir(skillDir: string): Promise<SkillMcpConfig | undefined> {
  const mcpJsonPath = join(skillDir, "mcp.json")
  
  try {
    const content = await fs.readFile(mcpJsonPath, "utf-8")
    const parsed = JSON.parse(content) as Record<string, unknown>
    
    if (parsed && typeof parsed === "object" && "mcpServers" in parsed && parsed.mcpServers) {
      return parsed.mcpServers as SkillMcpConfig
    }
    
    if (parsed && typeof parsed === "object" && !("mcpServers" in parsed)) {
      const hasCommandField = Object.values(parsed).some(
        (v) => v && typeof v === "object" && "command" in (v as Record<string, unknown>)
      )
      if (hasCommandField) {
        return parsed as SkillMcpConfig
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function parseAllowedTools(allowedTools: string | string[] | undefined): string[] | undefined {
  if (!allowedTools) return undefined
  
  // Handle YAML array format: already parsed as string[]
  if (Array.isArray(allowedTools)) {
    return allowedTools.map(t => t.trim()).filter(Boolean)
  }
  
  // Handle space-separated string format: "Read Write Edit Bash"
  return allowedTools.split(/\s+/).filter(Boolean)
}

async function loadSkillFromPath(
  skillPath: string,
  resolvedPath: string,
  defaultName: string,
  scope: SkillScope
): Promise<LoadedSkill | null> {
  try {
    const content = await fs.readFile(skillPath, "utf-8")
    const { data, body } = parseFrontmatter<SkillMetadata>(content)
    const frontmatterMcp = parseSkillMcpConfigFromFrontmatter(content)
    const mcpJsonMcp = await loadMcpJsonFromDir(resolvedPath)
    const mcpConfig = mcpJsonMcp || frontmatterMcp

    const skillName = data.name || defaultName
    const originalDescription = data.description || ""
    const isOpencodeSource = scope === "opencode" || scope === "opencode-project"
    const formattedDescription = `(${scope} - Skill) ${originalDescription}`

    const templateContent = `<skill-instruction>
Base directory for this skill: ${resolvedPath}/
File references (@path) in this skill are relative to this directory.

${body.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`

    // RATIONALE: We read the file eagerly to ensure atomic consistency between
    // metadata and body. We maintain the LazyContentLoader interface for
    // compatibility, but the state is effectively eager.
    const eagerLoader: LazyContentLoader = {
      loaded: true,
      content: templateContent,
      load: async () => templateContent,
    }

    const definition: CommandDefinition = {
      name: skillName,
      description: formattedDescription,
      template: templateContent,
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
      mcpConfig,
      lazyContent: eagerLoader,
    }
  } catch {
    return null
  }
}

async function loadSkillsFromDir(skillsDir: string, scope: SkillScope): Promise<LoadedSkill[]> {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])
  const skills: LoadedSkill[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    const entryPath = join(skillsDir, entry.name)

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const resolvedPath = await resolveSymlinkAsync(entryPath)
      const dirName = entry.name

      const skillMdPath = join(resolvedPath, "SKILL.md")
      try {
        await fs.access(skillMdPath)
        const skill = await loadSkillFromPath(skillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      } catch {
      }

      const namedSkillMdPath = join(resolvedPath, `${dirName}.md`)
      try {
        await fs.access(namedSkillMdPath)
        const skill = await loadSkillFromPath(namedSkillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      } catch {
      }

      continue
    }

    if (isMarkdownFile(entry)) {
      const skillName = basename(entry.name, ".md")
      const skill = await loadSkillFromPath(entryPath, skillsDir, skillName, scope)
      if (skill) skills.push(skill)
    }
  }

  return skills
}

function skillsToRecord(skills: LoadedSkill[]): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {}
  for (const skill of skills) {
    const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = skill.definition
    result[skill.name] = openCodeCompatible as CommandDefinition
  }
  return result
}

export async function loadUserSkills(): Promise<Record<string, CommandDefinition>> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  const skills = await loadSkillsFromDir(userSkillsDir, "user")
  return skillsToRecord(skills)
}

export async function loadProjectSkills(): Promise<Record<string, CommandDefinition>> {
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")
  const skills = await loadSkillsFromDir(projectSkillsDir, "project")
  return skillsToRecord(skills)
}

export async function loadOpencodeGlobalSkills(): Promise<Record<string, CommandDefinition>> {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const opencodeSkillsDir = join(configDir, "skills")
  const skills = await loadSkillsFromDir(opencodeSkillsDir, "opencode")
  return skillsToRecord(skills)
}

export async function loadOpencodeProjectSkills(): Promise<Record<string, CommandDefinition>> {
  const opencodeProjectDir = join(process.cwd(), ".opencode", "skills")
  const skills = await loadSkillsFromDir(opencodeProjectDir, "opencode-project")
  return skillsToRecord(skills)
}

export interface DiscoverSkillsOptions {
  includeClaudeCodePaths?: boolean
}

export async function discoverAllSkills(): Promise<LoadedSkill[]> {
  const [opencodeProjectSkills, projectSkills, opencodeGlobalSkills, userSkills] = await Promise.all([
    discoverOpencodeProjectSkills(),
    discoverProjectClaudeSkills(),
    discoverOpencodeGlobalSkills(),
    discoverUserClaudeSkills(),
  ])

  return [...opencodeProjectSkills, ...projectSkills, ...opencodeGlobalSkills, ...userSkills]
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<LoadedSkill[]> {
  const { includeClaudeCodePaths = true } = options

  const [opencodeProjectSkills, opencodeGlobalSkills] = await Promise.all([
    discoverOpencodeProjectSkills(),
    discoverOpencodeGlobalSkills(),
  ])

  if (!includeClaudeCodePaths) {
    return [...opencodeProjectSkills, ...opencodeGlobalSkills]
  }

  const [projectSkills, userSkills] = await Promise.all([
    discoverProjectClaudeSkills(),
    discoverUserClaudeSkills(),
  ])

  return [...opencodeProjectSkills, ...projectSkills, ...opencodeGlobalSkills, ...userSkills]
}

export async function getSkillByName(name: string, options: DiscoverSkillsOptions = {}): Promise<LoadedSkill | undefined> {
  const skills = await discoverSkills(options)
  return skills.find(s => s.name === name)
}

export async function discoverUserClaudeSkills(): Promise<LoadedSkill[]> {
  const userSkillsDir = join(getClaudeConfigDir(), "skills")
  return loadSkillsFromDir(userSkillsDir, "user")
}

export async function discoverProjectClaudeSkills(): Promise<LoadedSkill[]> {
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")
  return loadSkillsFromDir(projectSkillsDir, "project")
}

export async function discoverOpencodeGlobalSkills(): Promise<LoadedSkill[]> {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const opencodeSkillsDir = join(configDir, "skills")
  return loadSkillsFromDir(opencodeSkillsDir, "opencode")
}

export async function discoverOpencodeProjectSkills(): Promise<LoadedSkill[]> {
  const opencodeProjectDir = join(process.cwd(), ".opencode", "skills")
  return loadSkillsFromDir(opencodeProjectDir, "opencode-project")
}
