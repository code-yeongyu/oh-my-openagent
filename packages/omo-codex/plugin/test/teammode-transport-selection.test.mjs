import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

test("#given namespaced V2 tools are available #when the leader reads teammode #then transport selection and user announcement precede init", () => {
	const skill = readFileSync(
		join(root, "components", "teammode", "skills", "teammode", "SKILL.md"),
		"utf8",
	);
	const inspectIndex = skill.indexOf("Inspect your active tool list");
	const initIndex = skill.indexOf('team.mjs" init');

	assert.notEqual(inspectIndex, -1, "skill must inspect the active tool list");
	assert.notEqual(initIndex, -1, "skill must still document init");
	assert.ok(
		inspectIndex < initIndex,
		"transport inspection must happen before init",
	);
	assert.match(
		skill,
		/agents\.spawn_agent.*task_name[\s\S]*agents\.send_message[\s\S]*agents\.followup_task[\s\S]*agents\.wait_agent[\s\S]*agents\.list_agents[\s\S]*agents\.interrupt_agent/,
	);
	assert.match(
		skill,
		/agents\.spawn_agent[\s\S]{0,800}\btask_name\b[\s\S]{0,800}\bagent_type\b[\s\S]{0,800}\bfork_turns\b/,
	);
	assert.doesNotMatch(
		skill,
		/flat `spawn_agent`|Leave `agent_type` unset|inherit the session model/i,
	);
	assert.match(skill, /tell the user|announce.*transport/i);
	assert.match(skill, /MultiAgentV2/i);
	assert.match(skill, /Codex App.*fallback/i);
});

test("#given neither transport's tools are visible #when the leader reads teammode #then search hits are revalidated and fallback is capability-aware without team state", () => {
	const skill = readFileSync(
		join(root, "components", "teammode", "skills", "teammode", "SKILL.md"),
		"utf8",
	);
	const searchIndex = skill.indexOf("tool_search");
	const unavailableIndex = skill.indexOf("Teammode unavailable");

	assert.notEqual(
		searchIndex,
		-1,
		"skill must route hidden tools through the tool_search check",
	);
	assert.notEqual(
		unavailableIndex,
		-1,
		"skill must give the leader unavailable announcement templates",
	);
	assert.ok(
		searchIndex < unavailableIndex,
		"tool_search must precede the unavailable conclusion",
	);
	assert.match(skill, /revalidate.*COMPLETE.*compatible transport set/is);
	assert.match(
		skill,
		/another visible plain-subagent mechanism.*spawn.*communicate.*observe/is,
	);
	assert.match(skill, /Otherwise continue serially.*capability limitation/is);
	assert.match(skill, /Do NOT run `init`/);
	assert.doesNotMatch(
		skill,
		/splitting the work across plain fire-and-forget subagents/i,
	);
});

test("#given a MultiAgentV2 team #when the leader spawns members #then typed roles own defaults and explicit overrides stay separate", () => {
	const skill = readFileSync(
		join(root, "components", "teammode", "skills", "teammode", "SKILL.md"),
		"utf8",
	);
	const overrideMatch =
		/`agents\.spawn_agent\((\{[^`]+"service_tier"[^`]+\})\)`/.exec(skill);

	assert.doesNotMatch(
		skill,
		/Do not set `agent_type`, `model`, or `reasoning_effort`/,
	);
	assert.match(skill, /`agent_type`[\s\S]{0,200}installed role TOML/i);
	assert.doesNotMatch(skill, /inherit the session model/i);
	assert.ok(
		overrideMatch,
		"teammode must include a typed V2 override example with service_tier",
	);
	const override = JSON.parse(overrideMatch[1]);
	assert.equal(override.agent_type, "lazycodex-worker-high");
	assert.equal(override.model, "gpt-5.6-sol");
	assert.equal(override.reasoning_effort, "max");
	assert.equal(override.service_tier, "fast");
	assert.equal(override.fork_turns, "none");
});
