import assert from "node:assert/strict";

const backtickSnippets = (content) =>
	[...content.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
const instructionUnits = (content) => content.split(/\n\s*\n/);

function spawnArguments(snippet) {
	const match = /^agents\.spawn_agent\((\{.*\})\)$/.exec(snippet);
	assert.ok(match, `invalid agents.spawn_agent example: ${snippet}`);
	const parsed = JSON.parse(match[1]);
	assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
	return parsed;
}

export function assertCompatibilityContract(content, label) {
	const units = instructionUnits(content);
	const guidance = units.find((unit) =>
		backtickSnippets(unit).some((snippet) =>
			snippet.startsWith("agents.spawn_agent("),
		),
	);
	assert.ok(guidance, `${label} must include MultiAgentV2 spawn guidance`);
	const spawns = backtickSnippets(guidance)
		.filter((snippet) => snippet.startsWith("agents.spawn_agent("))
		.map(spawnArguments);
	const primary = spawns.find((args) => !Object.hasOwn(args, "model"));
	const override = spawns.find((args) => Object.hasOwn(args, "model"));
	assert.ok(primary, `${label} must include a role-routed spawn`);
	assert.ok(override, `${label} must include an explicit model override`);
	assert.deepEqual(Object.keys(primary).sort(), [
		"agent_type",
		"fork_turns",
		"message",
		"task_name",
	]);
	assert.equal(primary.agent_type, "lazycodex-worker-medium");
	assert.equal(primary.fork_turns, "none");
	assert.deepEqual(Object.keys(override).sort(), [
		"agent_type",
		"fork_turns",
		"message",
		"model",
		"reasoning_effort",
		"service_tier",
		"task_name",
	]);
	assert.equal(override.agent_type, "lazycodex-worker-high");
	assert.equal(override.model, "gpt-5.6-sol");
	assert.equal(override.reasoning_effort, "max");
	assert.equal(override.service_tier, "fast");
	assert.equal(override.fork_turns, "none");
	const snippets = new Set(backtickSnippets(guidance));
	for (const tool of [
		"agents.send_message",
		"agents.followup_task",
		"agents.interrupt_agent",
		"agents.wait_agent",
	]) {
		assert.ok(snippets.has(tool), `${label} missing ${tool} lifecycle mapping`);
	}
	const loadSkillsUnit = units.find((unit) =>
		backtickSnippets(unit).includes("load_skills=[...]"),
	);
	assert.ok(loadSkillsUnit, `${label} must include load_skills translation`);
	assert.ok(
		backtickSnippets(loadSkillsUnit).includes("message"),
		`${label} must route load_skills through the child message`,
	);
}

export function assertNoV1OnlyUnitsAfterV2Mapping(content, label) {
	const units = instructionUnits(content);
	const v2MappingIndex = units.findIndex((unit) =>
		backtickSnippets(unit).some((snippet) =>
			snippet.startsWith("agents.spawn_agent("),
		),
	);
	assert.notEqual(
		v2MappingIndex,
		-1,
		`${label} must include a MultiAgentV2 spawn mapping`,
	);

	const contractPairs = [
		["multi_agent_v1.spawn_agent", "agents.spawn_agent"],
		["multi_agent_v1.wait_agent", "agents.wait_agent"],
		["fork_context", "fork_turns"],
	];
	for (const unit of units.slice(v2MappingIndex)) {
		const snippets = backtickSnippets(unit).join("\n");
		for (const [v1Token, v2Token] of contractPairs) {
			assert.ok(
				!snippets.includes(v1Token) || snippets.includes(v2Token),
				`${label} hard-codes ${v1Token} after the V2 mapping`,
			);
		}
	}
}
