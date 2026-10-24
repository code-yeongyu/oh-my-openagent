import type { LoadedSkill, SkillMetadata } from "../types"
import type { SkillDefinition } from "../../../types"
import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import { dirname, isAbsolute, resolve } from "path"
import { homedir } from "os"
import { isWithinProject, parseFrontmatter } from "@oh-my-opencode/utils"
import { sanitizeModelField } from "@oh-my-opencode/model-core"
import { log } from "../../../shared"
import { resolveSkillPathReferences } from "../../../shared/skill-path-resolver"
import { parseAllowedTools } from "../allowed-tools-parser"
import { readSkillFileChecked } from "../checked-skill-read"
import { skillProvenance, reportSkillLoadError, type SkillProvenance } from "../skill-provenance"

function resolveFilePath(from: string, configDir?: string): string {
  let filePath = from

  if (filePath.startsWith("{file:") && filePath.endsWith("}")) {
    filePath = filePath.slice(6, -1)
  }

  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2))
  }

  if (isAbsolute(filePath)) {
    return filePath
  }

  const baseDir = configDir || process.cwd()
  return resolve(baseDir, filePath)
}

function loadSkillFromFile(filePath: string, provenance: SkillProvenance): { template: string; metadata: SkillMetadata } | null {
  try {
    const content = readSkillFileChecked(filePath, provenance)
    const { data, body } = parseFrontmatter<SkillMetadata>(content)
    return { template: body, metadata: data }
  } catch (error) {
    reportSkillLoadError(error, filePath)
    if (error instanceof Error) return null
    return null
  }
}

export function configEntryToLoadedSkill(
  name: string,
  entry: SkillDefinition,
  configDir?: string,
  sourceProvenance?: SkillProvenance,
): LoadedSkill | null {
  let template = entry.template || ""
  let fileMetadata: SkillMetadata = {}
  let sourcePath: string | undefined
  const provenance = sourceProvenance ?? skillProvenance(configDir ?? process.cwd(), "project")

  if (entry.from) {
    sourcePath = resolveFilePath(entry.from, configDir)
    const projectRoot = configDir || process.cwd()
    // The config entry's own root check stays in front of the link check: provenance alone does not
    // bound a `from:` path that names a file outside the config directory (#10693).
    if (!isWithinProject(sourcePath, projectRoot)) {
      log("[config-skill-entry-loader] Rejected skill entry file outside project root", {
        from: entry.from,
        filePath: sourcePath,
        projectRoot,
      })
      return null
    }
    const loaded = loadSkillFromFile(sourcePath, provenance)
    if (loaded) {
      template = loaded.template
      fileMetadata = loaded.metadata
    } else {
      return null
    }
  }

  if (!template && !entry.from) {
    return null
  }

  const description = entry.description || fileMetadata.description || ""
  const resolvedPath = sourcePath ? dirname(sourcePath) : configDir || process.cwd()

  const resolvedTemplate = resolveSkillPathReferences(template.trim(), resolvedPath)
  const wrappedTemplate = `<skill-instruction>
Base directory for this skill: ${resolvedPath}/
File references (@path) in this skill are relative to this directory.

${resolvedTemplate}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`

  const definition: CommandDefinition = {
    name,
    description: `(config - Skill) ${description}`,
    template: wrappedTemplate,
    model: sanitizeModelField(entry.model || fileMetadata.model, "opencode"),
    agent: entry.agent || fileMetadata.agent,
    subtask: entry.subtask ?? fileMetadata.subtask,
    argumentHint: entry["argument-hint"] || fileMetadata["argument-hint"],
  }

  const allowedTools = parseAllowedTools(entry["allowed-tools"]) || parseAllowedTools(fileMetadata["allowed-tools"])

  return {
    name,
    provenance,
    path: sourcePath,
    resolvedPath,
    definition,
    scope: "config",
    license: entry.license || fileMetadata.license,
    compatibility: entry.compatibility || fileMetadata.compatibility,
    metadata: (entry.metadata as Record<string, string> | undefined) || fileMetadata.metadata,
    allowedTools,
  }
}
