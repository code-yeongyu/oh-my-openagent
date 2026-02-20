import type { BrowserAutomationProvider, GitMasterConfig } from "../../config/schema"

export interface SkillResolutionOptions {
	gitMasterConfig?: GitMasterConfig
	browserProvider?: BrowserAutomationProvider
	disabledSkills?: Set<string>
	/** Project directory to discover project-level skills from. Required for async resolution — process.cwd() is unsafe in OpenCode. */
	directory?: string
}
