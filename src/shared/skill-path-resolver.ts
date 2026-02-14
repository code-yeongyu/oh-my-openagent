import { posix } from "path"

/**
 * Resolves @path references in skill content to absolute paths.
 *
 * Matches @references that contain at least one slash (e.g., @scripts/search.py, @data/)
 * to avoid false positives with decorators (@param), JSDoc tags (@ts-ignore), etc.
 *
 * Email addresses are excluded since they have alphanumeric characters before @.
 */
export function resolveSkillPathReferences(content: string, basePath: string): string {
	const normalizedBasePath = basePath.replace(/\\/g, "/")
	const normalizedBase =
		normalizedBasePath.endsWith("/") ? normalizedBasePath.slice(0, -1) : normalizedBasePath
	return content.replace(
		/(?<![a-zA-Z0-9])@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g,
		(_, relativePath: string) => {
			const joined = posix.join(normalizedBase, relativePath)
			if (!relativePath.endsWith("/")) return joined
			return joined.endsWith("/") ? joined : `${joined}/`
		}
	)
}
