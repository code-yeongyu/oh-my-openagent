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
// WRITE BOUNDARY: the prometheus-md-only hook gates Write/Edit but NOT Bash, so
// this node:fs script writes out of band of that hook. It self-guards THIS script's
// own writes to resolve under .omo/ (it does not, and cannot, contain other Bash
// commands; it only guarantees the mandated generator never escapes .omo). Mirrors
// packages/omo-opencode/src/hooks/prometheus-md-only/path-policy.ts.

import { lstat, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

// The canonical AI-plan section headers, in order. references/full-workflow.md
// documents this exact list; a build-time test asserts the two never drift.
export const PLAN_SECTION_HEADERS = [
	"## TL;DR (For humans)",
	"## Scope",
	"## Verification strategy",
	"## Execution strategy",
	"## Todos",
	"## Final verification wave",
	"## Commit strategy",
	"## Success criteria",
];

export const FINAL_VERIFICATION_ITEMS = [
	"F1. Plan compliance audit",
	"F2. Code quality review",
	"F3. Real manual QA",
	"F4. Scope fidelity",
];

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

// Resolve a project-relative path and confine it under .omo/ - the script's own
// enforcement of the prometheus planner write boundary.
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

export function buildDraft(slug, intent, { reviewRequired = false } = {}) {
	const assumptionsNote =
		intent === "unclear"
			? "Intent is UNCLEAR: research resolves ambiguity, defaults are adopted (not asked), and each is surfaced in the plan's human TL;DR for veto."
			: "Record any default you adopt instead of asking, so the user can veto it at the gate.";
	const reviewState = reviewRequired
		? `review_required: true
plan_path: .omo/plans/${slug}.md
plan_sha256: null
review_round_id: null
pending-action: write and review .omo/plans/${slug}.md
review:
  momus:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .omo/plans/${slug}.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null
  independent:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .omo/plans/${slug}.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null`
		: `review_required: false
pending-action: write .omo/plans/${slug}.md`;
	return `---
slug: ${slug}
status: drafting
intent: ${intent}
${reviewState}
approach: <fill: the approach you intend to plan>
---

# Draft: ${slug}

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- ${assumptionsNote} -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)

<!-- Epistemic workflow ledgers: keep expected truth, observed reality, diff, and independent evidence linked. -->

## Claim graph
<!-- claim id | expected truth | observed reality | diff | support | counterevidence | status -->

## Observation manifest
<!-- observation id | source | observer group | independence basis | artifact path | valid at | contamination notes -->

## Verification economics
<!-- claim/risk | error cost | verification cost | chosen proof path | outcome | residual risk -->

## Cause disappearance
<!-- cause id | violated invariant | previous observation | disconfirming observation | status | proof artifact -->

## Decisions (with rationale)

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: drafting
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
`;
}

export function buildPlanSkeleton(slug, intent) {
	const decisionsLine =
		intent === "unclear"
			? "**Decisions I made for you:** <fill last - the best-practice defaults you adopted; the user vetoes any here>"
			: "**Decisions to sanity-check:** <fill last - the few choices worth a human glance>";
	return `# ${slug} - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** <fill last - deliverables in human terms, 1-2 sentences>

**Why this approach:** <fill last - the one or two load-bearing decisions and why>

**What it will NOT do:** <fill last - 1-3 plain lines mirroring Must NOT have>

**Effort:** <Quick | Short | Medium | Large | XL>
**Risk:** <Low | Medium | High> - <one-line driver>
${decisionsLine}

Your next move: <fill - e.g. approve, or run a high-accuracy review>. Full execution detail follows below.

---

> TL;DR (machine): <1 line - effort, risk, deliverables>

## Scope
### Must have
### Must NOT have (guardrails, anti-slop, scope boundaries)

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: <TDD | tests-after | none> + framework
- Evidence: <attemptDir>/task-<N>-${slug}.<ext> (attemptDir = currentAttemptDir from 'omo ulw-loop status --json', .omo/evidence/ulw/<session>/<goalId>/a<attempt>; outside ulw-loop use .omo/evidence/)

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. <title>
  What to do / Must NOT do: <...>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
  References (executor has NO interview context - be exhaustive): <src/path:lines>
  Acceptance criteria (agent-executable): <exact command or assertion>
  QA scenarios (name the exact tool + invocation): happy + failure, Evidence <attemptDir>/task-1-${slug}.<ext>
  Commit: <Y/N> | <type>(<scope>): <summary>

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
${FINAL_VERIFICATION_ITEMS.map((item) => `- [ ] ${item}`).join("\n")}

## Commit strategy

## Success criteria
`;
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
