import type { BuiltinSkill } from "./types"
import type { BrowserAutomationProvider } from "../../types"

import {
  createPlaywrightSkill,
  playwrightSkill,
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
  /**
   * Extra CLI arguments appended to the default `@playwright/mcp@latest`
   * invocation when `browserProvider` resolves to the `playwright` MCP variant.
   *
   * Only threaded through to `createPlaywrightSkill`; other browser providers
   * ignore this option.
   */
  playwrightMcpArgs?: readonly string[]
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const {
    browserProvider = "playwright",
    disabledSkills,
    teamModeEnabled = false,
    playwrightMcpArgs,
  } = options

  const browserSkills = {
    "dev-browser": devBrowserSkill,
    "playwright-cli": playwrightCliSkill,
    playwright: playwrightMcpArgs?.length
      ? createPlaywrightSkill({ mcp_args: playwrightMcpArgs })
      : playwrightSkill,
  } satisfies Record<BrowserAutomationProvider, BuiltinSkill>

	const skills = [
		browserSkills[browserProvider],
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
