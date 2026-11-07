import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Action, type BranchClass, classifyBranches, type Facts, type PlanRow } from "./branch-gc-core"

const cli = join(import.meta.dir, "branch-gc.ts")
const work = mkdtempSync(join(tmpdir(), "branch-gc-"))
const repo = join(work, "repo")
const prStatePath = join(work, "pr-state.json")
const tips: Record<string, string> = {}

function git(args: readonly string[], cwd = repo): string {
	const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
	return result.stdout.toString().trim()
}

function commitOn(branch: string, file: string, from = "main"): void {
	git(["checkout", "-q", "-b", branch, from])
	writeFileSync(join(repo, file), `${branch}\n`)
	git(["add", file])
	git(["commit", "-q", "-m", `${branch}: ${file}`])
	tips[branch] = git(["rev-parse", "HEAD"])
	git(["checkout", "-q", "main"])
}

function run(args: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
	const result = Bun.spawnSync(["bun", cli, "--repo", repo, "--base", "main", "--no-fetch", "--pr-state", prStatePath, ...args], { cwd: work, stdout: "pipe", stderr: "pipe" })
	return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

function rowsByBranch(stdout: string): Record<string, PlanRow> {
	const parsed = JSON.parse(stdout) as { rows: PlanRow[] }
	return Object.fromEntries(parsed.rows.map((row) => [row.branch, row]))
}

function localBranches(): string[] {
	return git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n").filter((line) => line.length > 0).sort()
}

beforeAll(() => {
	mkdirSync(repo)
	git(["init", "-q", "-b", "main"])
	git(["config", "user.email", "gc@example.com"])
	git(["config", "user.name", "GC"])
	writeFileSync(join(repo, "README.md"), "base\n")
	git(["add", "README.md"])
	git(["commit", "-q", "-m", "init"])
	commitOn("feat/squashed", "squashed-1.txt")
	git(["checkout", "-q", "feat/squashed"])
	writeFileSync(join(repo, "squashed-2.txt"), "two\n")
	git(["add", "squashed-2.txt"])
	git(["commit", "-q", "-m", "feat/squashed: second"])
	tips["feat/squashed"] = git(["rev-parse", "HEAD"])
	git(["checkout", "-q", "main"])
	git(["merge", "--squash", "-q", "feat/squashed"])
	git(["commit", "-q", "-m", "squash merge feat/squashed"])
	commitOn("feat/integrated", "integrated.txt")
	git(["merge", "--no-ff", "-q", "-m", "merge feat/integrated", "feat/integrated"])
	commitOn("feat/open", "open.txt")
	commitOn("feat/stack-base", "stack-base.txt")
	commitOn("wip/scratch", "scratch.txt")
	commitOn("feat/checked-out", "checked-out.txt")
	commitOn("feat/dirty", "dirty.txt")
	commitOn("agent/old-closed", "agent-old.txt")
	commitOn("human/old-closed", "human-old.txt")
	git(["worktree", "add", "-q", join(work, "wt-checked-out"), "feat/checked-out"])
	git(["worktree", "add", "-q", join(work, "wt-dirty"), "feat/dirty"])
	writeFileSync(join(work, "wt-dirty", "dirty.txt"), "uncommitted edit\n")
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
	const pr = (number: number, state: string, headRefName: string, extra: Record<string, unknown> = {}) => ({
		number,
		state,
		headRefName,
		baseRefName: "main",
		mergedAt: state === "MERGED" ? thirtyDaysAgo : null,
		closedAt: state === "OPEN" ? null : thirtyDaysAgo,
		headRefOid: tips[headRefName] ?? "",
		isCrossRepository: false,
		...extra,
	})
	writeFileSync(
		prStatePath,
		JSON.stringify([
			pr(1, "MERGED", "feat/squashed"),
			pr(2, "OPEN", "feat/open"),
			pr(3, "MERGED", "feat/stack-base"),
			pr(4, "OPEN", "feat/stack-child", { baseRefName: "feat/stack-base", headRefOid: "0".repeat(40) }),
			pr(5, "CLOSED", "agent/old-closed"),
			pr(6, "CLOSED", "human/old-closed"),
		]),
	)
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe("classifyBranches", () => {
	test("#given a merged PR whose head moved on #when classified #then the branch is not treated as merged", () => {
		const facts: Facts = {
			base: "main",
			now: new Date("2026-11-07T00:00:00Z"),
			graceDays: 14,
			disposablePrefixes: ["agent/"],
			branches: [{ name: "feat/moved", sha: "b".repeat(40), upstream: null, upstreamGone: false, isAncestorOfBase: false }],
			worktrees: [],
			pullRequests: [{ number: 9, state: "MERGED", headRefName: "feat/moved", baseRefName: "main", mergedAt: "2026-10-01T00:00:00Z", closedAt: "2026-10-01T00:00:00Z", headRefOid: "a".repeat(40), isCrossRepository: false }],
		}
		const [row] = classifyBranches(facts, { worktrees: false })
		expect(row?.class).toBe("human-no-pr")
		expect(row?.action).toBe("keep")
	})

	test("#given a closed PR inside the grace period #when classified #then the disposable branch is kept", () => {
		const facts: Facts = {
			base: "main",
			now: new Date("2026-11-07T00:00:00Z"),
			graceDays: 14,
			disposablePrefixes: ["agent/"],
			branches: [{ name: "agent/fresh", sha: "c".repeat(40), upstream: null, upstreamGone: false, isAncestorOfBase: false }],
			worktrees: [],
			pullRequests: [{ number: 10, state: "CLOSED", headRefName: "agent/fresh", baseRefName: "main", mergedAt: null, closedAt: "2026-11-05T00:00:00Z", headRefOid: "c".repeat(40), isCrossRepository: false }],
		}
		const [row] = classifyBranches(facts, { worktrees: false })
		expect(row?.action).toBe("keep")
		expect(row?.class).toBe("human-no-pr")
	})
})

describe("branch-gc CLI", () => {
	test("#given the fixture repo #when dry-run #then every branch lands in its class and the exit code says candidates exist", () => {
		const result = run(["--json"])
		expect(result.stderr).toBe("")
		expect(result.exitCode).toBe(2)
		const rows = rowsByBranch(result.stdout)
		const expected: Record<string, [BranchClass, Action]> = {
			main: ["protected", "keep"],
			"feat/squashed": ["pr-merged", "delete"],
			"feat/integrated": ["integrated", "delete"],
			"feat/open": ["open-pr-head", "keep"],
			"feat/stack-base": ["open-pr-base", "keep"],
			"wip/scratch": ["retained-prefix", "keep"],
			"feat/checked-out": ["checked-out", "keep"],
			"feat/dirty": ["dirty-worktree", "keep"],
			"agent/old-closed": ["pr-closed-stale", "delete"],
			"human/old-closed": ["human-no-pr", "keep"],
		}
		for (const [branch, [cls, action]] of Object.entries(expected)) {
			expect(rows[branch]?.class, branch).toBe(cls)
			expect(rows[branch]?.action, branch).toBe(action)
		}
	})

	test("#given --apply without --worktrees #when run #then the delete rows go, the keeps stay, the snapshot holds every ref", () => {
		const snapshot = join(work, "snapshot.txt")
		const before = localBranches()
		const result = run(["--apply", "--snapshot", snapshot])
		expect(result.stderr).toBe("")
		expect(result.exitCode).toBe(0)
		expect(existsSync(snapshot)).toBe(true)
		const snapshotText = readFileSync(snapshot, "utf8")
		for (const branch of before) expect(snapshotText).toContain(`refs/heads/${branch}`)
		expect(snapshotText).toContain(tips["feat/squashed"] ?? "missing")
		expect(localBranches()).toEqual(before.filter((branch) => !["feat/squashed", "feat/integrated", "agent/old-closed"].includes(branch)))
		expect(existsSync(join(work, "wt-dirty", "dirty.txt"))).toBe(true)
	})

	test("#given a clean repo #when applied again #then there is nothing to do", () => {
		const result = run(["--apply", "--snapshot", join(work, "snapshot-2.txt")])
		expect(result.exitCode).toBe(0)
		expect(run(["--json"]).exitCode).toBe(0)
	})

	test("#given a missing pr-state file and no gh #when run #then the precondition refusal exits 3", () => {
		const result = Bun.spawnSync(["bun", cli, "--repo", repo, "--base", "main", "--no-fetch", "--pr-state", join(work, "nope.json")], { cwd: work, stdout: "pipe", stderr: "pipe" })
		expect(result.exitCode).toBe(3)
	})
})
