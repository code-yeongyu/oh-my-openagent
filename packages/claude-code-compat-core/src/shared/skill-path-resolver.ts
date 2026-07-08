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

function splitTrailingSentencePunctuation(path: string): {
	pathWithoutPunctuation: string
	trailingPunctuation: string
} {
	const match = path.match(/[.,;:!?]+$/)
	if (!match) {
		return { pathWithoutPunctuation: path, trailingPunctuation: "" }
	}

	return {
		pathWithoutPunctuation: path.slice(0, -match[0].length),
		trailingPunctuation: match[0],
	}
}

export function resolveSkillPathReferences(content: string, basePath: string): string {
	const normalizedBase = basePath.replace(/[\\/]$/, "")
	return content.replace(
		/(?<![a-zA-Z0-9="\(])@([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\-\/]*)/g,
		(match, relativePath: string) => {
			const { pathWithoutPunctuation, trailingPunctuation } =
				splitTrailingSentencePunctuation(relativePath)
			if (!looksLikeFilePath(pathWithoutPunctuation)) return match
			if (isWindowsAbsolutePath(normalizedBase)) {
				const resolvedPath = win32.resolve(normalizedBase, pathWithoutPunctuation)
				const relativePathFromBase = win32.relative(normalizedBase, resolvedPath)
				if (relativePathFromBase.startsWith("..") || win32.isAbsolute(relativePathFromBase)) {
					return match
				}
				const displayPath = toDisplayPath(resolvedPath)
				const resolvedDisplayPath =
					pathWithoutPunctuation.endsWith("/") && !displayPath.endsWith("/")
						? `${displayPath}/`
						: displayPath
				return `${resolvedDisplayPath}${trailingPunctuation}`
			}

			if (isPosixAbsolutePath(normalizedBase)) {
				const displayBase = toDisplayPath(normalizedBase)
				const resolvedPath = posix.resolve(displayBase, pathWithoutPunctuation)
				const relativePathFromBase = posix.relative(displayBase, resolvedPath)
				if (relativePathFromBase.startsWith("..") || posix.isAbsolute(relativePathFromBase)) {
					return match
				}
				const resolvedDisplayPath =
					pathWithoutPunctuation.endsWith("/") && !resolvedPath.endsWith("/")
						? `${resolvedPath}/`
						: resolvedPath
				return `${resolvedDisplayPath}${trailingPunctuation}`
			}

			const resolvedPath = resolve(normalizedBase, pathWithoutPunctuation)
			const relativePathFromBase = relative(normalizedBase, resolvedPath)
			if (relativePathFromBase.startsWith("..") || isAbsolute(relativePathFromBase)) {
				return match
			}
			const displayPath = toDisplayPath(resolvedPath)
			const resolvedDisplayPath =
				pathWithoutPunctuation.endsWith("/") && !displayPath.endsWith("/")
					? `${displayPath}/`
					: displayPath
			return `${resolvedDisplayPath}${trailingPunctuation}`
		}
	)
}
