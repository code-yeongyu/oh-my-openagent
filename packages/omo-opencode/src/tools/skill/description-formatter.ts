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
