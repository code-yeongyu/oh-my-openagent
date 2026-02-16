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

export function parseGitStatusPorcelainLine(
	line: string,
): ParsedGitStatusPorcelainLine | null {
	if (!line) return null

	const statusToken = line.substring(0, 2).trim()
	const filePath = line.substring(3)
	if (!filePath) return null

	return {
		filePath,
		status: toGitFileStatus(statusToken),
	}
}
