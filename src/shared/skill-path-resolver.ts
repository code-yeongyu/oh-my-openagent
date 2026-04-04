import { isAbsolute, relative, resolve, sep } from "node:path"

function looksLikeFilePath(path: string): boolean {
	if (path.endsWith("/")) return true
	const lastSegment = path.split("/").pop() ?? ""
	return /\.[a-zA-Z0-9]+$/.test(lastSegment)
}

export function resolveSkillPathReferences(content: string, basePath: string): string {
	const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
	return content.replace(
		/(?<![a-zA-Z0-9])@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g,
		(match, relativePath: string) => {
			if (!looksLikeFilePath(relativePath)) return match
			const resolvedPath = resolve(normalizedBase, relativePath)
			const relativePathFromBase = relative(normalizedBase, resolvedPath)
			if (relativePathFromBase.startsWith("..") || isAbsolute(relativePathFromBase)) {
				return match
			}
			if (relativePath.endsWith("/") && !resolvedPath.endsWith(sep)) {
				return `${resolvedPath}/`
			}
			return resolvedPath
		}
	)
}
