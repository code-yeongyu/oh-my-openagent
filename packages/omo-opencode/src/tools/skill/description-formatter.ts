import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import { sortByScopePriority } from "./scope-priority"
import { truncateDescription } from "../../shared/truncate-description"
import type { SkillDescriptionMode, SkillInfo } from "./types"
import type { CommandInfo } from "../slashcommand/types"

type CombinedDescriptionOptions = {
  readonly includeSkills?: boolean
  readonly mode?: SkillDescriptionMode
}

const COMPACT_ITEM_DESCRIPTION_LENGTH = 96
const TRIGGER_MARKER_PATTERN = /\b(?:Triggers?|Trigger phrases include)\s*:?\s*/i

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function extractTriggerSummary(description: string): string | undefined {
  const normalized = normalizeWhitespace(description)
  const match = TRIGGER_MARKER_PATTERN.exec(normalized)
  if (!match) return undefined

  const triggerText = normalized.slice(match.index + match[0].length).trim().replace(/\.$/, "")
  return triggerText || undefined
}

function compactDescription(description: string): string {
  const firstSentence = description.split(".")[0]?.trim() || description.trim()
  return truncateDescription(normalizeWhitespace(firstSentence), COMPACT_ITEM_DESCRIPTION_LENGTH)
}

function compactSkillDescription(description: string): string {
  const triggerSummary = extractTriggerSummary(description)
  if (triggerSummary) {
    return truncateDescription(`Triggers: ${triggerSummary}`, COMPACT_ITEM_DESCRIPTION_LENGTH)
  }

  return compactDescription(description)
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

function formatCompactSkillCommand(skill: SkillInfo): string {
  return `- skill ${skill.name} [${skill.scope}]: ${compactSkillDescription(skill.description)}`
}

function formatCompactSlashCommand(command: CommandInfo): string {
  const description = command.metadata.description || "(no description)"
  return `- command /${command.name} [${command.scope}]: ${compactDescription(description)}`
}

export function formatCombinedDescription(
  skills?: SkillInfo[],
  commands?: CommandInfo[],
  options: CombinedDescriptionOptions = {}
): string {
  const availableSkills = options.includeSkills ? skills ?? [] : []
  const availableCommands = commands ?? []

  if (availableSkills.length === 0 && availableCommands.length === 0) {
    if ((skills?.length ?? 0) > 0) {
      return TOOL_DESCRIPTION_PREFIX
    }

    return TOOL_DESCRIPTION_NO_SKILLS
  }

  const compactMode = options.mode === "compact"
  const availableItems = compactMode
    ? [
        ...sortByScopePriority(availableSkills).map(formatCompactSkillCommand),
        ...sortByScopePriority(availableCommands).map(formatCompactSlashCommand),
      ]
    : [
        ...sortByScopePriority(availableSkills).map(formatSkillCommand),
        ...sortByScopePriority(availableCommands).map(formatSlashCommand),
      ]

  if (availableItems.length === 0) {
    return TOOL_DESCRIPTION_PREFIX
  }

  return `${TOOL_DESCRIPTION_PREFIX}
<available_items${compactMode ? ' format="compact"' : ""}>
Priority: project > user > opencode > builtin/plugin${options.includeSkills ? " | Skills listed before commands" : ""}
Invoke via: skill(name="item-name") - omit leading slash for commands.
${availableItems.join("\n")}
</available_items>`
}
