import { join } from "path"

function looksLikeFilePath(path: string): boolean {
	if (path.endsWith("/")) return true
	const lastSegment = path.split("/").pop() ?? ""
	return /\.[a-zA-Z0-9]+$/.test(lastSegment)
}

/**
 * Resolves @path references in skill content to absolute paths.
 *
 * Matches @references that contain at least one slash (e.g., @scripts/search.py, @data/)
 * to avoid false positives with decorators (@param), JSDoc tags (@ts-ignore), etc.
 * Also skips npm scoped packages (@scope/package) by requiring a file extension or trailing slash.
 *
 * Email addresses are excluded since they have alphanumeric characters before @.
 */
export function resolveSkillPathReferences(content: string, basePath: string): string {
	const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
	return content.replace(
		/(?<![a-zA-Z0-9])@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g,
		(match, relativePath: string) => {
			if (!looksLikeFilePath(relativePath)) return match
			return join(normalizedBase, relativePath)
		}
	)
}
