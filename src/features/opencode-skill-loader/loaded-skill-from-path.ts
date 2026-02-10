import { promises as fs } from "fs"
import { basename } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { resolveSkillPathReferences } from "../../shared/skill-path-resolver"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import { parseAllowedTools } from "./allowed-tools-parser"
import { loadMcpJsonFromDir, parseSkillMcpConfigFromFrontmatter } from "./skill-mcp-config"
import type { SkillScope, SkillMetadata, LoadedSkill, LazyContentLoader } from "./types"

export async function loadSkillFromPath(options: {
  skillPath: string
  resolvedPath: string
  defaultName: string
  scope: SkillScope
  namePrefix?: string
}): Promise<LoadedSkill | null> {
  const namePrefix = options.namePrefix ?? ""

  try {
    const content = await fs.readFile(options.skillPath, "utf-8")
    const { data, body } = parseFrontmatter<SkillMetadata>(content)

    const frontmatterMcp = parseSkillMcpConfigFromFrontmatter(content)
    const mcpJsonMcp = await loadMcpJsonFromDir(options.resolvedPath)
    const mcpConfig = mcpJsonMcp || frontmatterMcp

    const baseName = data.name || options.defaultName
    const skillName = namePrefix ? `${namePrefix}/${baseName}` : baseName
    const originalDescription = data.description || ""
    const isOpencodeSource = options.scope === "opencode" || options.scope === "opencode-project"
    const formattedDescription = `(${options.scope} - Skill) ${originalDescription}`

    const resolvedBody = resolveSkillPathReferences(body.trim(), options.resolvedPath)
    const templateContent = `<skill-instruction>\nBase directory for this skill: ${options.resolvedPath}/\nFile references (@path) in this skill are relative to this directory.\n\n${resolvedBody}\n</skill-instruction>\n\n<user-request>\n$ARGUMENTS\n</user-request>`

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
      path: options.skillPath,
      resolvedPath: options.resolvedPath,
      definition,
      scope: options.scope,
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

export function inferSkillNameFromFileName(filePath: string): string {
  return basename(filePath, ".md")
}
