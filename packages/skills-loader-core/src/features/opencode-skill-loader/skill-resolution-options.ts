import type { ShellType } from "../../shared/shell-env"
import type { BrowserAutomationProvider, GitMasterConfig } from "../../types"

export interface SkillResolutionOptions {
	gitMasterConfig?: GitMasterConfig
	/** The shell that will run git-master's commands; the host edition supplies it when it knows better than the environment (#9733). */
	shellType?: ShellType
	browserProvider?: BrowserAutomationProvider
	disabledSkills?: Set<string>
	teamModeEnabled?: boolean
	/** Project directory to discover project-level skills from. Falls back to process.cwd() if not provided. */
	directory?: string
}
