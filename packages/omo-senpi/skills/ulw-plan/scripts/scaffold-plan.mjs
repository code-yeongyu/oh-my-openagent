#!/usr/bin/env node
// scaffold-plan.mjs - generate the ulw-plan draft + plan skeleton deterministically.
//
// Zero external dependencies (node:fs/path/process/url builtins only) so it runs
// byte-identically under `node` and `bun` on macOS, Linux, and Windows with no uv
// bootstrap, no npm/pip install, and no POSIX-shell or python3 precondition - the
// two things genuinely not guaranteed on native Windows across the omo harnesses.
//
// Usage:  node "<skill-root>/scripts/scaffold-plan.mjs" <slug> [--clear|--unclear] [--draft-only] [--review-required] [--reset [--force]]
//
// RESUME-SAFE: run it ONCE at plan generation. A plain re-run on an existing
// ulw-plan artifact is a NO-OP success (it never overwrites your appended todos),
// so a model resuming after compaction cannot crash the turn or clobber the plan.
// Destructive overwrite is reserved behind --reset, and --reset refuses to discard
// a hand-edited file unless --force is also passed.
//
// WRITE BOUNDARY: the planner's Write/Edit tools are gated to .omo/*.md but Bash is not, so this script self-guards its writes to the .omo/ tree.

import { lstat, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { FINAL_VERIFICATION_ITEMS, PLAN_SECTION_HEADERS, buildDraft, buildPlanSkeleton } from "./plan-templates.mjs";

// The emitted text lives in plan-templates.mjs; re-exported so importers keep one entry point.
export { FINAL_VERIFICATION_ITEMS, PLAN_SECTION_HEADERS, buildDraft, buildPlanSkeleton };

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function parseArgs(argv) {
	const rest = argv.slice(2);
	let slug;
	let intent = "unspecified";
	let force = false;
	let reset = false;
	let draftOnly = false;
	let reviewRequired = false;
	for (const arg of rest) {
		if (arg === "--clear") intent = "clear";
		else if (arg === "--unclear") intent = "unclear";
		else if (arg === "--reset") reset = true;
		else if (arg === "--force") force = true;
		else if (arg === "--draft-only") draftOnly = true;
		else if (arg === "--review-required") reviewRequired = true;
		else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
		else if (slug === undefined) slug = arg;
		else throw new Error(`unexpected argument: ${arg}`);
	}
	if (!slug) throw new Error('usage: scaffold-plan.mjs <slug> [--clear|--unclear] [--draft-only] [--review-required] [--reset [--force]]');
	if (!SLUG_PATTERN.test(slug)) {
		throw new Error(`invalid slug "${slug}" - use lowercase letters, digits, and hyphens only`);
	}
	return { slug, intent, reset, force, draftOnly, reviewRequired };
}

// WRITE BOUNDARY: the planner's Write/Edit tools are gated to .omo/*.md but Bash is not, so this script self-guards its writes to the .omo/ tree.
export function resolveSafeOmoPath(cwd, relPath) {
	const resolved = resolve(cwd, relPath);
	const rel = relative(cwd, resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`refused: path escapes the workspace root: ${relPath}`);
	}
	if (!/(^|[/\\])\.omo([/\\]|$)/i.test(rel)) {
		throw new Error(`refused: ulw-plan may only write under .omo/: ${relPath}`);
	}
	if (!resolved.toLowerCase().endsWith(".md")) {
		throw new Error(`refused: ulw-plan may only write .md files: ${relPath}`);
	}
	return resolved;
}

function assertContainedPath(parent, child, message) {
	const rel = relative(parent, child);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(message);
	}
}

async function mkdirWithoutSymlinks(dir, stopAt) {
	if (dir === stopAt) return;
	const parent = dirname(dir);
	if (parent === dir || relative(stopAt, dir).startsWith("..") || isAbsolute(relative(stopAt, dir))) {
		throw new Error(`refused: path escapes the workspace root: ${dir}`);
	}
	await mkdirWithoutSymlinks(parent, stopAt);
	const stat = await lstat(dir).catch((err) => {
		if (err && err.code === "ENOENT") return null;
		throw err;
	});
	if (stat) {
		if (stat.isSymbolicLink()) {
			throw new Error(`refused: path component is a symlink: ${dir}`);
		}
		if (!stat.isDirectory()) {
			throw new Error(`refused: path component is not a directory: ${dir}`);
		}
		return;
	}
	await mkdir(dir);
}

