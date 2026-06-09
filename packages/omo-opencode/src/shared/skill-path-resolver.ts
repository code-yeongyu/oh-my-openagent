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

export function resolveSkillPathReferences(content: string, basePath: string): string {
	const normalizedBase = basePath.replace(/[\\/]$/, "")
	return content.replace(
		/(?<![a-zA-Z0-9="\(])@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g,
		(match, relativePath: string) => {
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
