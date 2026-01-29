import type { LoadedSkill, SkillScope, SkillMetadata } from "./types"
import type { SkillsConfig, SkillDefinition } from "../../config/schema"
import type { BuiltinSkill } from "../builtin-skills/types"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import { readFileSync, existsSync } from "fs"
import { dirname, resolve, isAbsolute } from "path"
import { homedir } from "os"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { deepMerge } from "../../shared/deep-merge"

function parseAllowedToolsFromMetadata(allowedTools: string | string[] | undefined): string[] | undefined {
  if (!allowedTools) return undefined
  if (Array.isArray(allowedTools)) {
    return allowedTools.map(t => t.trim()).filter(Boolean)
  }
  return allowedTools.split(/\s+/).filter(Boolean)
}

const SCOPE_PRIORITY: Record<SkillScope, number> = {
  builtin: 1,
  config: 2,
  user: 3,
  opencode: 4,
  project: 5,
  "opencode-project": 6,
}

function builtinToLoaded(builtin: BuiltinSkill): LoadedSkill {
  const definition: CommandDefinition = {
    name: builtin.name,
    description: `(opencode - Skill) ${builtin.description}`,
    template: builtin.template,
    model: builtin.model,
    agent: builtin.agent,
    subtask: builtin.subtask,
    argumentHint: builtin.argumentHint,
  }

  return {
    name: builtin.name,
    definition,
    scope: "builtin",
    license: builtin.license,
    compatibility: builtin.compatibility,
    metadata: builtin.metadata as Record<string, string> | undefined,
    allowedTools: builtin.allowedTools,
    mcpConfig: builtin.mcpConfig,
  }
}

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

function configEntryToLoaded(
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
  const resolvedPath = entry.from ? dirname(resolveFilePath(entry.from, configDir)) : configDir || process.cwd()

  const wrappedTemplate = `<skill-instruction>
Base directory for this skill: ${resolvedPath}/
File references (@path) in this skill are relative to this directory.

${template.trim()}
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

  const allowedTools = entry["allowed-tools"] ||
    (fileMetadata["allowed-tools"] ? parseAllowedToolsFromMetadata(fileMetadata["allowed-tools"]) : undefined)

  return {
    name,
    path: entry.from ? resolveFilePath(entry.from, configDir) : undefined,
    resolvedPath,
    definition,
    scope: "config",
    license: entry.license || fileMetadata.license,
    compatibility: entry.compatibility || fileMetadata.compatibility,
    metadata: entry.metadata as Record<string, string> | undefined || fileMetadata.metadata,
    allowedTools,
  }
}

function normalizeConfig(config: SkillsConfig | undefined): {
  sources: Array<string | { path: string; recursive?: boolean; glob?: string }>
  enable: string[]
  disable: string[]
  entries: Record<string, boolean | SkillDefinition>
} {
  if (!config) {
    return { sources: [], enable: [], disable: [], entries: {} }
  }

  if (Array.isArray(config)) {
    return { sources: [], enable: config, disable: [], entries: {} }
  }

  const { sources = [], enable = [], disable = [], ...entries } = config
  return { sources, enable, disable, entries }
}

function mergeSkillDefinitions(base: LoadedSkill, patch: SkillDefinition): LoadedSkill {
  const mergedMetadata = base.metadata || patch.metadata
    ? deepMerge(base.metadata || {}, (patch.metadata as Record<string, string>) || {})
    : undefined

  const mergedTools = base.allowedTools || patch["allowed-tools"]
    ? [...(base.allowedTools || []), ...(patch["allowed-tools"] || [])]
    : undefined

  const description = patch.description || base.definition.description?.replace(/^\([^)]+\) /, "")

  return {
    ...base,
    definition: {
      ...base.definition,
      description: `(${base.scope} - Skill) ${description}`,
      model: patch.model || base.definition.model,
      agent: patch.agent || base.definition.agent,
      subtask: patch.subtask ?? base.definition.subtask,
      argumentHint: patch["argument-hint"] || base.definition.argumentHint,
    },
    license: patch.license || base.license,
    compatibility: patch.compatibility || base.compatibility,
    metadata: mergedMetadata as Record<string, string> | undefined,
    allowedTools: mergedTools ? [...new Set(mergedTools)] : undefined,
  }
}

export interface MergeSkillsOptions {
  configDir?: string
}

export function mergeSkills(
  builtinSkills: BuiltinSkill[],
  config: SkillsConfig | undefined,
  userClaudeSkills: LoadedSkill[],
  userOpencodeSkills: LoadedSkill[],
  projectClaudeSkills: LoadedSkill[],
  projectOpencodeSkills: LoadedSkill[],
  options: MergeSkillsOptions = {}
): LoadedSkill[] {
  const skillMap = new Map<string, LoadedSkill>()

  for (const builtin of builtinSkills) {
    const loaded = builtinToLoaded(builtin)
    skillMap.set(loaded.name, loaded)
  }

  const normalizedConfig = normalizeConfig(config)

  for (const [name, entry] of Object.entries(normalizedConfig.entries)) {
    if (entry === false) continue
    if (entry === true) continue

    if (entry.disable) continue

    const loaded = configEntryToLoaded(name, entry, options.configDir)
    if (loaded) {
      const existing = skillMap.get(name)
      if (existing && !entry.template && !entry.from) {
        skillMap.set(name, mergeSkillDefinitions(existing, entry))
      } else {
        skillMap.set(name, loaded)
      }
    }
  }

  const fileSystemSkills = [
    ...userClaudeSkills,
    ...userOpencodeSkills,
    ...projectClaudeSkills,
    ...projectOpencodeSkills,
  ]

  for (const skill of fileSystemSkills) {
    const existing = skillMap.get(skill.name)
    if (!existing || SCOPE_PRIORITY[skill.scope] > SCOPE_PRIORITY[existing.scope]) {
      skillMap.set(skill.name, skill)
    }
  }

  for (const [name, entry] of Object.entries(normalizedConfig.entries)) {
    if (entry === true) continue
    if (entry === false) {
      skillMap.delete(name)
      continue
    }
    if (entry.disable) {
      skillMap.delete(name)
      continue
    }

    const existing = skillMap.get(name)
    if (existing && !entry.template && !entry.from) {
      skillMap.set(name, mergeSkillDefinitions(existing, entry))
    }
  }

  for (const name of normalizedConfig.disable) {
    skillMap.delete(name)
  }

  if (normalizedConfig.enable.length > 0) {
    const enableSet = new Set(normalizedConfig.enable)
    for (const name of skillMap.keys()) {
      if (!enableSet.has(name)) {
        skillMap.delete(name)
      }
    }
  }

  return Array.from(skillMap.values())
}
