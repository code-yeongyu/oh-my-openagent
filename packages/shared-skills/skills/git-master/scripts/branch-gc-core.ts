export const PR_STATES = ["OPEN", "MERGED", "CLOSED"] as const
export type PrState = (typeof PR_STATES)[number]

export interface PullRequest {
	readonly number: number
	readonly state: PrState
	readonly headRefName: string
	readonly baseRefName: string
	readonly mergedAt: string | null
	readonly closedAt: string | null
	readonly headRefOid: string
	readonly isCrossRepository: boolean
}

export interface BranchFact {
	readonly name: string
	readonly sha: string
	readonly upstream: string | null
	readonly upstreamGone: boolean
	readonly isAncestorOfBase: boolean
}

export interface WorktreeFact {
	readonly path: string
	readonly branch: string | null
	readonly head: string
	readonly locked: boolean
	readonly dirty: boolean
	readonly isCwd: boolean
}

export interface Facts {
	readonly base: string
	readonly now: Date
	readonly graceDays: number
	readonly disposablePrefixes: readonly string[]
	readonly branches: readonly BranchFact[]
	readonly worktrees: readonly WorktreeFact[]
	readonly pullRequests: readonly PullRequest[]
}

export interface ClassifyOptions {
	readonly worktrees: boolean
}

export const BRANCH_CLASSES = [
	"protected", "retained-prefix", "checked-out", "locked-worktree", "dirty-worktree", "open-pr-head", "open-pr-base",
	"integrated", "pr-merged", "pr-closed-stale", "disposable-no-pr", "human-no-pr",
] as const
export type BranchClass = (typeof BRANCH_CLASSES)[number]
export type Action = "delete" | "keep" | "report"

export interface PlanRow {
	readonly branch: string
	readonly sha: string
	readonly class: BranchClass
	readonly action: Action
	readonly reasons: readonly string[]
	readonly worktree: string | null
}

export const DEFAULT_DISPOSABLE_PREFIXES: readonly string[] = ["codex/", "agent/", "claude/", "copilot/", "ingw/"]
export const DEFAULT_GRACE_DAYS = 14
const RETAINED_PREFIXES: readonly string[] = ["backup/", "archive/", "wip/"]
const PROTECTED_NAMES: ReadonlySet<string> = new Set(["main", "master", "dev", "develop", "trunk"])
const PROTECTED_PREFIXES: readonly string[] = ["release/", "hotfix/"]

export function isProtectedName(name: string): boolean {
	return PROTECTED_NAMES.has(name) || PROTECTED_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function ageInDays(iso: string, now: Date): number {
	return (now.getTime() - new Date(iso).getTime()) / 86_400_000
}

interface MergeVerdict {
	readonly class: BranchClass
	readonly action: Action
	readonly reasons: readonly string[]
}

function mergeVerdict(branch: BranchFact, facts: Facts): MergeVerdict {
	const prs = facts.pullRequests.filter((pr) => pr.headRefName === branch.name && !pr.isCrossRepository)
	const openPr = prs.find((pr) => pr.state === "OPEN")
	if (openPr !== undefined) return { class: "open-pr-head", action: "keep", reasons: [`PR #${openPr.number} is open`] }
	const openChild = facts.pullRequests.find((pr) => pr.state === "OPEN" && pr.baseRefName === branch.name)
	if (openChild !== undefined) return { class: "open-pr-base", action: "keep", reasons: [`open PR #${openChild.number} targets this branch`] }
	const mergedAtTip = prs.find((pr) => pr.state === "MERGED" && pr.headRefOid === branch.sha)
	if (mergedAtTip !== undefined) return { class: "pr-merged", action: "delete", reasons: [`PR #${mergedAtTip.number} merged at this tip`] }
	if (branch.isAncestorOfBase) return { class: "integrated", action: "delete", reasons: [`tip is an ancestor of ${facts.base}`] }
	const disposable = facts.disposablePrefixes.some((prefix) => branch.name.startsWith(prefix))
	if (prs.length > 0 && prs.every((pr) => pr.state === "CLOSED")) {
		const closedAtTip = prs.find((pr) => pr.closedAt !== null && pr.headRefOid === branch.sha)
		const stale = closedAtTip?.closedAt !== undefined && closedAtTip.closedAt !== null && ageInDays(closedAtTip.closedAt, facts.now) > facts.graceDays
		if (disposable && closedAtTip !== undefined && stale) {
			return { class: "pr-closed-stale", action: "delete", reasons: [`PR #${closedAtTip.number} closed ${Math.floor(ageInDays(closedAtTip.closedAt ?? "", facts.now))} days ago, inside a disposable namespace`] }
		}
		return { class: "human-no-pr", action: "keep", reasons: [disposable ? "closed PR is inside the grace period or its head moved" : "closed PR outside a disposable namespace; a human decides"] }
	}
	if (disposable) return { class: "disposable-no-pr", action: "report", reasons: ["disposable namespace with no PR on record"] }
	return { class: "human-no-pr", action: "keep", reasons: [branch.upstreamGone ? "upstream gone but no merge proof" : "no PR and not integrated"] }
}

export function classifyBranch(branch: BranchFact, facts: Facts, options: ClassifyOptions): PlanRow {
	const worktree = facts.worktrees.find((tree) => tree.branch === branch.name) ?? null
	const base = { branch: branch.name, sha: branch.sha, worktree: worktree?.path ?? null }
	if (RETAINED_PREFIXES.some((prefix) => branch.name.startsWith(prefix))) {
		return { ...base, class: "retained-prefix", action: "keep", reasons: ["retention prefix; a human policy decides"] }
	}
	if (isProtectedName(branch.name)) return { ...base, class: "protected", action: "keep", reasons: ["integration or release line"] }
	if (worktree !== null && (worktree.isCwd || worktree.locked)) {
		return { ...base, class: "locked-worktree", action: "keep", reasons: [worktree.isCwd ? `checked out in the current worktree ${worktree.path}` : `worktree ${worktree.path} is locked`] }
	}
	if (worktree !== null && worktree.dirty) return { ...base, class: "dirty-worktree", action: "keep", reasons: [`worktree ${worktree.path} has uncommitted changes`] }
	const verdict = mergeVerdict(branch, facts)
	if (worktree !== null && !(options.worktrees && verdict.action === "delete")) {
		return { ...base, class: "checked-out", action: "keep", reasons: [`checked out in ${worktree.path}; remove the worktree first (--worktrees)`] }
	}
	return { ...base, ...verdict }
}

export function classifyBranches(facts: Facts, options: ClassifyOptions): PlanRow[] {
	return facts.branches.map((branch) => classifyBranch(branch, facts, options))
}

export function summarize(rows: readonly PlanRow[]): Record<Action, number> {
	const counts: Record<Action, number> = { delete: 0, keep: 0, report: 0 }
	for (const row of rows) counts[row.action] += 1
	return counts
}
