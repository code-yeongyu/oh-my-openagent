import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(root, "skills", "ulw-plan", "scripts", "scaffold-plan.mjs");
const scriptUrl = pathToFileURL(scriptPath).href;
const workflowPath = join(root, "skills", "ulw-plan", "references", "full-workflow.md");

test("#given the scaffold script and the workflow reference #when compared #then every plan header the script emits is documented in full-workflow.md (no drift)", async () => {
	// given
	const { PLAN_SECTION_HEADERS } = await import(scriptUrl);
	const workflow = await readFile(workflowPath, "utf8");

	// then --- the script is the single source of the plan shape; the reference must document the same headers
	assert.ok(PLAN_SECTION_HEADERS.length >= 6);
	for (const header of PLAN_SECTION_HEADERS) {
		assert.ok(workflow.includes(header), `full-workflow.md is missing plan header: ${header}`);
	}
});

test("#given buildPlanSkeleton #when intent is unclear #then the human TL;DR leads the plan and surfaces the decisions veto block", async () => {
	// given
	const { buildPlanSkeleton, PLAN_SECTION_HEADERS } = await import(scriptUrl);
	const plan = buildPlanSkeleton("demo", "unclear");

	// then --- the human-readable summary is on top, above the AI detail
	assert.ok(plan.indexOf("## TL;DR (For humans)") < plan.indexOf("## Scope"));
	assert.match(plan, /Decisions I made for you/);
	for (const header of PLAN_SECTION_HEADERS) {
		assert.ok(plan.includes(header), `plan skeleton missing header: ${header}`);
	}
});

test("#given buildPlanSkeleton #when intent is clear #then it surfaces a decisions-to-sanity-check block instead", async () => {
	// given
	const { buildPlanSkeleton } = await import(scriptUrl);
	const plan = buildPlanSkeleton("demo", "clear");

	// then
	assert.match(plan, /Decisions to sanity-check/);
	assert.doesNotMatch(plan, /Decisions I made for you/);
});

test("#given resolveSafeOmoPath #when the target escapes .omo or the workspace #then it is refused (the script never escapes .omo)", async () => {
	// given
	const { resolveSafeOmoPath } = await import(scriptUrl);
	const cwd = "/tmp/ws";

	// then --- the prometheus-md-only hook gates Write/Edit but not Bash, so the script self-guards its own writes
	assert.ok(resolveSafeOmoPath(cwd, ".omo/plans/x.md").endsWith("x.md"));
	assert.throws(() => resolveSafeOmoPath(cwd, "../escape/x.md"));
	assert.throws(() => resolveSafeOmoPath(cwd, "src/x.md"));
	assert.throws(() => resolveSafeOmoPath(cwd, ".omo/plans/x.txt"));
	assert.throws(() => resolveSafeOmoPath(cwd, "/etc/passwd.md"));
});

test("#given scaffold #when .omo/plans is a symlink outside the workspace #then it refuses before the plan write escapes", async () => {
	// given
	const { scaffold } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "ulwp-"));
	const outside = await mkdtemp(join(tmpdir(), "ulwp-outside-"));
	try {
		await mkdir(join(dir, ".omo"), { recursive: true });
		await symlink(outside, join(dir, ".omo", "plans"), "dir");

		// when / then
		await assert.rejects(() => scaffold(dir, { slug: "demo", intent: "clear" }), /refused/);
		assert.deepEqual(await readdir(outside), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});

test("#given scaffold #when .omo/drafts is a symlink outside the workspace #then it refuses before the draft write escapes", async () => {
	// given
	const { scaffold } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "ulwp-"));
	const outside = await mkdtemp(join(tmpdir(), "ulwp-outside-"));
	try {
		await mkdir(join(dir, ".omo"), { recursive: true });
		await symlink(outside, join(dir, ".omo", "drafts"), "dir");

		// when / then
		await assert.rejects(() => scaffold(dir, { slug: "demo", intent: "clear" }), /refused/);
		assert.deepEqual(await readdir(outside), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});

test("#given parseArgs #when the slug is missing or unsafe #then it throws, and valid flags parse", async () => {
	// given
	const { parseArgs } = await import(scriptUrl);

	// then
	assert.throws(() => parseArgs(["node", "s"]));
	assert.throws(() => parseArgs(["node", "s", "../evil"]));
	assert.throws(() => parseArgs(["node", "s", "Bad_Slug"]));
	const ok = parseArgs(["node", "s", "my-plan", "--unclear", "--reset", "--force"]);
	assert.equal(ok.slug, "my-plan");
	assert.equal(ok.intent, "unclear");
	assert.equal(ok.reset, true);
	assert.equal(ok.force, true);
	assert.equal(ok.draftOnly, false);
	assert.equal(ok.reviewRequired, false);
	const draftOnly = parseArgs(["node", "s", "my-plan", "--draft-only"]);
	assert.equal(draftOnly.draftOnly, true);
	const reviewRequired = parseArgs(["node", "s", "my-plan", "--draft-only", "--review-required"]);
	assert.equal(reviewRequired.reviewRequired, true);
	const plain = parseArgs(["node", "s", "my-plan"]);
	assert.equal(plain.reset, false);
	assert.equal(plain.force, false);
});

