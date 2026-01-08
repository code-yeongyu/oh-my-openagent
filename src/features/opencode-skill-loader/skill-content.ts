import { createBuiltinSkills } from "../builtin-skills/skills"

export function resolveSkillContent(skillName: string): string | null {
	const skills = createBuiltinSkills()
	const skill = skills.find((s) => s.name === skillName)
	return skill?.template ?? null
}

export function resolveMultipleSkills(skillNames: string[]): {
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
			resolved.set(name, template)
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}
