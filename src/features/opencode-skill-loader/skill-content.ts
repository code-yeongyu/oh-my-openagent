import { createBuiltinSkills } from "../builtin-skills/skills"
import type { GitMasterConfig } from "../../config/schema"

export interface SkillResolutionOptions {
	gitMasterConfig?: GitMasterConfig
}

function injectGitMasterConfig(template: string, config?: GitMasterConfig): string {
	if (!config) return template

	const commitFooter = config.commit_footer ?? true
	const includeCoAuthoredBy = config.include_co_authored_by ?? true

	const configHeader = `## Git Master Configuration (from oh-my-opencode.json)

**IMPORTANT: These values override the defaults in section 5.5:**
- \`commit_footer\`: ${commitFooter} ${!commitFooter ? "(DISABLED - do NOT add footer)" : ""}
- \`include_co_authored_by\`: ${includeCoAuthoredBy} ${!includeCoAuthoredBy ? "(DISABLED - do NOT add Co-authored-by)" : ""}

---

`
	return configHeader + template
}

export function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null {
	const skills = createBuiltinSkills()
	const skill = skills.find((s) => s.name === skillName)
	if (!skill) return null

	if (skillName === "git-master" && options?.gitMasterConfig) {
		return injectGitMasterConfig(skill.template, options.gitMasterConfig)
	}

	return skill.template
}

export function resolveMultipleSkills(skillNames: string[], options?: SkillResolutionOptions): {
	resolved: Map<string, string>
	notFound: string[]
} {
	const skills = createBuiltinSkills()
	const skillMap = new Map(skills.map((s) => [s.name, s.template]))

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const template = skillMap.get(name)
		if (template) {
			if (name === "git-master" && options?.gitMasterConfig) {
				resolved.set(name, injectGitMasterConfig(template, options.gitMasterConfig))
			} else {
				resolved.set(name, template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}
