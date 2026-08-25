import assert from "node:assert/strict";
import { relative, sep } from "node:path";
import test from "node:test";

import {
	findShippedSpawnIsolationViolations,
	findShippedUnsupportedSpawnParameterViolations,
	findSpawnAgentCalls,
	findSpawnAgentCallsWithoutIsolation,
	findSpawnAgentCallsWithUnsupportedParameters,
	listShippedSpawnPromptFiles,
	root,
} from "./aggregate-plugin-fixture.mjs";

test("#given suffixed spawn-like identifiers #when parsed #then they are not spawn calls", () => {
	const content = 'auto_respawn_agent({agent_type: "explorer"})\nrespawn_agent(message="x")';

	assert.equal(findSpawnAgentCalls(content).length, 0);
	assert.deepEqual(findSpawnAgentCallsWithUnsupportedParameters(content), []);
});

test("#given nested spawn calls and isolation-like message text #when parsed #then only structural isolation arguments count", () => {
	const content = [
		'spawn_agent({message: "fork_context:false and a closing ) are prose", task: nested(call())})',
		'spawn_agent(task_name="v1", message="nested (message)", fork_context=false)',
		'spawn_agent({"task_name":"v2","fork_turns":"none"})',
	].join("\n");

	assert.equal(findSpawnAgentCalls(content).length, 3);
	assert.deepEqual(
		findSpawnAgentCallsWithoutIsolation(content).map(({ call }) => call),
		['spawn_agent({message: "fork_context:false and a closing ) are prose", task: nested(call())})'],
	);
});

test("#given spawn parameter mutations and role-like prose #when parsed #then only unsupported machine arguments are rejected", () => {
	const content = [
		'multi_agent_v1.spawn_agent({"message":"model and reasoning_effort are prose","agent_type":"explorer","fork_context":false})',
		'multi_agent_v1.spawn_agent(agent_type="explorer", message="invalid keyword role", fork_context=false)',
		'spawn_agent({"message":"invalid flat role","agent_type":"explorer","fork_turns":"none"})',
		'spawn_agent(agent_type="explorer", message="invalid direct role", fork_turns="none")',
		'spawn_agent({"message":"model and agent_type are prose","metadata":{"model":"nested","agent_type":"nested"},"fork_turns":"none"})',
		'spawn_agent({"message":"placeholder prose","agent_type":...,"fork_turns":"none"})',
		'multi_agent_v1.spawn_agent({"message":"invalid model","model":"gpt-5","fork_context":false})',
		'spawn_agent(message="invalid effort", reasoning_effort="high", fork_context=false)',
	].join("\n");

	assert.deepEqual(
		findSpawnAgentCallsWithUnsupportedParameters(content).map(({ parameters }) => parameters),
		[["agent_type"], ["agent_type"], ["agent_type"], ["model"], ["reasoning_effort"]],
	);
});

test("#given shipped generated skills and Hephaestus rules #when spawn calls are scanned #then every call disables parent context", async () => {
	const promptFiles = await listShippedSpawnPromptFiles();
	const relativePaths = promptFiles.map((path) => relative(root, path).split(sep).join("/"));

	assert(relativePaths.some((path) => path.startsWith("skills/") && path.endsWith("/SKILL.md")));
	assert(relativePaths.some((path) => path.startsWith("components/") && path.includes("/skills/") && path.endsWith("/SKILL.md")));
	assert(relativePaths.some((path) => path.startsWith("components/rules/bundled-rules/hephaestus/") && path.endsWith(".md")));

	const violations = (await findShippedSpawnIsolationViolations()).map(({ path, line, call }) => ({
		path: relative(root, path).split(sep).join("/"),
		line,
		call,
	}));
	assert.deepEqual(violations, []);
});

test("#given shipped generated skills and Hephaestus rules #when spawn parameters are scanned #then unsupported role and model arguments are absent", async () => {
	const violations = (await findShippedUnsupportedSpawnParameterViolations()).map(({ path, line, call, parameters }) => ({
		path: relative(root, path).split(sep).join("/"),
		line,
		call,
		parameters,
	}));
	assert.deepEqual(violations, []);
});
