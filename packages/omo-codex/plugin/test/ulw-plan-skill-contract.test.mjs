import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readUlwPlanCopies() {
	const componentPath = join(root, "components", "ultrawork", "skills", "ulw-plan", "SKILL.md");
	const packagedPath = join(root, "skills", "ulw-plan", "SKILL.md");
	return [
		{ label: "component", path: componentPath, content: await readFile(componentPath, "utf8") },
		{ label: "packaged", path: packagedPath, content: await readFile(packagedPath, "utf8") },
	];
}

test("#given ulw-plan skill #when Codex delegation is inspected #then spawned planners block dependent work", async () => {
	for (const copy of await readUlwPlanCopies()) {
		assert.match(copy.content, /multi_agent_v1\.spawn_agent/, `${copy.label}: must document Codex spawning`);
		assert.match(copy.content, /multi_agent_v1\.wait_agent/, `${copy.label}: must document Codex waiting`);
		assert.match(
			copy.content,
			/Spawn every independent child for the current wave first/i,
			`${copy.label}: must preserve independent spawn waves`,
		);
		assert.match(
			copy.content,
			/After the wave\s+is launched[\s\S]{0,240}multi_agent_v1\.wait_agent[\s\S]{0,240}terminal status/i,
			`${copy.label}: must wait after the wave is launched`,
		);
		assert.doesNotMatch(
			copy.content,
			/Immediately after any `multi_agent_v1\.spawn_agent`/i,
			`${copy.label}: must not serialize independent spawns`,
		);
		assert.match(copy.content, /terminal status/i, `${copy.label}: must wait until terminal status`);
		assert.match(
			copy.content,
			/do not start dependent planning, drafting, approval-gate work, or final handoff/i,
			`${copy.label}: must block dependent planning work before child results are integrated`,
		);
	}
});
