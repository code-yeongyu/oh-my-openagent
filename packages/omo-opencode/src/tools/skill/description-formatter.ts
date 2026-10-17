import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import { sortByScopePriority } from "./scope-priority"
import type { SkillInfo } from "./types"
import type { CommandInfo } from "../slashcommand/types"

interface CombinedDescriptionOptions {
  includeSkills?: boolean
}

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

function normalizeSkillName(name: string): string {
  return name.toLowerCase()
}

function normalizeSkillLocation(location: string): string {
  return location.replace(/\\/g, "/").replace(/\/+$/, "")
}

function isOmoBundledSkillLocation(location: string | undefined): boolean {
  if (!location) return false
  const normalized = normalizeSkillLocation(location)
  if (normalized === "<builtin>" || normalized.startsWith("<builtin>/")) return true
  return (
    /(?:^|\/)dist\/skills(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:packages\/)?shared-skills(?:\/skills)?(?:\/|$)/.test(normalized)
  )
}

function isOpenCodeCoreBuiltinLocation(location: string | undefined): boolean {
  if (location === undefined) return false
  const normalized = normalizeSkillLocation(location).trim()
  return normalized === "" || normalized === "<built-in>"
}

const CORE_SCANNED_DIR_RE =
  /(?:^|\/)(?:\.opencode\/skills?(?:\/|$)|(?:\.claude|\.agents)\/skills(?:\/|$)|(?:\.config\/opencode(?:\/profiles\/[^/]+)?\/skills?(?:\/|$)))/i

function hasCoreScannedSkillLocation(location: string | undefined): boolean {
  if (!location) return false
  if (isOpenCodeCoreBuiltinLocation(location)) return true
  const normalized = normalizeSkillLocation(location)
  if (CORE_SCANNED_DIR_RE.test(normalized)) return true
  return /ai\.opencode\.desktop(?:\.dev)?(?:\/.*)?\/skills?(?:\/|$)/i.test(normalized)
}

export function isDiscoverableByOpenCodeCore(skill: SkillInfo): boolean {
  // OpenCode core already emits these in <available_skills>. OMO-bundled
  // builtin/shared skills live under dist/skills and are invisible to that scan.
  if (skill.scope === "builtin" || skill.scope === "shared") return false
  if (isOmoBundledSkillLocation(skill.location)) return false
  return hasCoreScannedSkillLocation(skill.location)
}

export function deduplicatePathAliasedSkills(skills: SkillInfo[]): SkillInfo[] {
  // After the shared/ prefix cutover, skills register under bare names only.
  // Exact-name deduplication is handled by the upstream merge; this pass is now
  // a no-op retained for call-site compatibility.
  return skills
}

function shouldSuppressBuiltinCommandAlias(command: CommandInfo, skills: SkillInfo[]): boolean {
  if (command.scope !== "builtin") return false
  if (command.name.includes("/")) return false
  const normalizedCommandName = normalizeSkillName(command.name)
  return skills.some((skill) => normalizeSkillName(skill.name) === normalizedCommandName)
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
  const allSkills = options.includeSkills ? deduplicatePathAliasedSkills(skills ?? []) : []
  const availableSkills = allSkills.filter((skill) => !isDiscoverableByOpenCodeCore(skill))
  const availableCommands = deduplicateCommandsForPathAliasedSkills(commands ?? [], allSkills)

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
