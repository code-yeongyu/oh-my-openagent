import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { applyPlan, writeSnapshot } from "./branch-gc-apply"
import { type Action, classifyBranches, DEFAULT_DISPOSABLE_PREFIXES, DEFAULT_GRACE_DAYS, type Facts, type PlanRow, summarize } from "./branch-gc-core"
import { git, PreconditionError, readBranches, readPullRequests, readWorktrees, resolveBase } from "./branch-gc-facts"

/**
 * branch-gc: local branch and worktree garbage collection whose merge truth is PR state.
 *
 *   bun branch-gc.ts [--repo <path>] [--base <ref>] [--pr-state <json-file>] [--grace-days N]
 *                    [--namespace <prefix>]... [--worktrees] [--apply] [--snapshot <path>] [--no-fetch] [--json]
 *
 * Exit codes: 0 nothing to delete (or every deletion succeeded), 1 error, 2 dry run found candidates,
 * 3 a precondition refused the run, 4 git refused part of an --apply after some deletions completed.
 */

const USAGE = "usage: bun branch-gc.ts [--repo <path>] [--base <ref>] [--pr-state <json-file>] [--grace-days N] [--namespace <prefix>]... [--worktrees] [--apply] [--snapshot <path>] [--no-fetch] [--json]"

interface Options {
	readonly repo: string
	readonly base: string | null
	readonly prState: string | null
	readonly graceDays: number
	readonly namespaces: readonly string[]
	readonly worktrees: boolean
	readonly apply: boolean
	readonly snapshot: string | null
	readonly fetch: boolean
	readonly json: boolean
}

function parseArgs(argv: readonly string[]): Options | null {
	const options = { repo: process.cwd(), base: null as string | null, prState: null as string | null, graceDays: DEFAULT_GRACE_DAYS, namespaces: [] as string[], worktrees: false, apply: false, snapshot: null as string | null, fetch: true, json: false }
	const takeValue = (index: number): string | null => argv[index + 1] ?? null
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === undefined) continue
		if (arg === "--worktrees") options.worktrees = true
		else if (arg === "--apply") options.apply = true
		else if (arg === "--no-fetch") options.fetch = false
		else if (arg === "--json") options.json = true
		else if (["--repo", "--base", "--pr-state", "--grace-days", "--namespace", "--snapshot"].includes(arg)) {
			const value = takeValue(i)
			if (value === null) return null
			i += 1
			if (arg === "--repo") options.repo = resolve(value)
			else if (arg === "--base") options.base = value
			else if (arg === "--pr-state") options.prState = resolve(value)
			else if (arg === "--snapshot") options.snapshot = resolve(value)
			else if (arg === "--namespace") options.namespaces.push(value)
			else {
				const days = Number(value)
				if (!Number.isFinite(days) || days < 0) return null
				options.graceDays = days
			}
		} else return null
	}
	return options
}

function gatherFacts(options: Options): Facts {
	if (options.fetch) git(options.repo, ["fetch", "--prune", "--quiet"])
	const base = resolveBase(options.repo, options.base)
	const pullRequests = readPullRequests(options.repo, options.prState)
	return {
		base,
		now: new Date(),
		graceDays: options.graceDays,
		disposablePrefixes: options.namespaces.length > 0 ? options.namespaces : DEFAULT_DISPOSABLE_PREFIXES,
		branches: readBranches(options.repo, base),
		worktrees: readWorktrees(options.repo, process.cwd()),
		pullRequests,
	}
}

function printTable(base: string, rows: readonly PlanRow[]): void {
	console.log(`base: ${base}`)
	const order: readonly Action[] = ["delete", "report", "keep"]
	for (const action of order) {
		const group = rows.filter((row) => row.action === action)
		if (group.length === 0) continue
		console.log(`\n${action.toUpperCase()} (${group.length})`)
		for (const row of group) console.log(`  ${row.branch.padEnd(40)} ${row.sha.slice(0, 10)}  ${row.class.padEnd(16)} ${row.reasons.join("; ")}`)
	}
	const counts = summarize(rows)
	console.log(`\nsummary: delete=${counts.delete} report=${counts.report} keep=${counts.keep}`)
}

function runApply(options: Options, base: string, rows: readonly PlanRow[]): number {
	const snapshotPath = options.snapshot ?? join(process.env.TMPDIR ?? tmpdir(), `branch-gc-${Date.now()}.txt`)
	writeSnapshot(options.repo, snapshotPath)
	console.log(`snapshot: ${snapshotPath}`)
	const outcome = applyPlan(options.repo, rows, { worktrees: options.worktrees, namespaces: options.namespaces })
	for (const path of outcome.removedWorktrees) console.log(`removed worktree ${path}`)
	for (const branch of outcome.deletedBranches) console.log(`deleted branch ${branch}`)
	for (const refusal of outcome.refusals) console.log(`refused: ${refusal}`)
	console.log(`base: ${base}; deleted=${outcome.deletedBranches.length} removed-worktrees=${outcome.removedWorktrees.length} refused=${outcome.refusals.length}`)
	return outcome.refusals.length === 0 ? 0 : 4
}

export function main(argv: readonly string[]): number {
	const options = parseArgs(argv)
	if (options === null) {
		console.error(USAGE)
		return 2
	}
	let facts: Facts
	try {
		facts = gatherFacts(options)
	} catch (error) {
		if (!(error instanceof PreconditionError)) throw error
		console.error(`refused: ${error.message}`)
		return 3
	}
	const rows = classifyBranches(facts, { worktrees: options.worktrees })
	const counts = summarize(rows)
	if (options.apply) return runApply(options, facts.base, rows)
	if (options.json) console.log(JSON.stringify({ base: facts.base, rows, summary: counts }, null, 2))
	else printTable(facts.base, rows)
	return counts.delete > 0 ? 2 : 0
}

if (import.meta.main) {
	let code: number
	try {
		code = main(process.argv.slice(2))
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		code = 1
	}
	process.exit(code)
}
