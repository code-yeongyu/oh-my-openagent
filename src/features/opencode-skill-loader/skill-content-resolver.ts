import type { ToonCompressionConfig } from "../../shared/toon-compression"
import { safeCompress, DEFAULT_COMPRESSION_CONFIG } from "../../shared/toon-compression"

/**
 * Compresses skill injection content using TOON compression.
 * Returns the original content if compression is disabled or content is not compressible.
 *
 * @param content - Skill content to compress (string or structured data)
 * @param config - Optional compression configuration
 * @returns Compressed content or original if compression not applicable
 */
export function compressSkillContent(
	content: string,
	config: ToonCompressionConfig = DEFAULT_COMPRESSION_CONFIG
): string {
	return safeCompress(content, "skill-content-resolver")
}

/**
 * Compresses an array of resolved skill templates.
 * Useful for batch skill injection where multiple skills are loaded together.
 *
 * @param skills - Map of skill name to template content
 * @param config - Optional compression configuration
 * @returns Compressed representation of skills array
 */
export function compressSkillTemplates(
	skills: Map<string, string>,
	config: ToonCompressionConfig = DEFAULT_COMPRESSION_CONFIG
): string {
	const skillArray = Array.from(skills.entries()).map(([name, template]) => ({
		name,
		template,
	}))
	return safeCompress(skillArray, "skill-content-resolver")
}

/**
 * Compresses skill injection data for context injection.
 * Creates a structured format suitable for TOON compression.
 *
 * @param skillName - Name of the skill
 * @param template - Skill template content
 * @param metadata - Optional metadata (e.g., source path, scope)
 * @param config - Optional compression configuration
 * @returns Compressed skill injection data
 */
export function compressSkillInjection(
	skillName: string,
	template: string,
	metadata?: Record<string, unknown>,
	config: ToonCompressionConfig = DEFAULT_COMPRESSION_CONFIG
): string {
	const injectionData = {
		skill: skillName,
		content: template,
		...(metadata && { meta: metadata }),
	}
	return safeCompress(injectionData, "skill-content-resolver")
}
