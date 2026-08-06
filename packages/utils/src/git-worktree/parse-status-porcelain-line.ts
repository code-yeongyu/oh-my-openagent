import type { GitFileStatus } from "./types"

export interface ParsedGitStatusPorcelainLine {
	filePath: string
	status: GitFileStatus
}

function toGitFileStatus(statusToken: string): GitFileStatus {
	if (statusToken === "A" || statusToken === "??") return "added"
	if (statusToken === "D") return "deleted"
	return "modified"
}

function normalizeGitStatusPath(statusToken: string, filePath: string): string {
	if (statusToken !== "R" && statusToken !== "C") return filePath
	const arrowIndex = filePath.lastIndexOf(" -> ")
	return arrowIndex === -1 ? filePath : filePath.slice(arrowIndex + 4)
}

export function parseGitStatusPorcelainLine(
	line: string,
): ParsedGitStatusPorcelainLine | null {
	if (!line) return null

	const statusToken = line.substring(0, 2).trim()
	const filePath = normalizeGitStatusPath(statusToken, line.substring(3))
	if (!filePath) return null

	return {
		filePath,
		status: toGitFileStatus(statusToken),
	}
}
