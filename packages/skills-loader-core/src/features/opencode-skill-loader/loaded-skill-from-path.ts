import { existsSync } from "node:fs"
import { basename, dirname, join } from "path"
import { parseFrontmatter } from "@oh-my-opencode/utils"
import { sanitizeModelField } from "@oh-my-opencode/model-core"
import { resolveSkillPathReferences } from "../../shared/skill-path-resolver"
import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import { parseAllowedTools } from "./allowed-tools-parser"
import { loadMcpJsonFromDir, parseSkillMcpConfigFromFrontmatter } from "./skill-mcp-config"
import type { SkillScope, SkillMetadata, LoadedSkill, LazyContentLoader } from "./types"
import { readSkillFileChecked } from "./checked-skill-read"
import { reportSkillLoadError, skillProvenance, type SkillProvenance, type SkillDiagnosticSink } from "./skill-provenance"

export async function loadSkillFromPath(options: {
  skillPath: string
  resolvedPath: string
  defaultName: string
  scope: SkillScope
  namePrefix?: string
  skipMalformedFrontmatter?: boolean
  provenance?: SkillProvenance
  onDiagnostic?: SkillDiagnosticSink
}): Promise<LoadedSkill | null> {
  const namePrefix = options.namePrefix ?? ""
  const provenance = skillProvenance(options.skillPath, options.scope, options.provenance)

  try {
    const content = readSkillFileChecked(options.skillPath, provenance)
    const { data, body, parseError } = parseFrontmatter<SkillMetadata>(content)
    if (parseError && options.skipMalformedFrontmatter) return null

    const frontmatterMcp = parseSkillMcpConfigFromFrontmatter(content)
    const mcpDirectory = dirname(options.skillPath)
    const mcpJsonMcp = await loadMcpJsonFromDir(mcpDirectory, provenance, options.onDiagnostic)
    const mcpConfig = mcpJsonMcp || frontmatterMcp

    const baseName = String(data.name || options.defaultName)
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
      provenance,
      mcpSourcePath: mcpJsonMcp && existsSync(join(mcpDirectory, "mcp.json")) ? join(mcpDirectory, "mcp.json") : options.skillPath,
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
  } catch (error) {
    reportSkillLoadError(error, options.skillPath, options.onDiagnostic)
    if (error instanceof Error) {
      return null
    }
    return null
  }
}

export function inferSkillNameFromFileName(filePath: string): string {
  return basename(filePath, ".md")
}
