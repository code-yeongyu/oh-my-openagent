import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import {
	findInvalidSpawnAgentRoleParameters,
	findSpawnAgentCallsWithoutForkContextFalse,
	root,
} from "./aggregate-plugin-fixture.mjs";

test("#given synced skills with Codex compatibility guidance #when spawn_agent is documented #then invalid role parameters are absent", async () => {
	const skillsDir = join(root, "skills");
	const skillEntries = await readdir(skillsDir, { withFileTypes: true });
	const skillFiles = skillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(skillsDir, entry.name, "SKILL.md"));

	const invalidCalls = [];
	for (const skillPath of skillFiles) {
		const content = await readFile(skillPath, "utf8");
		for (const call of findInvalidSpawnAgentRoleParameters(content)) {
			invalidCalls.push(`${basename(dirname(skillPath))}/${basename(skillPath)}: ${call}`);
		}
	}

	assert.deepEqual(invalidCalls, []);
});

test('#given synced skills and bundled rules #when role-specific agents are spawned #then they set fork_context=false', async () => {
	const skillsDir = join(root, "skills");
	const skillEntries = await readdir(skillsDir, { withFileTypes: true });
	const promptFiles = skillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(skillsDir, entry.name, "SKILL.md"));
	promptFiles.push(join(root, "components", "rules", "bundled-rules", "hephaestus.md"));

	const missingForkContext = [];
	for (const promptPath of promptFiles) {
		const content = await readFile(promptPath, "utf8");
		for (const call of findSpawnAgentCallsWithoutForkContextFalse(content)) {
			missingForkContext.push(`${basename(dirname(promptPath))}/${basename(promptPath)}: ${call}`);
		}
	}

	assert.deepEqual(missingForkContext, []);
});

test("#given long-running orchestration prompts #when waiting on child agents #then parent liveness is surfaced", async () => {
	const promptFiles = [
		join(root, "skills", "ulw-loop", "SKILL.md"),
		join(root, "skills", "ulw-loop", "references", "full-workflow.md"),
		join(root, "skills", "review-work", "SKILL.md"),
		join(root, "skills", "start-work", "SKILL.md"),
		join(root, "components", "rules", "bundled-rules", "hephaestus.md"),
	];

	const missingLivenessGuidance = [];
	for (const promptPath of promptFiles) {
		const content = await readFile(promptPath, "utf8");
		if (!/active\s+subagent count/.test(content) || !/latest `WORKING:` phase/.test(content)) {
			missingLivenessGuidance.push(`${basename(dirname(promptPath))}/${basename(promptPath)}`);
		}
	}

	assert.deepEqual(missingLivenessGuidance, []);
});
