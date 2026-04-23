import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import { sortByScopePriority } from "./scope-priority"
import type { SkillInfo } from "./types"
import type { CommandInfo } from "../slashcommand/types"

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

interface FormatCombinedDescriptionOptions {
  includeSkills?: boolean
}

export function formatCombinedDescription(
  skills?: SkillInfo[],
  commands?: CommandInfo[],
  options: FormatCombinedDescriptionOptions = {}
): string {
  const availableSkills = skills ?? []
  const availableCommands = commands ?? []
  const includeSkills = options.includeSkills ?? false

  if (availableSkills.length === 0 && availableCommands.length === 0) {
    return TOOL_DESCRIPTION_NO_SKILLS
  }

  const availableItems = [
    ...(includeSkills ? sortByScopePriority(availableSkills).map(formatSkillCommand) : []),
    ...sortByScopePriority(availableCommands).map(formatSlashCommand),
  ]

  if (availableItems.length === 0) {
    return TOOL_DESCRIPTION_PREFIX
  }

  return `${TOOL_DESCRIPTION_PREFIX}
<available_items>
Priority: project > user > opencode > builtin/plugin | Commands listed here; skills are listed separately by OpenCode
Invoke via: skill(name="item-name") - omit leading slash for commands.
${availableItems.join("\n")}
</available_items>`
}
