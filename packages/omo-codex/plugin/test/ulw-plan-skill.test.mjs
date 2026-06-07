import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillPath = join(root, "skills", "ulw-plan", "SKILL.md");
const workflowPath = join(root, "skills", "ulw-plan", "references", "full-workflow.md");
const opencodeOnlyToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

test("#given ulw-plan skill #when inspected #then it is a Codex-native planner that defers the deep workflow to its reference", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");

	// then
	assert.match(skill, /^---\r?\nname: ulw-plan\r?\n/m);
	assert.match(skill, /references\/full-workflow\.md/);
	assert.match(skill, /spawn_agent\(\{[^)]*"fork_turns":"none"/);
	assert.doesNotMatch(skill, opencodeOnlyToolPattern);
});

test("#given ulw-plan skill #when the planning gate is inspected #then it explores first and waits for explicit user approval instead of auto-transitioning", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");

	// then
	assert.match(skill, /explore/i);
	assert.match(skill, /wait for[^.]{0,80}explicit[^.]{0,40}(?:okay|approval)/i);
	assert.doesNotMatch(skill, /Proceeding to plan generation/);
});

test("#given ulw-plan full workflow reference #when inspected #then it documents the approval gate and .omo plan output with Codex-native tools only", async () => {
	// given
	const workflow = await readFile(workflowPath, "utf8");

	// then
	assert.match(workflow, /\.omo\/plans\/<slug>\.md/);
	assert.match(workflow, /[Aa]pproval gate/);
	assert.match(workflow, /spawn_agent\(\{[^)]*"fork_turns":"none"/);
	assert.doesNotMatch(workflow, opencodeOnlyToolPattern);
	assert.doesNotMatch(workflow, /Proceeding to plan generation/);
});
