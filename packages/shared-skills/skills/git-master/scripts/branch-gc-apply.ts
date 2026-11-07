import { writeFileSync } from "node:fs"

import type { PlanRow } from "./branch-gc-core"
import { git } from "./branch-gc-facts"

export interface ApplyOutcome {
	readonly removedWorktrees: readonly string[]
	readonly deletedBranches: readonly string[]
	readonly refusals: readonly string[]
}

export function writeSnapshot(repo: string, path: string): string {
	const refs = git(repo, ["for-each-ref", "--format=%(objectname) %(refname)"])
	const worktrees = git(repo, ["worktree", "list", "--porcelain"])
	writeFileSync(path, `# branch-gc snapshot ${new Date().toISOString()}\n${refs}\n# worktrees\n${worktrees}`)
	return path
}

function attempt(repo: string, args: readonly string[]): string | null {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
	return result.exitCode === 0 ? null : result.stderr.toString().trim()
}

export function applyPlan(repo: string, rows: readonly PlanRow[], options: { readonly worktrees: boolean; readonly namespaces: readonly string[] }): ApplyOutcome {
	const removedWorktrees: string[] = []
	const deletedBranches: string[] = []
	const refusals: string[] = []
	const inScope = (row: PlanRow): boolean => options.namespaces.length === 0 || options.namespaces.some((prefix) => row.branch.startsWith(prefix))
	const targets = rows.filter((row) => row.action === "delete" && inScope(row))
	for (const row of targets) {
		if (row.worktree === null) continue
		if (!options.worktrees) {
			refusals.push(`${row.branch}: checked out in ${row.worktree}; pass --worktrees to remove it first`)
			continue
		}
		const failure = attempt(repo, ["worktree", "remove", row.worktree])
		if (failure === null) removedWorktrees.push(row.worktree)
		else refusals.push(`${row.branch}: git refused to remove worktree ${row.worktree}: ${failure}`)
	}
	for (const row of targets) {
		if (row.worktree !== null && !removedWorktrees.includes(row.worktree)) continue
		const failure = attempt(repo, ["branch", "-D", row.branch])
		if (failure === null) deletedBranches.push(row.branch)
		else refusals.push(`${row.branch}: git refused to delete the branch: ${failure}`)
	}
	return { removedWorktrees, deletedBranches, refusals }
}
