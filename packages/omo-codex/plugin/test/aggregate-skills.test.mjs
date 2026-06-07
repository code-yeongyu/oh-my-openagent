import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import {
	findRoleSpecificSpawnsWithoutForkTurnsNone,
	findSpawnAgentTypes,
	root,
} from "./aggregate-plugin-fixture.mjs";

test("#given synced skills with Codex compatibility guidance #when a bundled agent_type is referenced #then a matching TOML is bundled", async () => {
	const skillsDir = join(root, "skills");
	const skillEntries = await readdir(skillsDir, { withFileTypes: true });
	const skillFiles = skillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(skillsDir, entry.name, "SKILL.md"));

	const referencedAgentTypes = new Set();
	for (const skillPath of skillFiles) {
		const content = await readFile(skillPath, "utf8");
		for (const agentType of findSpawnAgentTypes(content)) {
			if (agentType === "worker" || agentType === "codex-ultrawork-reviewer") {
				continue;
			}
			referencedAgentTypes.add(agentType);
		}
	}

	const expected = [...referencedAgentTypes].sort();
	assert.deepEqual(expected, ["explorer", "librarian", "metis", "momus", "plan"]);

	for (const agentType of expected) {
		const tomlPath = join(root, "components", "ultrawork", "agents", `${agentType}.toml`);
		const fileStat = await stat(tomlPath);
		assert.equal(fileStat.isFile(), true);
		assert.equal(basename(tomlPath), `${agentType}.toml`);
	}
});

test('#given synced skills and bundled rules #when role-specific agents are spawned #then they set fork_turns="none"', async () => {
	const skillsDir = join(root, "skills");
	const skillEntries = await readdir(skillsDir, { withFileTypes: true });
	const promptFiles = skillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(skillsDir, entry.name, "SKILL.md"));
	promptFiles.push(join(root, "components", "rules", "bundled-rules", "hephaestus.md"));

	const missingForkTurns = [];
	for (const promptPath of promptFiles) {
		const content = await readFile(promptPath, "utf8");
		for (const call of findRoleSpecificSpawnsWithoutForkTurnsNone(content)) {
			missingForkTurns.push(`${basename(dirname(promptPath))}/${basename(promptPath)}: ${call}`);
		}
	}

	assert.deepEqual(missingForkTurns, []);
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
