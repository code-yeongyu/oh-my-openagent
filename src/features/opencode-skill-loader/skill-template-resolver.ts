import { createBuiltinSkills } from "../builtin-skills/skills"
import type { LoadedSkill } from "./types"
import type { SkillResolutionOptions } from "./skill-resolution-options"
import { injectGitMasterConfig } from "./git-master-template-injection"
import { getAllSkills } from "./skill-discovery"
import { extractSkillTemplate } from "./loaded-skill-template-extractor"

export function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null {
	const skills = createBuiltinSkills({
		browserProvider: options?.browserProvider,
		disabledSkills: options?.disabledSkills,
	})
	const skill = skills.find((builtinSkill) => builtinSkill.name === skillName)
	if (!skill) return null

	if (skillName === "git-master") {
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
	})
	const skillMap = new Map(skills.map((skill) => [skill.name, skill.template]))

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const template = skillMap.get(name)
		if (template) {
			if (name === "git-master") {
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

export async function resolveSkillContentAsync(
	skillName: string,
	options?: SkillResolutionOptions
): Promise<string | null> {
	const allSkills = await getAllSkills(options)
	const skill = allSkills.find((loadedSkill) => loadedSkill.name === skillName)
	if (!skill) return null

	const template = await extractSkillTemplate(skill)

	if (skillName === "git-master") {
		return injectGitMasterConfig(template, options?.gitMasterConfig)
	}

	return template
}

export async function resolveMultipleSkillsAsync(
	skillNames: string[],
	options?: SkillResolutionOptions
): Promise<{ resolved: Map<string, string>; notFound: string[] }> {
	const allSkills = await getAllSkills(options)
	const skillMap = new Map<string, LoadedSkill>()
	for (const skill of allSkills) {
		skillMap.set(skill.name, skill)
	}

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const skill = skillMap.get(name)
		if (skill) {
			const template = await extractSkillTemplate(skill)
			if (name === "git-master") {
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
