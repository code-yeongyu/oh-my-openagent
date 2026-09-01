import { executeCommand } from "./execute-command"
import { findEmbeddedCommands } from "./embedded-commands"

export async function resolveCommandsInText(
	text: string,
	depth: number = 0,
	maxDepth: number = 3,
): Promise<string> {
	if (depth >= maxDepth) {
		return text
	}

	const matches = findEmbeddedCommands(text)
	if (matches.length === 0) {
		return text
	}

	const tasks = matches.map((m) => executeCommand(m.command))
	const results = await Promise.allSettled(tasks)

	const replacements = new Map<string, string>()

	matches.forEach((match, idx) => {
		const result = results[idx]
		if (result.status === "rejected") {
			replacements.set(
				match.fullMatch,
				`[error: ${
					result.reason instanceof Error
						? result.reason.message
						: String(result.reason)
				}]`,
			)
		} else {
			replacements.set(match.fullMatch, result.value)
		}
	})

	let resolved = text
	for (const [pattern, replacement] of replacements.entries()) {
		resolved = resolved.split(pattern).join(replacement)
	}

	if (findEmbeddedCommands(resolved).length > 0) {
		return resolveCommandsInText(resolved, depth + 1, maxDepth)
	}

	return resolved
}
