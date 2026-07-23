import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

const agentSchemaKeys = new Set([
	"name",
	"description",
	"nickname_candidates",
	"model",
	"model_reasoning_effort",
	"service_tier",
	"developer_instructions",
]);

const lazycodexAgentInvariants = new Map([
	[
		"explorer.toml",
		{
			model: "gpt-5.6-luna",
			effort: "low",
			includes: [/Read-only/, /working tree/, /rg/],
		},
	],
	[
		"librarian.toml",
		{
			model: "gpt-5.6-luna",
			effort: "low",
			includes: [/Read-only/, /SHA-pinned GitHub permalink/, /external/],
		},
	],
	[
		"metis.toml",
		{
			model: "gpt-5.6-sol",
			effort: "high",
			includes: [/pre-planning analyst/i, /contradictions/, /Read-only/],
		},
	],
	[
		"momus.toml",
		{
			model: "gpt-5.6-terra",
			effort: "high",
			includes: [/plan reviewer/i, /OKAY, ITERATE, or REJECT/, /Read-only/],
		},
	],
	[
		"plan.toml",
		{
			model: "gpt-5.6-sol",
			effort: "high",
			includes: [/strategic planning consultant/i, /\.omo\/plans\/<slug>\.md/, /never implements/i],
		},
	],
	[
		"lazycodex-worker-low.toml",
		{
			model: "gpt-5.6-luna",
			effort: "high",
			includes: [/EVIDENCE_RECORDED: <path>/, /low-difficulty/i, /smallest correct change/i],
		},
	],
	[
		"lazycodex-worker-medium.toml",
		{
			model: "gpt-5.6-terra",
			effort: "high",
			includes: [/EVIDENCE_RECORDED: <path>/, /medium-difficulty/i, /smallest correct change/i],
		},
	],
	[
		"lazycodex-worker-high.toml",
		{
			model: "gpt-5.6-sol",
			effort: "medium",
			includes: [/EVIDENCE_RECORDED: <path>/, /high-difficulty/i, /smallest correct change/i],
		},
	],
	[
		"lazycodex-clone-fidelity-reviewer.toml",
		{
			model: "gpt-5.6-terra",
			effort: "high",
			includes: [/recommendation/, /blockers/, /\.omo\/evidence\/<goal>-clone-fidelity\.md/],
		},
	],
	[
		"lazycodex-code-reviewer.toml",
		{
			model: "gpt-5.6-terra",
			effort: "medium",
			includes: [/codeQualityStatus/, /recommendation/, /<attemptDir>\/<goalId>-code-review\.md/, /currentAttemptDir/],
		},
	],
	[
		"lazycodex-qa-executor.toml",
		{
			model: "gpt-5.6-luna",
			effort: "high",
			includes: [/not_applicable/, /surfaceEvidence/, /adversarialCases/, /<attemptDir>\/<goalId>-manual-qa\.md/],
		},
	],
	[
		"lazycodex-gate-reviewer.toml",
		{
			model: "gpt-5.6-sol",
			effort: "low",
			includes: [/APPROVE\/REJECT/, /blockers/, /<attemptDir>\/<goalId>-gate-review\.md/, /currentAttemptDir/],
		},
	],
]);

const externalSourceTokenPattern = new RegExp(
	["ga" + "jae", "ga" + "jae" + "code", "ga" + "jae-code", "\uAC00\uC7AC", "g" + "jc"].join("|"),
	"i",
);

