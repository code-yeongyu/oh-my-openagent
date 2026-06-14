import type { BuiltinSkill } from "./types"
import type { BrowserAutomationProvider } from "../../config/schema"

import {
  playwrightSkill,
  agentBrowserSkill,
  playwrightCliSkill,
  frontendUiUxSkill,
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

const FALLBACK_BROWSER_SKILL: BuiltinSkill = {
  name: "browser-automation",
  description: "Browser automation setup for a custom provider. Load when browser tasks are needed but no built-in browser skill is available.",
  template: "# Browser Automation — Custom Provider Setup\n\nThe configured browser automation provider is not built into OMO.\n\n## What You Need to Do\nTell the user:\n\n> The browser automation provider requires a skill file to work.\n> Create a SKILL.md at `~/.claude/skills/{provider}/SKILL.md` with API documentation.\n\nDO NOT silently fall back to Playwright.",
}

export const BUILTIN_BROWSER_SKILLS: Record<string, BuiltinSkill> = {
  playwright: playwrightSkill,
  "agent-browser": agentBrowserSkill,
  "dev-browser": devBrowserSkill,
  "playwright-cli": playwrightCliSkill,
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright", disabledSkills, teamModeEnabled = false } = options

  const browserSkill = BUILTIN_BROWSER_SKILLS[browserProvider] ?? FALLBACK_BROWSER_SKILL

	const skills = [
		browserSkill,
		frontendUiUxSkill,
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
