import { join } from "path"

/**
 * Resolves @path references in skill content to absolute paths.
 *
 * Matches @references that contain at least one slash (e.g., @scripts/search.py, @data/)
 * to avoid false positives with decorators (@param), JSDoc tags (@ts-ignore), etc.
 *
 * Email addresses are excluded since they have alphanumeric characters before @.
 */
export function resolveSkillPathReferences(content: string, basePath: string): string {
	const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
	return content.replace(
		/(?<![a-zA-Z0-9])@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g,
		(_, relativePath: string) => join(normalizedBase, relativePath)
	)
}
