import { existsSync, readFileSync, realpathSync } from "node:fs"
import { sep } from "node:path"

import { type BranchFact, PR_STATES, type PrState, type PullRequest, type WorktreeFact } from "./branch-gc-core"

export class PreconditionError extends Error {
	readonly name = "PreconditionError"
}

export function git(repo: string, args: readonly string[]): string {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
	if (result.exitCode !== 0) throw new PreconditionError(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`)
	return result.stdout.toString()
}

function gitSucceeds(repo: string, args: readonly string[]): boolean {
	return Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
}

export function resolveBase(repo: string, requested: string | null): string {
	const candidates = requested === null ? ["origin/dev", "origin/main", "origin/master", "dev", "main", "master"] : [requested]
	for (const candidate of candidates) {
		if (gitSucceeds(repo, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`])) return candidate
	}
	throw new PreconditionError(`no base ref found among ${candidates.join(", ")}; pass --base <ref>`)
}

export function readBranches(repo: string, base: string): BranchFact[] {
	const format = "%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)"
	return git(repo, ["for-each-ref", `--format=${format}`, "refs/heads"])
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => {
			const [name = "", sha = "", upstream = "", track = ""] = line.split("\0")
			return {
				name,
				sha,
				upstream: upstream.length > 0 ? upstream : null,
				upstreamGone: track.includes("gone"),
				isAncestorOfBase: gitSucceeds(repo, ["merge-base", "--is-ancestor", sha, base]),
			}
		})
}

function isDirty(worktreePath: string): boolean {
	const result = Bun.spawnSync(["git", "-C", worktreePath, "status", "--porcelain", "--untracked-files=no"], { stdout: "pipe", stderr: "ignore" })
	return result.exitCode !== 0 || result.stdout.toString().trim().length > 0
}

function safeRealpath(path: string): string {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}

export function readWorktrees(repo: string, cwd: string): WorktreeFact[] {
	const realCwd = safeRealpath(cwd)
	const trees: WorktreeFact[] = []
	let current: { path: string; head: string; branch: string | null; locked: boolean } | null = null
	const flush = (): void => {
		if (current === null) return
		const realPath = safeRealpath(current.path)
		trees.push({
			path: current.path,
			head: current.head,
			branch: current.branch,
			locked: current.locked,
			dirty: isDirty(current.path),
			isCwd: realCwd === realPath || realCwd.startsWith(realPath + sep),
		})
		current = null
	}
	for (const line of git(repo, ["worktree", "list", "--porcelain"]).split("\n")) {
		if (line.startsWith("worktree ")) {
			flush()
			current = { path: line.slice("worktree ".length), head: "", branch: null, locked: false }
			continue
		}
		const open = current
		if (open === null) continue
		if (line.startsWith("HEAD ")) current = { ...open, head: line.slice(5) }
		else if (line.startsWith("branch ")) current = { ...open, branch: line.slice("branch refs/heads/".length) }
		else if (line.startsWith("locked")) current = { ...open, locked: true }
	}
	flush()
	return trees
}

function isPrState(value: unknown): value is PrState {
	return typeof value === "string" && (PR_STATES as readonly string[]).includes(value)
}

function toPullRequest(value: unknown, index: number): PullRequest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PreconditionError(`pr-state entry ${index} is not an object`)
	const record: Record<string, unknown> = { ...value }
	const { number, state, headRefName, baseRefName, mergedAt, closedAt, headRefOid, isCrossRepository } = record
	if (typeof number !== "number" || !isPrState(state) || typeof headRefName !== "string" || typeof baseRefName !== "string" || typeof headRefOid !== "string") {
		throw new PreconditionError(`pr-state entry ${index} lacks number, state, headRefName, baseRefName or headRefOid`)
	}
	return {
		number,
		state,
		headRefName,
		baseRefName,
		mergedAt: typeof mergedAt === "string" ? mergedAt : null,
		closedAt: typeof closedAt === "string" ? closedAt : null,
		headRefOid,
		isCrossRepository: isCrossRepository === true,
	}
}

export function parsePullRequests(text: string, label: string): PullRequest[] {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (error) {
		throw new PreconditionError(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
	}
	if (!Array.isArray(parsed)) throw new PreconditionError(`${label} must be a JSON array of pull requests`)
	return parsed.map((entry, index) => toPullRequest(entry, index))
}

const GH_FIELDS = "number,state,headRefName,baseRefName,mergedAt,closedAt,headRefOid,isCrossRepository"

export function readPullRequests(repo: string, prStatePath: string | null): PullRequest[] {
	if (prStatePath !== null) {
		if (!existsSync(prStatePath)) throw new PreconditionError(`--pr-state file not found: ${prStatePath}`)
		return parsePullRequests(readFileSync(prStatePath, "utf8"), prStatePath)
	}
	const result = Bun.spawnSync(["gh", "pr", "list", "--state", "all", "--limit", "1000", "--json", GH_FIELDS], { cwd: repo, stdout: "pipe", stderr: "pipe" })
	if (result.exitCode !== 0) throw new PreconditionError(`gh pr list failed (${result.stderr.toString().trim() || "is gh installed and authenticated?"}); pass --pr-state <file> to supply PR state`)
	return parsePullRequests(result.stdout.toString(), "gh pr list output")
}
