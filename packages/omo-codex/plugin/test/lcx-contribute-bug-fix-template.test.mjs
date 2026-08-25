import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(root, "skills", "lcx-contribute-bug-fix", "scripts", "create-pr-body.mjs");

test("#given complete bug-fix evidence #when creating a PR body #then evidence and machine label are emitted", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);
	const input = {
		title: "Fix Codex skill sync drift",
		targetRepository: "code-yeongyu/lazycodex",
		problem: "Skill sync omitted a shared skill from the aggregate plugin.",
		reproductionLogs: "npm test -- --test-name-pattern sync-skills failed before the fix.",
		approach: "Add the missing shared skill source and sync the aggregate plugin.",
		confidence: "The failing sync test now passes and the aggregate skill matches the source.",
		risks: "Low risk; this changes only packaged skill instructions.",
		userVisibleBehaviorChanges: "Users can ask LazyCodex to contribute a bug-fix PR directly.",
		verification: ["npm test -- --test-name-pattern lcx-contribute-bug-fix", "npm run sync:skills"],
	};

	// when
	const body = createLazyCodexBugFixPrBody(input);

	// then
	for (const field of ["problem", "reproductionLogs", "approach", "confidence", "risks", "userVisibleBehaviorChanges"]) {
		assert.ok(body.includes(input[field]));
	}
	for (const command of input.verification) assert.ok(body.includes(command));
	assert.match(body, /^Tag: lazycodex-generated$/m);
});

test("#given missing bug-fix evidence #when creating a PR body #then the script rejects the incomplete payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/lazycodex",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /reproductionLogs/);
});

test("#given a JSON payload path #when running the PR body script #then markdown is written to the requested file", async () => {
	// given
	const workspace = await mkdtemp(join(tmpdir(), "lcx-pr-body-test-"));
	const inputPath = join(workspace, "input.json");
	const outputPath = join(workspace, "body.md");
	const input = {
		title: "Fix Codex skill sync drift",
		targetRepository: "code-yeongyu/lazycodex",
		problem: "Skill sync omitted a shared skill from the aggregate plugin.",
		reproductionLogs: "node --test failed before the fix.",
		approach: "Add the missing shared skill source and sync the aggregate plugin.",
		confidence: "The failing sync test now passes.",
		risks: "Low risk.",
		userVisibleBehaviorChanges: "Users get a direct bug-fix PR skill.",
		verification: ["node --test test/lcx-contribute-bug-fix-template.test.mjs"],
	};
	await writeFile(inputPath, JSON.stringify(input), "utf8");

	// when
	const { spawnSync } = await import("node:child_process");
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);
	const result = spawnSync(process.execPath, [scriptPath, inputPath, outputPath], { encoding: "utf8" });

	// then
	assert.equal(result.status, 0, result.stderr);
	assert.equal(await readFile(outputPath, "utf8"), createLazyCodexBugFixPrBody(input));
});
