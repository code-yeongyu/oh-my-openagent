import { executeCommand } from "./execute-command"
import { findEmbeddedCommands } from "./embedded-commands"
import { shouldGateProject, TRUST_ENV_VAR } from "../../features/trust-gate"
import { log } from "../logger"
import { resolve } from "path"

export async function resolveCommandsInText(
	text: string,
	depth: number = 0,
	maxDepth: number = 3,
	projectPath?: string,
): Promise<string> {
	if (depth >= maxDepth) {
		return text
	}

	const matches = findEmbeddedCommands(text)
	if (matches.length === 0) {
		return text
	}

	// Trust Gate: 未承認projectではembedded commandをno-opにする
	const cwd = projectPath ?? process.cwd()
	const absPath = resolve(cwd)
	const projectNeedsGate = shouldGateProject(absPath)

	if (projectNeedsGate && process.env[TRUST_ENV_VAR] !== "1") {
		log(`[trust-gate] Embedded commands blocked in untrusted project: ${absPath}`)
		// コマンドを実行せず、警告メッセージに置き換え
		let resolved = text
		for (const match of matches) {
			resolved = resolved.split(match.fullMatch).join("[trust-gate: command execution disabled - run 'opencode trust .' to approve]")
		}
		return resolved
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