test("#given bundled Codex agents #when components/ultrawork/agents directory is scanned #then planner support TOMLs are present and match expected schema keys", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const entries = (await readdir(agentsDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
		.map((entry) => entry.name)
		.sort();

	assert.deepEqual(entries, [
		"explorer.toml",
		"lazycodex-clone-fidelity-reviewer.toml",
		"lazycodex-code-reviewer.toml",
		"lazycodex-gate-reviewer.toml",
		"lazycodex-qa-executor.toml",
		"lazycodex-worker-high.toml",
		"lazycodex-worker-low.toml",
		"lazycodex-worker-medium.toml",
		"librarian.toml",
		"metis.toml",
		"momus.toml",
		"plan.toml",
	]);

	for (const fileName of entries) {
		const content = await readFile(join(agentsDir, fileName), "utf8");
		assert.match(content, /^name\s*=\s*".+"$/m);
		assert.match(content, /^description\s*=\s*".+"$/m);
		assert.match(content, /^nickname_candidates\s*=\s*\[.+\]$/m);
		assert.match(content, /^model\s*=\s*".+"$/m);
		assert.match(content, /^model_reasoning_effort\s*=\s*".+"$/m);
		assert.match(content, /^developer_instructions\s*=\s*"""/m);

		const keys = Array.from(content.matchAll(/^([a-z_]+)\s*=/gm), (match) => match[1]);
		for (const key of keys) {
			assert.ok(agentSchemaKeys.has(key), `${fileName} uses unsupported key ${key}`);
		}
	}
});

test("#given bundled agent TOMLs #when nickname_candidates are inspected #then they use only the codex-accepted charset", async () => {
	// given: codex_app_server ignores a role whose nickname has characters outside
	// ASCII letters, digits, spaces, hyphens, underscores (observed live in task-15 QA)
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const files = (await readdir(agentsDir)).filter((name) => name.endsWith(".toml"));

	// when/then
	for (const file of files) {
		const text = await readFile(join(agentsDir, file), "utf8");
		for (const match of text.matchAll(/nickname_candidates\s*=\s*\[([^\]]*)\]/g)) {
			for (const nickname of match[1].matchAll(/"([^"]*)"/g)) {
				assert.match(nickname[1], /^[A-Za-z0-9 _-]+$/, `${file}: nickname "${nickname[1]}"`);
			}
		}
	}
});

test("#given planner agent prompt #when inspected #then generated artifacts stay under .omo", async () => {
	const prompt = await readFile(join(root, "components", "ultrawork", "agents", "plan.toml"), "utf8");

	assert.match(prompt, /\.omo\/plans\/<slug>\.md/);
	assert.match(prompt, /<attemptDir>\/task-<N>-<slug>\.<ext>/);
	assert.match(prompt, /\.omo\/evidence\/ulw\/<session>\/<goalId>\/a<attempt>/);
	assert.doesNotMatch(prompt, /(?<!\.omo\/)plans\/<slug>\.md/);
	assert.doesNotMatch(prompt, /(?<!\.omo\/)evidence\/task-/);
});

test("#given lazycodex agent prompts #when inspected #then each role pins model effort and evidence discipline", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");

	for (const [fileName, invariant] of lazycodexAgentInvariants) {
		const prompt = await readFile(join(agentsDir, fileName), "utf8");

		const escapedModel = invariant.model.replace(/\./g, "\\.");
		assert.match(prompt, new RegExp(`^model\\s*=\\s*"${escapedModel}"$`, "m"));
		assert.match(prompt, new RegExp(`^model_reasoning_effort\\s*=\\s*"${invariant.effort}"$`, "m"));
		assert.doesNotMatch(prompt, /^tools\s*=/m);
		assert.doesNotMatch(prompt, /^blocking\s*=/m);
		assert.doesNotMatch(prompt, externalSourceTokenPattern);

		for (const pattern of invariant.includes) {
			assert.match(prompt, pattern, `${fileName} must include ${pattern}`);
		}
	}
});

test("#given LazyCodex reviewer prompts #when inspected #then anti-slop review coverage is required", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const codeReviewer = await readFile(join(agentsDir, "lazycodex-code-reviewer.toml"), "utf8");
	const gateReviewer = await readFile(join(agentsDir, "lazycodex-gate-reviewer.toml"), "utf8");

	assert.match(codeReviewer, /remove-ai-slops/);
	assert.match(codeReviewer, /programming/);
	assert.match(codeReviewer, /load or consult/);
	assert.match(codeReviewer, /documented criteria/);
	assert.match(codeReviewer, /violates either skill perspective/);
	assert.match(codeReviewer, /overfit\/slop review pass/);
	assert.match(codeReviewer, /deletion-only tests/);
	assert.match(codeReviewer, /tests that merely verify a requested removal/);
	assert.match(codeReviewer, /tautological tests/);
	assert.match(codeReviewer, /mirror implementation constants/);
	assert.match(codeReviewer, /unnecessary production data extraction, parsing, or normalization/);
	assert.match(codeReviewer, /false confidence/);

	assert.match(gateReviewer, /remove-ai-slops/);
	assert.match(gateReviewer, /programming/);
	assert.match(gateReviewer, /load or consult/);
	assert.match(gateReviewer, /documented criteria/);
	assert.match(gateReviewer, /Run the `remove-ai-slops`/);
	assert.match(gateReviewer, /Apply the `programming`/);
	assert.match(gateReviewer, /overfit\/slop pass yourself/);
	assert.match(gateReviewer, /tests that merely verify a requested removal/);
	assert.match(gateReviewer, /deletion-only/);
	assert.match(gateReviewer, /tautological/);
	assert.match(gateReviewer, /implementation-mirroring tests/);
	assert.match(gateReviewer, /unnecessary production extraction, parsing, or normalization/);

	const directPassIndex = gateReviewer.indexOf("overfit/slop pass yourself");
	const reportCoverageIndex = gateReviewer.indexOf("Then confirm the code review report");
	assert.notEqual(directPassIndex, -1);
	assert.notEqual(reportCoverageIndex, -1);
	assert.ok(
		directPassIndex < reportCoverageIndex,
		"gate reviewer must perform the overfit/slop pass directly before checking report coverage",
	);
});

test("#given done-gate reviewer prompts #when inspected #then burden of proof is approve-unless-cited and reject priors are gone", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const gateReviewer = await readFile(join(agentsDir, "lazycodex-gate-reviewer.toml"), "utf8");
	const qaExecutor = await readFile(join(agentsDir, "lazycodex-qa-executor.toml"), "utf8");
	const codeReviewer = await readFile(join(agentsDir, "lazycodex-code-reviewer.toml"), "utf8");

	assert.match(gateReviewer, /APPROVE unless you can cite/);
	assert.match(gateReviewer, /violatedCriterion/);
	assert.match(gateReviewer, /evidencePointer/);
	assert.match(gateReviewer, /top blockers inline/);
	assert.match(gateReviewer, /is a NOTE, not a blocker/);
	assert.match(gateReviewer, /You do NOT check/);
	assert.doesNotMatch(gateReviewer, /Assume the work has already failed/);
	assert.doesNotMatch(gateReviewer, /Return exactly one recommendation: APPROVE\/REJECT\./);

	assert.match(qaExecutor, /one-line reason/);
	assert.match(qaExecutor, /rejecting a legitimately untriggered class is itself an error/);
	assert.doesNotMatch(qaExecutor, /Trust nothing\./);

	assert.match(codeReviewer, /MEDIUM by default/);
	assert.doesNotMatch(codeReviewer, /Treat useless tests or needless production complexity as CRITICAL\/HIGH/);
});

