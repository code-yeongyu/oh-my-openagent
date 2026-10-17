import { isAbsolute, posix, relative, resolve, win32 } from "node:path"

function toDisplayPath(path: string): string {
	return path.replaceAll("\\", "/")
}

function isPosixAbsolutePath(path: string): boolean {
	return path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)
}

function isWindowsAbsolutePath(path: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(path)
}

function looksLikeFilePath(path: string): boolean {
	if (path.endsWith("/")) return true
	const lastSegment = path.split("/").pop() ?? ""
	return /\.[a-zA-Z0-9]+$/.test(lastSegment)
}

// Local fix 47: no lookbehind. JSC tried `(?<!...)@` at every offset of every skill body (about 45 ms per
// 2.4 MB pass, repeated for each new chat folder, all synchronous). Scanning for "@" and checking the
// preceding character by hand produces identical output in well under a millisecond.
const SKILL_PATH_REFERENCE = /@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g
const REFERENCE_BLOCKING_PREFIX = /[a-zA-Z0-9="(]/

export function resolveSkillPathReferences(content: string, basePath: string): string {
	const normalizedBase = basePath.replace(/[\\/]$/, "")
	if (!content.includes("@")) return content
	return content.replace(
		SKILL_PATH_REFERENCE,
		(match, relativePath: string, offset: number) => {
			if (offset > 0 && REFERENCE_BLOCKING_PREFIX.test(content.charAt(offset - 1))) return match
			if (!looksLikeFilePath(relativePath)) return match
			if (isWindowsAbsolutePath(normalizedBase)) {
				const resolvedPath = win32.resolve(normalizedBase, relativePath)
				const relativePathFromBase = win32.relative(normalizedBase, resolvedPath)
				if (relativePathFromBase.startsWith("..") || win32.isAbsolute(relativePathFromBase)) {
					return match
				}
				const displayPath = toDisplayPath(resolvedPath)
				return relativePath.endsWith("/") && !displayPath.endsWith("/")
					? `${displayPath}/`
					: displayPath
			}

			if (isPosixAbsolutePath(normalizedBase)) {
				const displayBase = toDisplayPath(normalizedBase)
				const resolvedPath = posix.resolve(displayBase, relativePath)
				const relativePathFromBase = posix.relative(displayBase, resolvedPath)
				if (relativePathFromBase.startsWith("..") || posix.isAbsolute(relativePathFromBase)) {
					return match
				}
				return relativePath.endsWith("/") && !resolvedPath.endsWith("/")
					? `${resolvedPath}/`
					: resolvedPath
			}

			const resolvedPath = resolve(normalizedBase, relativePath)
			const relativePathFromBase = relative(normalizedBase, resolvedPath)
			if (relativePathFromBase.startsWith("..") || isAbsolute(relativePathFromBase)) {
				return match
			}
			const displayPath = toDisplayPath(resolvedPath)
			return relativePath.endsWith("/") && !displayPath.endsWith("/")
				? `${displayPath}/`
				: displayPath
		}
	)
}
