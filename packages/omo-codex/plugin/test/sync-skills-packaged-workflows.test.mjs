import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseSpawnContracts } from "./ulw-loop-workflow-contract-support.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given source and packaged ulw-plan workflows #when spawn examples are parsed #then generated artifacts stay equal and V2 remains typed", async () => {
	// given
	const packagedSkill = await readPackagedSkillFile("ulw-plan", "SKILL.md");
	const packagedWorkflow = await readPackagedSkillFile(
		"ulw-plan",
		"references",
		"full-workflow.md",
	);
	const sourceSkill = await readSourceUlwPlanFile("SKILL.md");
	const sourceWorkflow = await readSourceUlwPlanFile(
		"references",
		"full-workflow.md",
	);

	// when
	const contracts = parseSpawnContracts(
		`${packagedSkill.content}\n${packagedWorkflow.content}`,
	);
	const v2Contracts = contracts.filter(({ surface }) => surface === "v2");

	// then
	assert.equal(packagedSkill.content, sourceSkill.content);
	assert.equal(packagedWorkflow.content, sourceWorkflow.content);
	assert.ok(v2Contracts.length > 0);
	for (const { tool, args } of v2Contracts) {
		assert.equal(tool, "agents.spawn_agent");
		assert.equal(typeof args.agent_type, "string");
		assert.ok(args.agent_type.length > 0);
		assert.equal(args.fork_turns, "none");
	}
	const explicitOverride = v2Contracts.find(
		({ args }) =>
			Object.hasOwn(args, "model") &&
			Object.hasOwn(args, "reasoning_effort") &&
			Object.hasOwn(args, "service_tier"),
	);
	assert.ok(
		explicitOverride,
		"generated compatibility guidance must prove every typed V2 override field",
	);
	assert.equal(explicitOverride.args.agent_type, "lazycodex-worker-high");
	assert.equal(explicitOverride.args.model, "gpt-5.6-sol");
	assert.equal(explicitOverride.args.reasoning_effort, "max");
	assert.equal(explicitOverride.args.service_tier, "fast");
});

async function readPackagedSkillFile(...segments) {
	const path = join(root, "skills", ...segments);
	return { path, content: await readFile(path, "utf8") };
}

async function readSourceUlwPlanFile(...segments) {
	const path = join(
		root,
		"components",
		"ultrawork",
		"skills",
		"ulw-plan",
		...segments,
	);
	return { path, content: await readFile(path, "utf8") };
}
