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
		"lazycodex-executor.toml",
		{
			effort: "high",
			includes: [/EVIDENCE_RECORDED: <path>/, /scenario/i, /artifact/i],
		},
	],
	[
		"lazycodex-code-reviewer.toml",
		{
			effort: "xhigh",
			includes: [/codeQualityStatus/, /recommendation/, /\.omo\/evidence\/<goal>-code-review\.md/],
		},
	],
	[
		"lazycodex-qa-executor.toml",
		{
			effort: "medium",
			includes: [/not_applicable/, /surfaceEvidence/, /adversarialCases/],
		},
	],
	[
		"lazycodex-gate-reviewer.toml",
		{
			effort: "xhigh",
			includes: [/APPROVE\/REJECT/, /blockers/, /\.omo\/evidence\/<goal>-gate-review\.md/],
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
		"codex-ultrawork-reviewer.toml",
		"explorer.toml",
		"lazycodex-code-reviewer.toml",
		"lazycodex-executor.toml",
		"lazycodex-gate-reviewer.toml",
		"lazycodex-qa-executor.toml",
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

test("#given planner agent prompt #when inspected #then generated artifacts stay under .omo", async () => {
	const prompt = await readFile(join(root, "components", "ultrawork", "agents", "plan.toml"), "utf8");

	assert.match(prompt, /\.omo\/plans\/<slug>\.md/);
	assert.match(prompt, /\.omo\/evidence\/task-<N>-<slug>\.<ext>/);
	assert.doesNotMatch(prompt, /(?<!\.omo\/)plans\/<slug>\.md/);
	assert.doesNotMatch(prompt, /(?<!\.omo\/)evidence\/task-/);
});

test("#given reviewer agent prompt #when inspected #then default model uses bounded reasoning", async () => {
	const prompt = await readFile(
		join(root, "components", "ultrawork", "agents", "codex-ultrawork-reviewer.toml"),
		"utf8",
	);

	assert.match(prompt, /^model\s*=\s*"gpt-5\.5"$/m);
	assert.match(prompt, /^model_reasoning_effort\s*=\s*"high"$/m);
	assert.doesNotMatch(prompt, /^model_reasoning_effort\s*=\s*"xhigh"$/m);
	assert.doesNotMatch(prompt, /^model\s*=\s*"gpt-5\.2"$/m);
	assert.match(prompt, /ChatGPT account/);
});

test("#given lazycodex agent prompts #when inspected #then each role pins model effort and evidence discipline", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");

	for (const [fileName, invariant] of lazycodexAgentInvariants) {
		const prompt = await readFile(join(agentsDir, fileName), "utf8");

		assert.match(prompt, /^model\s*=\s*"gpt-5\.5"$/m);
		assert.match(prompt, new RegExp(`^model_reasoning_effort\\s*=\\s*"${invariant.effort}"$`, "m"));
		assert.doesNotMatch(prompt, /^tools\s*=/m);
		assert.doesNotMatch(prompt, /^blocking\s*=/m);
		assert.doesNotMatch(prompt, externalSourceTokenPattern);

		for (const pattern of invariant.includes) {
			assert.match(prompt, pattern, `${fileName} must include ${pattern}`);
		}
	}
});
