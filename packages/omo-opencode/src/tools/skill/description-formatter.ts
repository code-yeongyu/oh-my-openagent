import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import { sortByScopePriority } from "./scope-priority"
import type { SkillInfo } from "./types"
import type { CommandInfo } from "../slashcommand/types"

interface CombinedDescriptionOptions {
  includeSkills?: boolean
}

const SHARED_DERIVED_BUILTIN_COMMANDS = new Set(["refactor", "remove-ai-slops", "start-work"])

function formatSkillCommand(skill: SkillInfo): string {
  const lines = [
    "  <command>",
    `    <name>/${skill.name}</name>`,
    `    <description>${skill.description}</description>`,
    `    <scope>${skill.scope}</scope>`,
  ]

  if (skill.compatibility) {
    lines.push(`    <compatibility>${skill.compatibility}</compatibility>`)
  }

  lines.push("  </command>")
  return lines.join("\n")
}

function formatSlashCommand(command: CommandInfo): string {
  const argumentHint = typeof command.metadata.argumentHint === "string"
    ? command.metadata.argumentHint.trim()
    : undefined
  const lines = [
    "  <command>",
    `    <name>/${command.name}</name>`,
    `    <description>${command.metadata.description || "(no description)"}</description>`,
    `    <scope>${command.scope}</scope>`,
  ]

  if (argumentHint) {
    lines.push(`    <argument>${argumentHint}</argument>`)
  }

  lines.push("  </command>")
  return lines.join("\n")
}

function shortSkillName(name: string): string {
  const parts = name.split("/")
  return parts[parts.length - 1] ?? name
}

function normalizeSkillName(name: string): string {
  return name.toLowerCase()
}

function normalizeSkillLocation(location: string | undefined): string | undefined {
  if (!location) return undefined
  let normalized = location.replaceAll("\\", "/").replace(/\/+$/, "")
  const lower = normalized.toLowerCase()
  if (lower.endsWith("/skill.md")) {
    normalized = normalized.slice(0, -"/SKILL.md".length)
  } else if (lower.endsWith(".md")) {
    normalized = normalized.slice(0, normalized.lastIndexOf("/"))
  }
  return normalized.toLowerCase()
}

function isOpenCodeInjectedNativeSkill(skill: SkillInfo): boolean {
  const location = skill.location?.replaceAll("\\", "/").toLowerCase()
  return location?.startsWith("/opencode/") ?? false
}

function hasSameSource(qualified: SkillInfo, bare: SkillInfo): boolean {
  const qualifiedLocation = normalizeSkillLocation(qualified.location)
  const bareLocation = normalizeSkillLocation(bare.location)
  return Boolean(qualifiedLocation && bareLocation && qualifiedLocation === bareLocation)
}

function hasSharedSkillSource(skill: SkillInfo, shortName: string): boolean {
  const location = normalizeSkillLocation(skill.location)
  return location?.endsWith(`/shared-skills/skills/${shortName}`) ?? false
}

function isSharedDerivedQualifiedSkill(skill: SkillInfo, shortName: string): boolean {
  if (!skill.name.includes("/")) return false
  if (normalizeSkillName(shortSkillName(skill.name)) !== shortName) return false
  if (skill.scope === "shared") return true

  return hasSharedSkillSource(skill, shortName)
}

function isSuppressibleSharedDerivedBareSkill(
  qualified: SkillInfo,
  bare: SkillInfo,
  shortName: string,
): boolean {
  if (!isSharedDerivedQualifiedSkill(qualified, shortName)) return false
  if (bare.scope !== "builtin" && bare.scope !== "opencode") return false
  if (hasSharedSkillSource(bare, shortName)) return true
  return bare.location === undefined && SHARED_DERIVED_BUILTIN_COMMANDS.has(shortName)
}

export function deduplicatePathAliasedSkills(skills: SkillInfo[]): SkillInfo[] {
  const qualifiedByShortName = new Map<string, SkillInfo[]>()
  for (const skill of skills) {
    if (!skill.name.includes("/")) continue
    const shortName = normalizeSkillName(shortSkillName(skill.name))
    const matches = qualifiedByShortName.get(shortName) ?? []
    matches.push(skill)
    qualifiedByShortName.set(shortName, matches)
  }

  return skills.filter((skill) => {
    if (skill.name.includes("/")) return true
    const qualifiedMatches = qualifiedByShortName.get(normalizeSkillName(skill.name))
    if (!qualifiedMatches) return true
    if (isOpenCodeInjectedNativeSkill(skill)) return true
    if (qualifiedMatches.some((qualified) => hasSameSource(qualified, skill))) return false
    if (qualifiedMatches.some((qualified) => isSuppressibleSharedDerivedBareSkill(
      qualified,
      skill,
      normalizeSkillName(skill.name),
    ))) {
      return false
    }
    return true
  })
}

function shouldSuppressBuiltinCommandAlias(command: CommandInfo, skills: SkillInfo[]): boolean {
  if (command.scope !== "builtin") return false
  if (command.name.includes("/")) return false
  const normalizedCommandName = normalizeSkillName(command.name)
  if (!SHARED_DERIVED_BUILTIN_COMMANDS.has(normalizedCommandName)) return false

  return skills.some((skill) => isSharedDerivedQualifiedSkill(skill, normalizedCommandName))
}

function deduplicateCommandsForPathAliasedSkills(
  commands: CommandInfo[],
  skills: SkillInfo[],
): CommandInfo[] {
  return commands.filter((command) => !shouldSuppressBuiltinCommandAlias(command, skills))
}

export function formatCombinedDescription(
  skills?: SkillInfo[],
  commands?: CommandInfo[],
  options: CombinedDescriptionOptions = {}
): string {
  const availableSkills = options.includeSkills ? deduplicatePathAliasedSkills(skills ?? []) : []
  const availableCommands = deduplicateCommandsForPathAliasedSkills(commands ?? [], availableSkills)

  if (availableSkills.length === 0 && availableCommands.length === 0) {
    if ((skills?.length ?? 0) > 0) {
      return TOOL_DESCRIPTION_PREFIX
    }

    return TOOL_DESCRIPTION_NO_SKILLS
  }

  const availableItems = [
    ...sortByScopePriority(availableSkills).map(formatSkillCommand),
    ...sortByScopePriority(availableCommands).map(formatSlashCommand),
  ]

  if (availableItems.length === 0) {
    return TOOL_DESCRIPTION_PREFIX
  }

  return `${TOOL_DESCRIPTION_PREFIX}
<available_items>
Priority: project > user > opencode > builtin/plugin${options.includeSkills ? " | Skills listed before commands" : ""}
Invoke via: skill(name="item-name") - omit leading slash for commands.
${availableItems.join("\n")}
</available_items>`
}