async function assertSafeWriteParent(cwd, target) {
	const workspaceReal = await realpath(cwd);
	const workspaceRoot = resolve(cwd);
	const omoRoot = resolve(cwd, ".omo");
	const parent = dirname(target);
	assertContainedPath(workspaceRoot, parent, `refused: path escapes the workspace root: ${target}`);
	assertContainedPath(omoRoot, parent, `refused: ulw-plan may only write under .omo/: ${target}`);
	await mkdirWithoutSymlinks(parent, workspaceRoot);
	const omoReal = await realpath(omoRoot);
	const parentReal = await realpath(parent);
	assertContainedPath(workspaceReal, parentReal, `refused: path escapes the workspace root through symlinks: ${target}`);
	assertContainedPath(omoReal, parentReal, `refused: ulw-plan may only write under .omo/ through real paths: ${target}`);
}

async function assertSafeWriteTarget(target) {
	const stat = await lstat(target).catch((err) => {
		if (err && err.code === "ENOENT") return null;
		throw err;
	});
	if (stat?.isSymbolicLink()) {
		throw new Error(`refused: target is a symlink: ${target}`);
	}
}

// A file this script previously emitted (plan skeleton or draft), used to make a
// plain re-run a safe no-op instead of a crash or a clobber.
export function isUlwArtifact(content) {
	const isPlan = content.includes("## TL;DR (For humans)") && content.includes("## Final verification wave");
	const isDraft = content.includes("# Draft:") && content.includes("## Approval gate");
	return isPlan || isDraft;
}

// Resume-safe write: plain re-run on an existing ulw-plan artifact is a no-op
// success; --reset overwrites but refuses to discard a hand-edited file unless
// --force is also passed.
export async function writeGuarded(cwd, relPath, content, { reset = false, force = false } = {}) {
	const target = resolveSafeOmoPath(cwd, relPath);
	await assertSafeWriteParent(cwd, target);
	await assertSafeWriteTarget(target);
	const existing = await readFile(target, "utf8").catch(() => null);
	if (existing && existing.trim() !== "") {
		if (!reset) {
			if (isUlwArtifact(existing)) return { relPath, status: "exists" };
			throw new Error(`refused: ${relPath} exists and is not a ulw-plan artifact (pass --reset to overwrite)`);
		}
		if (existing.trim() !== content.trim() && !force) {
			throw new Error(`refused: ${relPath} has edits that differ from a fresh skeleton; pass --reset --force to discard them`);
		}
	}
	await writeFile(target, content, "utf8");
	return { relPath, status: existing ? "reset" : "created" };
}

export async function scaffold(cwd, { slug, intent, reset = false, force = false, draftOnly = false, reviewRequired = false }) {
	const draftRel = join(".omo", "drafts", `${slug}.md`);
	const draft = await writeGuarded(cwd, draftRel, buildDraft(slug, intent, { reviewRequired }), { reset, force });
	if (draftOnly) return [draft];
	const planRel = join(".omo", "plans", `${slug}.md`);
	const plan = await writeGuarded(cwd, planRel, buildPlanSkeleton(slug, intent), { reset, force });
	return [draft, plan];
}

async function main() {
	const { slug, intent, reset, force, draftOnly, reviewRequired } = parseArgs(process.argv);
	const results = await scaffold(process.cwd(), { slug, intent, reset, force, draftOnly, reviewRequired });
	for (const r of results) process.stdout.write(`${r.status}: ${r.relPath}\n`);
	const created = results.some((r) => r.status !== "exists");
	process.stdout.write(
		draftOnly
			? `next: record intent, findings, decisions, review state, and the approval gate in the draft; create the plan only after approval.\n`
			: created
			? `next: record findings/decisions in the draft, then APPEND task batches into the "## Todos" region of the plan; fill "## TL;DR (For humans)" LAST.\n`
			: `skeleton already present - left untouched. APPEND task batches into the "## Todos" region; the human "## TL;DR (For humans)" stays on top.\n`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((err) => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}
