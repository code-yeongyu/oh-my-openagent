import { matchSkillByName } from "../../tools/skill/skill-matcher"
import { createBuiltinSkills } from "../builtin-skills/skills"
import { injectGitMasterConfig } from "./git-master-template-injection"
import { extractSkillTemplate } from "./loaded-skill-template-extractor"
import { getAllSkills } from "./skill-discovery"
import type { SkillResolutionOptions } from "./skill-resolution-options"

export function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null {
	const skills = createBuiltinSkills({
		browserProvider: options?.browserProvider,
		disabledSkills: options?.disabledSkills,
		teamModeEnabled: options?.teamModeEnabled,
	})
	const skill = skills.find((builtinSkill) => builtinSkill.name === skillName)
	if (!skill) return null

	if (skill.name === "git-master") {
		return injectGitMasterConfig(skill.template, options?.gitMasterConfig)
	}

	return skill.template
}

export function resolveMultipleSkills(
	skillNames: string[],
	options?: SkillResolutionOptions
): { resolved: Map<string, string>; notFound: string[] } {
	const skills = createBuiltinSkills({
		browserProvider: options?.browserProvider,
		disabledSkills: options?.disabledSkills,
		teamModeEnabled: options?.teamModeEnabled,
	})
	const skillMap = new Map(skills.map((skill) => [skill.name, skill]))

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const match = skillMap.get(name)
		if (match) {
			if (match.name === "git-master") {
				resolved.set(name, injectGitMasterConfig(match.template, options?.gitMasterConfig))
			} else {
				resolved.set(name, match.template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}

export async function resolveSkillContentAsync(
	skillName: string,
	options?: SkillResolutionOptions
): Promise<string | null> {
	const allSkills = await getAllSkills(options)
	const skill = matchSkillByName(allSkills, skillName)
	if (!skill) return null

	const template = await extractSkillTemplate(skill)

	if (skill.name === "git-master") {
		return injectGitMasterConfig(template, options?.gitMasterConfig)
	}

	return template
}

export async function resolveMultipleSkillsAsync(
	skillNames: string[],
	options?: SkillResolutionOptions
): Promise<{ resolved: Map<string, string>; notFound: string[] }> {
	const allSkills = await getAllSkills(options)

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const skill = matchSkillByName(allSkills, name)
		if (skill) {
			const template = await extractSkillTemplate(skill)
			if (skill.name === "git-master") {
				resolved.set(name, injectGitMasterConfig(template, options?.gitMasterConfig))
			} else {
				resolved.set(name, template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}
