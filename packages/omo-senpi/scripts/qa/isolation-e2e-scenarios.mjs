// Scenario scripts and assertions for isolation-e2e.mjs. The driver owns the sandbox lifecycle;
// this module owns what the mock model does and what the resulting state must look like.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"

export const CHILD_FINAL = "omo isolation e2e child done"
export const PARENT_FINAL = "omo isolation e2e parent done"

export const OMO_CONFIG = {
	categories: {
		mockcat: { description: "Local mock category pinned to the mock provider.", model: "omo-mock/mock-1" },
	},
	// The lane mock provider answers both turns inside one process, so the child must not be a
	// separate daemon session: `auto` would pick `process` on a daemon-capable host and the child
	// would start without the scripted provider.
	task: { default_execution_mode: "in-process" },
}

// The parent asks for one FOREGROUND isolated child, so the task tool settles the clone before it
// returns and the record is terminal by the time the process exits.
function parentSteps(name) {
	return [
		{
			type: "tool_call",
			name: "task",
			arguments: {
				category: "mockcat",
				prompt: "create hello.txt containing hi",
				run_in_background: false,
				isolated: true,
				name,
			},
		},
		{ type: "text", text: PARENT_FINAL },
	]
}

export const APPLIED_SCRIPT = {
	parentSteps: parentSteps("isochild"),
	childSteps: [
		{ type: "tool_call", name: "write", arguments: { path: "hello.txt", content: "hi\n" } },
		{ type: "text", text: CHILD_FINAL },
	],
}

// The conflict case: the child writes hello.txt inside its clone AND, standing in for a concurrent
// human edit, writes a different hello.txt into the parent checkout while it still runs. Merge-back
// therefore replays "create hello.txt" onto a tree that already has a different hello.txt.
export const CONFLICT_SCRIPT = {
	parentSteps: parentSteps("isoconflict"),
	childSteps: [
		{
			type: "tool_call",
			name: "bash",
			arguments: {
				command: "printf 'child version\\n' > hello.txt && printf 'parent version\\n' > \"$OMO_QA_PARENT_REPO/hello.txt\"",
				description: "write the clone copy and a conflicting parent-side copy",
			},
		},
		{ type: "text", text: CHILD_FINAL },
	],
}

export function stateDir(cwd) {
	return join(cwd, ".omo", "senpi-task")
}

/** Every task record in the sandbox: the store keeps one JSON document per task under `tasks/`. */
export function readRecords(cwd) {
	const dir = join(stateDir(cwd), "tasks")
	if (!existsSync(dir)) return []
	const records = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue
		try {
			records.push(JSON.parse(readFileSync(join(dir, entry.name), "utf8")))
		} catch {
			// a partially flushed document is not a record; the assertions below read the rest
		}
	}
	return records
}

/** The last record carrying an isolation block, which is the settled one. */
export function latestIsolation(cwd) {
	let latest
	for (const record of readRecords(cwd)) {
		if (record !== null && typeof record === "object" && typeof record.isolation === "object" && record.isolation !== null) {
			latest = record
		}
	}
	return latest
}

/**
 * Everything still sitting where the backend puts sandboxes. The state dir holds only artifacts
 * (baseline, patch, summary), so looking there proves nothing - the clone itself lives beside
 * `base_dir`, either under its own name or renamed aside as `<base>.retained-<ts>`.
 */
export function leftoverClones(baseDir) {
	if (typeof baseDir !== "string") return []
	const parent = dirname(baseDir)
	if (!existsSync(parent)) return []
	const self = basename(baseDir)
	return readdirSync(parent)
		.filter((name) => name === self || name.startsWith(`${self}.`))
		.map((name) => join(parent, name))
}

function check(name, expected, observed) {
	return { name, expected, observed, pass: JSON.stringify(expected) === JSON.stringify(observed) }
}

export function assertApplied(cwd) {
	const record = latestIsolation(cwd)
	const helloPath = join(cwd, "hello.txt")
	const merge = record?.isolation?.merge_result
	return [
		check("record carries an isolation block", true, record !== undefined),
		check("child ran in a clone, not the checkout", true, typeof record?.isolation?.merged_dir === "string" && record.isolation.merged_dir !== cwd),
		check("merge_result.kind", "applied", merge?.kind),
		check("parent checkout gained hello.txt", "hi\n", existsSync(helloPath) ? readFileSync(helloPath, "utf8") : null),
		check("no clone left beside its base dir", [], leftoverClones(record?.isolation?.base_dir)),
		check("the clone directory is gone", false, typeof record?.isolation?.merged_dir === "string" ? existsSync(record.isolation.merged_dir) : true),
	]
}

/** A retaining kind renames the sandbox aside rather than deleting it (isolation-core retainIsolation). */
function retainedSiblings(baseDir) {
	if (typeof baseDir !== "string") return []
	const parent = dirname(baseDir)
	const prefix = `${basename(baseDir)}.retained-`
	if (!existsSync(parent)) return []
	return readdirSync(parent).filter((name) => name.startsWith(prefix)).map((name) => join(parent, name))
}

export function assertNotApplied(cwd) {
	const record = latestIsolation(cwd)
	const merge = record?.isolation?.merge_result
	const helloPath = join(cwd, "hello.txt")
	const patch = typeof merge?.patchPath === "string" ? merge.patchPath : undefined
	return [
		check("record carries an isolation block", true, record !== undefined),
		check("merge_result.kind", "not-applied", merge?.kind),
		check("the parent-side edit survived", "parent version\n", existsSync(helloPath) ? readFileSync(helloPath, "utf8") : null),
		check("the conflict is reported verbatim", true, typeof merge?.conflict === "string" && merge.conflict.includes("hello.txt")),
		check("a readable patch was retained", true, patch !== undefined && existsSync(patch) && readFileSync(patch, "utf8").includes("hello.txt")),
		check("a manual recovery command is reported", true, typeof merge?.manualCommand === "string" && merge.manualCommand.includes("git apply")),
		check("the clone was retained aside for recovery", 1, retainedSiblings(record?.isolation?.base_dir).length),
	]
}

/**
 * The failure control: a plugin built WITHOUT this change ignores `isolated` entirely - it records no
 * isolation for the same request, so nothing was cloned and nothing was merged back.
 */
export function assertIsolatedRejected(cwd) {
	const record = latestIsolation(cwd)
	return [
		check("the pre-change plugin records no isolation", undefined, record?.isolation),
		check("a task record was still produced", true, readRecords(cwd).length > 0),
	]
}
