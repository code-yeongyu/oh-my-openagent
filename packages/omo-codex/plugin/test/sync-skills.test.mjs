import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const expectedSkills = [
	"ai-slop-remover",
	"comment-checker",
	"debugging",
	"frontend-ui-ux",
	"init-deep",
	"lsp",
	"planing-prometheustic",
	"programming",
	"refactor",
	"remove-ai-slops",
	"review-work",
	"rules",
	"start-work",
	"ulw-loop",
];

test("#given synced aggregate Codex skills #when inspected #then component and shared skills are present", async () => {
	// given
	const skillsRoot = join(root, "skills");

	// when
	const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// then
	assert.deepEqual(skillNames, expectedSkills);
	for (const skillName of expectedSkills) {
		const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
		assert.match(content, /^---\n/);
	}
});

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop surfaces the ulw-loop alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\nname: ulw-loop\n/m);
	assert.match(skill, /Goal-like loop that uses ultrawork mode to decompose work into systematic, evidence-bound steps\./);
	assert.match(interfaceMetadata, /display_name: "ulw loop"/);
	assert.doesNotMatch(interfaceMetadata, /ulw-loop \/ ulw-loop/);
	assert.match(interfaceMetadata, /short_description: "Goal-like ultrawork loop for systematic decomposition"/);
	assert.match(interfaceMetadata, /default_prompt: "Use \$ulw-loop/);
});

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop remains discoverable as an alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(interfaceMetadata, /search_terms:/);
	assert.match(interfaceMetadata, /- "ulw-loop"/);
});

test("#given synced aggregate Codex skills #when they contain OpenCode orchestration examples #then Codex tool compatibility guidance is injected", async () => {
	// given
	const skillsRoot = join(root, "skills");
	const opencodeOnlyToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

	// when
	const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// then
	for (const skillName of skillNames) {
		const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
		if (!opencodeOnlyToolPattern.test(content)) continue;

		const compatibilityIndex = content.indexOf("## Codex Harness Tool Compatibility");
		assert.notEqual(compatibilityIndex, -1, `${skillName} is missing Codex compatibility guidance`);
		assert.ok(
			compatibilityIndex < content.search(opencodeOnlyToolPattern),
			`${skillName} must explain Codex tool translation before OpenCode-only examples`,
		);
	}
});
