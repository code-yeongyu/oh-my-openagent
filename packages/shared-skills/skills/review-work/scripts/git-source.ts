import { createHash } from "node:crypto"

import type { SourceIdentity } from "./validate-evidence-core"

export class GitSourceError extends Error {
	readonly name = "GitSourceError"
}

function git(repo: string, args: readonly string[]): Buffer {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
	if (result.exitCode !== 0) {
		throw new GitSourceError(`git ${args.join(" ")} failed in ${repo}: ${result.stderr.toString().trim()}`)
	}
	return result.stdout
}

export function readLiveSource(repo: string): SourceIdentity {
	const commitSha = git(repo, ["rev-parse", "HEAD"]).toString().trim()
	const status = git(repo, ["status", "--porcelain", "--untracked-files=no"]).toString()
	if (status.trim().length === 0) return { commitSha, dirty: false }
	const diff = git(repo, ["diff", "--binary", "HEAD"])
	return { commitSha, dirty: true, treeHash: createHash("sha256").update(diff).digest("hex") }
}

export function stampSource(repo: string, now: Date = new Date()): { source: SourceIdentity; capturedAt: string } {
	return { source: readLiveSource(repo), capturedAt: now.toISOString() }
}
