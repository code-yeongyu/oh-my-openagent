import { createSystemDirective } from "./system-directive"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"

const DIRECTIVE = createSystemDirective("SKILL INDEX")
const MAX_DESCRIPTION_LENGTH = 120

export type SkillIndexFormat = "compact" | "enforcement"

export function formatSkillLine(skill: LoadedSkill): string {
  const scope = skill.scope === "builtin" ? "builtin" : skill.scope
  const rawDesc = skill.definition.description ?? ""
  const desc = rawDesc.replace(/^\([^)]+\)\s*/, "")
  const truncated = desc.length > MAX_DESCRIPTION_LENGTH ? `${desc.slice(0, MAX_DESCRIPTION_LENGTH)}…` : desc
  const memoryPart = skill.memoryTags?.length ? ` (memory: ${skill.memoryTags.join(", ")})` : ""
  const chainPart = skill.chainedTo?.length ? ` → chains to: [${skill.chainedTo.join(", ")}]` : ""
  return `- ${skill.name} (${scope})${truncated ? `: ${truncated}` : ""}${memoryPart}${chainPart}`
}

export function buildSkillIndex(skills: LoadedSkill[], format: SkillIndexFormat = "compact"): string {
  if (skills.length === 0) {
    return `${DIRECTIVE}\nNo skills are currently available.`
  }

  const lines = [
    DIRECTIVE,
    "Skills available in this session. Use skill(name=\"...\") to load any of them.",
    "Use /skill [query] to search by name or description.",
    "",
    ...skills.map(formatSkillLine),
  ]

  if (format === "enforcement") {
    lines.push(
      "",
      "1% RULE: For any task touching a skill's domain, you MUST load that skill first.",
      "Skipping skill(name=\"...\") when a matching skill exists is a protocol violation.",
    )
  }

  return lines.join("\n")
}
