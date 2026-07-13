import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
	externalSourceTokenPattern,
	lazycodexAgentInvariants,
} from "./aggregate-agent-prompt-invariants.mjs";
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

		const keys = Array.from(
			content.matchAll(/^([a-z_]+)\s*=/gm),
			(match) => match[1],
		);
		for (const key of keys) {
			assert.ok(
				agentSchemaKeys.has(key),
				`${fileName} uses unsupported key ${key}`,
			);
		}
	}
});

test("#given bundled agent TOMLs #when nickname_candidates are inspected #then they use only the codex-accepted charset", async () => {
	// given: codex_app_server ignores a role whose nickname has characters outside
	// ASCII letters, digits, spaces, hyphens, underscores (observed live in task-15 QA)
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const files = (await readdir(agentsDir)).filter((name) =>
		name.endsWith(".toml"),
	);

	// when/then
	for (const file of files) {
		const text = await readFile(join(agentsDir, file), "utf8");
		for (const match of text.matchAll(
			/nickname_candidates\s*=\s*\[([^\]]*)\]/g,
		)) {
			for (const nickname of match[1].matchAll(/"([^"]*)"/g)) {
				assert.match(
					nickname[1],
					/^[A-Za-z0-9 _-]+$/,
					`${file}: nickname "${nickname[1]}"`,
				);
			}
		}
	}
});

test("#given planner agent prompt #when inspected #then generated artifacts stay under .omo", async () => {
	const prompt = await readFile(
		join(root, "components", "ultrawork", "agents", "plan.toml"),
		"utf8",
	);

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
		assert.match(
			prompt,
			new RegExp(`^model_reasoning_effort\\s*=\\s*"${invariant.effort}"$`, "m"),
		);
		assert.doesNotMatch(prompt, /^tools\s*=/m);
		assert.doesNotMatch(prompt, /^blocking\s*=/m);
		assert.doesNotMatch(prompt, externalSourceTokenPattern);

		for (const pattern of invariant.includes) {
			assert.match(prompt, pattern, `${fileName} must include ${pattern}`);
		}
	}
});
