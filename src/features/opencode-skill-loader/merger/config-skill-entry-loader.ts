import type { LoadedSkill, SkillMetadata } from "../types"
import type { SkillDefinition } from "../../../config/schema"
import type { CommandDefinition } from "../../claude-code-command-loader/types"
import { existsSync, readFileSync } from "fs"
import { dirname, isAbsolute, resolve } from "path"
import { homedir } from "os"
import { parseFrontmatter } from "../../../shared/frontmatter"
import { sanitizeModelField } from "../../../shared/model-sanitizer"
import { resolveSkillPathReferences } from "../../../shared/skill-path-resolver"
import { parseAllowedTools } from "../allowed-tools-parser"

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

function loadSkillFromFile(filePath: string): { template: string; metadata: SkillMetadata } | null {
  try {
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<SkillMetadata>(content)
    return { template: body, metadata: data }
  } catch {
    return null
  }
}

export function configEntryToLoadedSkill(
  name: string,
  entry: SkillDefinition,
  configDir?: string
): LoadedSkill | null {
  let template = entry.template || ""
  let fileMetadata: SkillMetadata = {}

  if (entry.from) {
    const filePath = resolveFilePath(entry.from, configDir)
    const loaded = loadSkillFromFile(filePath)
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
  const resolvedPath = entry.from
    ? dirname(resolveFilePath(entry.from, configDir))
    : configDir || process.cwd()

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

  const allowedTools = entry["allowed-tools"] || parseAllowedTools(fileMetadata["allowed-tools"])

  return {
    name,
    path: entry.from ? resolveFilePath(entry.from, configDir) : undefined,
    resolvedPath,
    definition,
    scope: "config",
    license: entry.license || fileMetadata.license,
    compatibility: entry.compatibility || fileMetadata.compatibility,
    metadata: (entry.metadata as Record<string, string> | undefined) || fileMetadata.metadata,
    allowedTools,
  }
}
