import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"

function formatSkillNames(skills: AvailableSkill[], limit: number): string {
  if (skills.length === 0) return "(none)"
  const shown = skills.slice(0, limit).map((s) => s.name)
  const remaining = skills.length - shown.length
  const suffix = remaining > 0 ? ` (+${remaining} more)` : ""
  return shown.join(", ") + suffix
}

export function buildReminderMessage(availableSkills: AvailableSkill[]): string {
  const builtinSkills = availableSkills.filter((s) => s.location === "plugin")
  const customSkills = availableSkills.filter((s) => s.location !== "plugin")

  const builtinText = formatSkillNames(builtinSkills, 8)
  const customText = formatSkillNames(customSkills, 8)

  const exampleSkillName = customSkills[0]?.name ?? builtinSkills[0]?.name
  const loadSkills = exampleSkillName ? `["${exampleSkillName}"]` : "[]"

  const lines = [
    "",
    "[分类+技能提醒]",
    "",
    `**内置技能**：${builtinText}`,
    `**⚡ 你的技能（优先）**：${customText}`,
    "",
    "> 用户安装的技能会覆盖内置默认值。当领域匹配时，始终优先使用你的技能。",
    "",
    "```typescript",
    `task(category=\"visual-engineering\", load_skills=${loadSkills}, run_in_background=true)`,
    "```",
    "",
  ]

  return lines.join("\n")
}
