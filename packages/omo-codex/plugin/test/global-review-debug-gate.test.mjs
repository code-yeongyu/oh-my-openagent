import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given start-work continuation directive #when inspected #then final handoff requires review and debugging gate", async () => {
	const text = await readFile(join(pluginRoot, "components", "start-work-continuation", "directive.md"), "utf8");

	assert.match(text, /Global Review and Debugging Gate/);
	assert.match(text, /review-work/);
	assert.match(text, /debugging/);
	assert.match(text, /Do not print `ORCHESTRATION COMPLETE`/);
	assert.match(text, /Do not create a PR, PR handoff, or branch handoff/);
	assert.match(text, /redact.*secrets.*PII/s);
});

test("#given Hephaestus baseline rule #when inspected #then significant implementation and PR handoff require the same gate", async () => {
	const text = await readFile(join(pluginRoot, "components", "rules", "bundled-rules", "hephaestus.md"), "utf8");

	assert.match(text, /Global Review and Debugging Gate/);
	assert.match(text, /significant implementation work/);
	assert.match(text, /review-work/);
	assert.match(text, /debugging/);
	assert.match(text, /PR handoff/);
	assert.match(text, /redact.*secrets.*PII/s);
});
