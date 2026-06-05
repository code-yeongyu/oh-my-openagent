import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

test("#given bundled model catalog #when inspected #then default verifier and worker roles are pinned", async () => {
	const catalog = JSON.parse(await readFile(join(root, "model-catalog.json"), "utf8"));

	assert.equal(catalog.current.model, "gpt-5.5");
	assert.equal(catalog.current.model_context_window, 400000);
	assert.equal(catalog.current.model_reasoning_effort, "high");
	assert.equal(catalog.current.plan_mode_reasoning_effort, "xhigh");
	assert.deepEqual(catalog.roles.default, catalog.current);
	assert.deepEqual(catalog.roles.verifier, {
		model: "gpt-5.5",
		model_reasoning_effort: "xhigh",
	});
	assert.deepEqual(catalog.roles.worker, {
		model: "gpt-5.4",
		model_reasoning_effort: "high",
	});
});

test("#given Codex-facing orchestration surfaces #when inspected #then retired ChatGPT-account model names are not recommended", async () => {
	const promptFiles = [
		join(root, "skills", "ulw-loop", "references", "full-workflow.md"),
		join(root, "components", "ulw-loop", "skills", "ulw-loop", "references", "full-workflow.md"),
		join(root, "components", "ultrawork", "README.md"),
		join(root, "components", "ultrawork", "CHANGELOG.md"),
		join(root, "components", "rules", "src", "post-compact-budget.ts"),
	];

	const staleReferences = [];
	for (const promptPath of promptFiles) {
		const content = await readFile(promptPath, "utf8");
		if (/gpt-5\.(?:2|3-codex)/i.test(content)) {
			staleReferences.push(`${basename(dirname(promptPath))}/${basename(promptPath)}`);
		}
	}

	assert.deepEqual(staleReferences, []);
});
