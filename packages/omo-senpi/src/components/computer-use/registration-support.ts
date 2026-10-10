import { COMPUTER_SKILL_NAME } from "@oh-my-opencode/senpi-desktop-tool/registration"
import type { ContributedSkill } from "../bundled-skills/contributed-skill"

export function skillStatusLine(skill: ContributedSkill | undefined): string {
  if (skill?.kind !== "yielded") return ""
  const where = skill.ownerPath === undefined ? "" : ` (${skill.ownerPath})`
  return `\nskill: your own ${COMPUTER_SKILL_NAME} skill is active in place of the built-in guide${where}`
}

export function toolActivatedNames(payload: unknown): readonly string[] {
  if (typeof payload !== "object" || payload === null) return []
  const names = (payload as { toolNames?: unknown }).toolNames
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []
}
