import type { BrowserAutomationProvider, GitMasterConfig } from "../../config/schema"

export interface SkillResolutionOptions {
	gitMasterConfig?: GitMasterConfig
	browserProvider?: BrowserAutomationProvider
	disabledSkills?: Set<string>
}
