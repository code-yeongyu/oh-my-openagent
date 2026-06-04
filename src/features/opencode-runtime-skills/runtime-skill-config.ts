import type { OhMyOpenCodeConfig } from "../../config"
import { securityResearchSkill, securityReviewSkill } from "../builtin-skills/skills/index"
import { createOpenCodeSkillMarkdown, type OpenCodeSkillMarkdown } from "./skill-markdown"

export type RuntimeSkillSourceEntry = OpenCodeSkillMarkdown

export type OpenCodeSkillsHostConfig = {
  readonly paths?: readonly string[]
  readonly urls?: readonly string[]
  readonly [key: string]: unknown
}

export type OpenCodeSkillHostConfig = Record<string, unknown> & {
  skills?: OpenCodeSkillsHostConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function appendUnique(values: readonly string[], next: string): string[] {
  if (values.includes(next)) return [...values]
  return [...values, next]
}

export function selectRuntimeSecuritySkills(
  pluginConfig: Pick<OhMyOpenCodeConfig, "disabled_skills"> = {},
): RuntimeSkillSourceEntry[] {
  const disabledSkills = new Set(pluginConfig.disabled_skills ?? [])
  const includeResearch = !disabledSkills.has("security-research")
  const includeReview = !disabledSkills.has("security-review")
  if (!includeResearch && !includeReview) return []

  const skills = []
  if (includeResearch) {
    skills.push(securityResearchSkill)
  }
  if (includeReview) {
    skills.push(securityReviewSkill)
  }

  return skills.map((skill) => createOpenCodeSkillMarkdown(skill))
}

export function applyRuntimeSkillSourceConfig(params: {
  readonly config: OpenCodeSkillHostConfig
  readonly pluginConfig: Pick<OhMyOpenCodeConfig, "disabled_skills">
  readonly sourceUrl: string
}): void {
  if (selectRuntimeSecuritySkills(params.pluginConfig).length === 0) return

  const existingSkills = isRecord(params.config.skills) ? params.config.skills : {}
  const existingUrls = toStringList(existingSkills.urls)
  const nextUrls = appendUnique(existingUrls, params.sourceUrl)

  params.config.skills = {
    ...existingSkills,
    urls: nextUrls,
  }
}