test("#given an explicit review modifier at startup #when draft-only scaffold runs #then the first durable write contains the complete pending review request", async () => {
	const { scaffold } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "ulwp-"));
	try {
		await scaffold(dir, { slug: "demo", intent: "clear", draftOnly: true, reviewRequired: true });
		const draft = await readFile(join(dir, ".omo", "drafts", "demo.md"), "utf8");
		assert.match(draft, /review_required: true/);
		assert.match(draft, /plan_path: \.omo\/plans\/demo\.md/);
		assert.match(draft, /pending-action: write and review \.omo\/plans\/demo\.md/);
		assert.match(draft, /momus:\n\s+status: pending/);
		assert.match(draft, /independent:\n\s+status: pending/);
		await assert.rejects(() => readFile(join(dir, ".omo", "plans", "demo.md"), "utf8"), /ENOENT/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given automatic review for non-Trivial UNCLEAR intent #when draft-only scaffold runs #then the first durable write contains the complete pending review request", async () => {
	const { scaffold } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "ulwp-"));
	try {
		await scaffold(dir, { slug: "demo", intent: "unclear", draftOnly: true, reviewRequired: true });
		const draft = await readFile(join(dir, ".omo", "drafts", "demo.md"), "utf8");
		assert.match(draft, /intent: unclear/);
		assert.match(draft, /review_required: true/);
		assert.match(draft, /plan_path: \.omo\/plans\/demo\.md/);
		assert.match(draft, /plan_sha256: null/);
		assert.match(draft, /review_round_id: null/);
		assert.match(draft, /pending-action: write and review \.omo\/plans\/demo\.md/);
		assert.match(draft, /momus:\n\s+status: pending[\s\S]*?target: \.omo\/plans\/demo\.md[\s\S]*?result: null/);
		assert.match(draft, /independent:\n\s+status: pending[\s\S]*?target: \.omo\/plans\/demo\.md[\s\S]*?result: null/);
		await assert.rejects(() => readFile(join(dir, ".omo", "plans", "demo.md"), "utf8"), /ENOENT/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given Trivial UNCLEAR pre-approval planning #when draft-only scaffold runs #then it creates a review-optional draft without creating a plan", async () => {
	const { scaffold } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "ulwp-"));
	try {
		const first = await scaffold(dir, { slug: "demo", intent: "unclear", draftOnly: true });
		assert.equal(first.length, 1);
		assert.equal(first[0].status, "created");
		assert.match(await readFile(join(dir, ".omo", "drafts", "demo.md"), "utf8"), /intent: unclear/);
		assert.match(await readFile(join(dir, ".omo", "drafts", "demo.md"), "utf8"), /review_required: false/);
		await assert.rejects(() => readFile(join(dir, ".omo", "plans", "demo.md"), "utf8"), /ENOENT/);

		const afterApproval = await scaffold(dir, { slug: "demo", intent: "unclear" });
		assert.equal(afterApproval[0].status, "exists");
		assert.equal(afterApproval[1].status, "created");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given an already-scaffolded plan #when the script is re-run plain #then it is a no-op that preserves appended todos (resume-safe, no crash, no clobber)", async () => {
	// given
	const { scaffold } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "ulwp-"));
	try {
		await scaffold(dir, { slug: "demo", intent: "unclear" });
		const planPath = join(dir, ".omo", "plans", "demo.md");
		const original = await readFile(planPath, "utf8");
		const appended = original.replace(
			"- [ ] 1. <title>",
			"- [ ] 1. real appended todo\n- [ ] 2. second appended todo",
		);
		await writeFile(planPath, appended, "utf8");

		// when --- a model resuming after compaction re-runs the mandated script
		const result = await scaffold(dir, { slug: "demo", intent: "unclear" });

		// then --- no throw, reported as existing, appended work intact
		assert.equal(result[1].status, "exists");
		const after = await readFile(planPath, "utf8");
		assert.ok(after.includes("real appended todo"));
		assert.ok(after.includes("second appended todo"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given a hand-edited plan #when --reset is used #then it refuses without --force and overwrites with --force", async () => {
	// given
	const { scaffold } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "ulwp-"));
	try {
		await scaffold(dir, { slug: "demo", intent: "clear" });
		const planPath = join(dir, ".omo", "plans", "demo.md");
		await writeFile(
			planPath,
			(await readFile(planPath, "utf8")).replace("- [ ] 1. <title>", "- [ ] 1. real work"),
			"utf8",
		);

		// then --- reset alone refuses to discard edits
		await assert.rejects(() => scaffold(dir, { slug: "demo", intent: "clear", reset: true }));

		// and --- reset + force overwrites
		const forced = await scaffold(dir, { slug: "demo", intent: "clear", reset: true, force: true });
		assert.equal(forced[1].status, "reset");
		assert.doesNotMatch(await readFile(planPath, "utf8"), /real work/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
