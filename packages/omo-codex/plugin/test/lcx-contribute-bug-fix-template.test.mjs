import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(root, "skills", "lcx-contribute-bug-fix", "scripts", "create-pr-body.mjs");

test("#given complete bug-fix evidence #when creating a PR body #then required LazyCodex sections and label are emitted", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);
	const input = {
		title: "Fix Codex skill sync drift",
		targetRepository: "code-yeongyu/oh-my-openagent",
		problem: "Skill sync omitted a shared skill from the aggregate plugin.",
		reproductionLogs: "npm test -- --test-name-pattern sync-skills failed before the fix.",
		approach: "Add the missing shared skill source and sync the aggregate plugin.",
		confidence: "The failing sync test now passes and the aggregate skill matches the source.",
		risks: "Low risk; this changes only packaged skill instructions.",
		userVisibleBehaviorChanges: "Users can ask LazyCodex to contribute a bug-fix PR directly.",
		globalReviewDebugGate:
			"PASS. review-work all lanes passed; debugging audit covered three hypotheses with redacted evidence.",
		verification: ["npm test -- --test-name-pattern lcx-contribute-bug-fix", "npm run sync:skills"],
	};

	// when
	const body = createLazyCodexBugFixPrBody(input);

	// then
	assert.match(body, /^## Problem Situation/m);
	assert.match(body, /## Reproduction Logs/);
	assert.match(body, /## Approach/);
	assert.match(body, /## Why I Am Confident/);
	assert.match(body, /## Risks/);
	assert.match(body, /## User-Visible Behavior Changes/);
	assert.match(body, /## Verification/);
	assert.match(body, /## Global Review and Debugging Gate/);
	assert.match(body, /review-work all lanes passed/);
	assert.match(body, /lazycodex-generated/);
	assert.match(body, /This PR was debugged, implemented, and created with \[LazyCodex\]/);
});

test("#given missing bug-fix evidence #when creating a PR body #then the script rejects the incomplete payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			globalReviewDebugGate: "PASS with redacted evidence.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /reproductionLogs must be a non-empty string/);
});

test("#given missing global review gate evidence #when creating a PR body #then the script rejects the payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "node --test failed before the fix.",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /globalReviewDebugGate must be a non-empty string/);
});

test("#given incomplete global review gate evidence #when creating a PR body #then the script rejects the payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "node --test failed before the fix.",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			globalReviewDebugGate: "Reviewed locally and looks fine.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /globalReviewDebugGate must start with PASS and include review-work all-lanes/);
});

test("#given negative global review gate evidence #when creating a PR body #then the script rejects the payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "node --test failed before the fix.",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			globalReviewDebugGate: "No PASS: review-work failed and debugging was inconclusive.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /globalReviewDebugGate must start with PASS and include review-work all-lanes/);
});

test("#given global review gate evidence without debugging hypotheses #when creating a PR body #then the script rejects the payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "node --test failed before the fix.",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			globalReviewDebugGate: "PASS. review-work all lanes passed; debugging completed with redacted evidence.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /globalReviewDebugGate must start with PASS and include review-work all-lanes/);
});

test("#given negative global review gate evidence with required keywords #when creating a PR body #then the script rejects the payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "node --test failed before the fix.",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			globalReviewDebugGate:
				"PASS. review-work all lanes failed; debugging hypotheses remained inconclusive; redacted evidence omitted.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /globalReviewDebugGate must start with PASS and include review-work all-lanes/);
});

test("#given raw token-like evidence #when creating a PR body #then the script rejects the payload", async () => {
	// given
	const { createLazyCodexBugFixPrBody } = await import(`file://${scriptPath}`);

	// when
	const action = () =>
		createLazyCodexBugFixPrBody({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: `request used ${"ghp_"}${"1234567890abcdefghijklmnopqrstuvwxyz12"}`,
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a new skill.",
			globalReviewDebugGate:
				"PASS. review-work all lanes passed; debugging audit covered three hypotheses with redacted evidence.",
			verification: ["npm test"],
		});

	// then
	assert.throws(action, /must not contain raw sensitive evidence/);
});

test("#given a JSON payload path #when running the PR body script #then markdown is written to the requested file", async () => {
	// given
	const workspace = await mkdtemp(join(tmpdir(), "lcx-pr-body-test-"));
	const inputPath = join(workspace, "input.json");
	const outputPath = join(workspace, "body.md");
	await writeFile(
		inputPath,
		JSON.stringify({
			title: "Fix Codex skill sync drift",
			targetRepository: "code-yeongyu/oh-my-openagent",
			problem: "Skill sync omitted a shared skill from the aggregate plugin.",
			reproductionLogs: "node --test failed before the fix.",
			approach: "Add the missing shared skill source and sync the aggregate plugin.",
			confidence: "The failing sync test now passes.",
			risks: "Low risk.",
			userVisibleBehaviorChanges: "Users get a direct bug-fix PR skill.",
			globalReviewDebugGate:
				"PASS. review-work all lanes passed; debugging audit covered three hypotheses with redacted evidence.",
			verification: ["node --test test/lcx-contribute-bug-fix-template.test.mjs"],
		}),
		"utf8",
	);

	// when
	const { spawnSync } = await import("node:child_process");
	const result = spawnSync(process.execPath, [scriptPath, inputPath, outputPath], { encoding: "utf8" });

	// then
	assert.equal(result.status, 0, result.stderr);
	assert.match(await readFile(outputPath, "utf8"), /## User-Visible Behavior Changes/);
});
