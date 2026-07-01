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

/**
 * Removes path-alias duplicates from a skill list before injection.
 *
 * When the same logical skill is registered under both a qualified path
 * (e.g. `shared/debugging`) and a bare short name (`debugging`), only the
 * qualified name is kept in the description.  The execution-time matcher in
 * `skill-matcher.ts` already resolves bare short names to their qualified
 * counterpart, so callers do not lose the ability to invoke the skill by its
 * short name — they just won't see the redundant alias in the tool description.
 */
export function deduplicatePathAliasedSkills(skills: SkillInfo[]): SkillInfo[] {
  // Build a set of all short names (last path segment) that also have a
  // qualified (multi-segment) variant in the list.
  const qualifiedShortNames = new Set<string>()
  for (const skill of skills) {
    const parts = skill.name.split("/")
    if (parts.length > 1) {
      const shortName = parts[parts.length - 1]
      if (shortName) qualifiedShortNames.add(shortName)
    }
  }

  // Suppress bare entries whose name exactly matches a qualified short name.
  return skills.filter((skill) => {
    if (!skill.name.includes("/") && qualifiedShortNames.has(skill.name)) {
      return false
    }
    return true
  })
}

export function formatCombinedDescription(
  skills?: SkillInfo[],
  commands?: CommandInfo[],
  options: CombinedDescriptionOptions = {}
): string {
  const availableSkills = options.includeSkills ? deduplicatePathAliasedSkills(skills ?? []) : []
  const availableCommands = commands ?? []

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
