import { safeCompress } from "../../shared/toon-compression"

export function compressSkillContent(
	content: string
): string {
	return safeCompress(content, "skill-content-resolver")
}

export function compressSkillTemplates(
	skills: Map<string, string>
): string {
	const skillArray = Array.from(skills.entries()).map(([name, template]) => ({
		name,
		template,
	}))
	return safeCompress(skillArray, "skill-content-resolver")
}

export function compressSkillInjection(
	skillName: string,
	template: string,
	metadata?: Record<string, unknown>
): string {
	const injectionData = {
		skill: skillName,
		content: template,
		...(metadata && { meta: metadata }),
	}
	return safeCompress(injectionData, "skill-content-resolver")
}
