import type { LoadedSkill } from "./types"
import type { SkillDefinition, SkillsConfig } from "../../types"
import type { BuiltinSkill } from "../builtin-skills/types"
import { builtinToLoadedSkill } from "./merger/builtin-skill-converter"
import { configEntryToLoadedSkill } from "./merger/config-skill-entry-loader"
import { mergeSkillDefinitions } from "./merger/skill-definition-merger"
import { normalizeSkillsConfig } from "./merger/skills-config-normalizer"
import { SCOPE_PRIORITY } from "./merger/scope-priority"
import { isDisabledSkillAlias } from "./skill-discovery"

export interface MergeSkillsOptions {
  configDir?: string
  isConfigEntryAllowed?: (name: string) => boolean
}

function isDisabledConfigEntry(entry: boolean | SkillDefinition): boolean {
  if (entry === false) return true
  if (entry === true) return false
  return entry.disable === true
}

function normalizeSkillAliasName(name: string): string {
  return name.toLowerCase()
}

function collectDisabledSkillNames(
  normalizedConfig: ReturnType<typeof normalizeSkillsConfig>,
): Set<string> {
  const disabledSkillNames = new Set(normalizedConfig.disable.map(normalizeSkillAliasName))
  for (const [name, entry] of Object.entries(normalizedConfig.entries)) {
    if (isDisabledConfigEntry(entry)) {
      disabledSkillNames.add(normalizeSkillAliasName(name))
    }
  }
  return disabledSkillNames
}

export function mergeSkills(
  builtinSkills: BuiltinSkill[],
  config: SkillsConfig | undefined,
  configSourceSkills: LoadedSkill[],
  userClaudeSkills: LoadedSkill[],
  userOpencodeSkills: LoadedSkill[],
  projectClaudeSkills: LoadedSkill[],
  projectOpencodeSkills: LoadedSkill[],
  options: MergeSkillsOptions = {}
): LoadedSkill[] {
  const skillMap = new Map<string, LoadedSkill>()

  for (const builtin of builtinSkills) {
    const loaded = builtinToLoadedSkill(builtin)
    skillMap.set(loaded.name, loaded)
  }

  const normalizedConfig = normalizeSkillsConfig(config)
  const disabledSkillNames = collectDisabledSkillNames(normalizedConfig)

  for (const [name, entry] of Object.entries(normalizedConfig.entries)) {
    if (options.isConfigEntryAllowed && !options.isConfigEntryAllowed(name)) continue
    if (entry === false) continue
    if (entry === true) continue

    if (entry.disable) continue

    const loaded = configEntryToLoadedSkill(name, entry, options.configDir)
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
    ...configSourceSkills,
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
    if (options.isConfigEntryAllowed && !options.isConfigEntryAllowed(name)) {
      if (isDisabledConfigEntry(entry)) {
        skillMap.delete(name)
      }
      continue
    }
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

  if (disabledSkillNames.size > 0) {
    for (const [name, skill] of skillMap) {
      if (isDisabledSkillAlias(skill, disabledSkillNames)) {
        skillMap.delete(name)
      }
    }
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
