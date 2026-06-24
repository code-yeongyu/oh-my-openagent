import type { BuiltinSkill } from "./types"
import type { BrowserAutomationProvider } from "../../types"

import {
  playwrightSkill,
  agentBrowserSkill,
  playwrightCliSkill,
  frontendSkill,
  gitMasterSkill,
  devBrowserSkill,
  initDeepSkill,
  debuggingSkill,
  removeAiSlopsSkill,
  reviewWorkSkill,
  securityResearchSkill,
  securityReviewSkill,
  visualQaSkill,
  teamModeSkill,
} from "./skills/index"

export interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
  teamModeEnabled?: boolean
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright", disabledSkills, teamModeEnabled = false } = options

  let browserSkill: BuiltinSkill
	if (browserProvider === "agent-browser") {
		browserSkill = agentBrowserSkill
	} else if (browserProvider === "dev-browser") {
		browserSkill = devBrowserSkill
	} else if (browserProvider === "playwright-cli") {
		browserSkill = playwrightCliSkill
	} else {
		browserSkill = playwrightSkill
	}

	const skills = [
		browserSkill,
		frontendSkill,
		gitMasterSkill,
		reviewWorkSkill,
		removeAiSlopsSkill,
		initDeepSkill,
		debuggingSkill,
		securityResearchSkill,
		securityReviewSkill,
		visualQaSkill,
	]

  if (teamModeEnabled && !disabledSkills?.has("team-mode")) {
    skills.push(teamModeSkill)
  }

  if (!disabledSkills) {
    return skills
  }

  return skills.filter((skill) => !disabledSkills.has(skill.name))
}

export interface ResolveActiveBuiltinSkillsOptions extends CreateBuiltinSkillsOptions {
  systemMcpNames: Set<string>
}

export function resolveActiveBuiltinSkills(options: ResolveActiveBuiltinSkillsOptions): BuiltinSkill[] {
  const { systemMcpNames, ...createOptions } = options

  return createBuiltinSkills(createOptions).filter((skill) => {
    if (!skill.mcpConfig) return true
    return !Object.keys(skill.mcpConfig).some((mcpName) => systemMcpNames.has(mcpName))
  })
}
