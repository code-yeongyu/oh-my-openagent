import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	parseSpawnContracts,
	readUlwLoopWorkflowArtifacts,
	ulwLoopWorkflowPaths,
} from "./ulw-loop-workflow-contract-support.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given every shipped ulw-loop full workflow #when spawn examples are parsed #then V2 is typed and agent_type omission is V1-only", async () => {
	// given
	const artifacts = await readUlwLoopWorkflowArtifacts(pluginRoot);

	// when
	const inventories = artifacts.map((artifact) => ({
		...artifact,
		contracts: parseSpawnContracts(artifact.content),
	}));

	// then
	assert.deepEqual(
		inventories.map(({ relativePath }) => relativePath),
		ulwLoopWorkflowPaths,
	);
	assert.equal(
		inventories[0].content,
		inventories[1].content,
		"source and packaged workflows must stay identical",
	);

	for (const { relativePath, contracts } of inventories) {
		const v2Contracts = contracts.filter(({ surface }) => surface === "v2");
		assert.ok(
			v2Contracts.length > 0,
			`${relativePath} must ship a V2 spawn example`,
		);
		for (const { tool, args } of v2Contracts) {
			assert.equal(tool, "agents.spawn_agent");
			assert.equal(typeof args.agent_type, "string");
			assert.ok(args.agent_type.length > 0);
			assert.equal(args.fork_turns, "none");
			assert.ok(!Object.hasOwn(args, "fork_context"));
		}

		const agentTypeOmissions = contracts.filter(
			({ args }) => !Object.hasOwn(args, "agent_type"),
		);
		assert.ok(
			agentTypeOmissions.length > 0,
			`${relativePath} must show the V1 compatibility omission case`,
		);
		for (const { surface, tool, args } of agentTypeOmissions) {
			assert.equal(surface, "v1");
			assert.equal(tool, "multi_agent_v1.spawn_agent");
			assert.equal(args.fork_context, false);
			assert.ok(!Object.hasOwn(args, "fork_turns"));
		}
	}
});
