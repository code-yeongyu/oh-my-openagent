import assert from "node:assert/strict";
import test from "node:test";

import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";

test("#given config default gpt-5.5 #when SessionStart model is gpt-5.6-terra #then prefers session model and clears disable", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		sessionModel: "gpt-5.6-terra",
		multiAgentVersion: "v2",
	});

	assert.doesNotMatch(result, /^\s*enabled\s*=\s*false/m);
	assert.match(result, /max_concurrent_threads_per_session = 1000/);
});

test("#given SessionStart without model #when requireSessionModel is set #then skips legacy force-disable", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features]",
		"plugins = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.equal(result, config);
	assert.doesNotMatch(result, /\[features\.multi_agent_v2\]/);
});

test("#given legacy [features] shorthand #when requireSessionModel skips force-disable #then still removes the shorthand", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features]",
		"plugins = true",
		"multi_agent_v2 = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		requireSessionModel: true,
		sessionModel: null,
	});

	assert.doesNotMatch(result, /^\s*multi_agent_v2\s*=/m);
	assert.match(result, /plugins = true/);
	assert.doesNotMatch(result, /\[features\.multi_agent_v2\]/);
});

test("#given legacy [features] shorthand #when session model has no catalog entry #then still removes the shorthand", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features]",
		"multi_agent_v2 = false",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		sessionModel: "gpt-5.7-nova",
	});

	assert.doesNotMatch(result, /^\s*multi_agent_v2\s*=/m);
	assert.doesNotMatch(result, /\[features\.multi_agent_v2\]/);
});

test("#given no session model and no root model #when forcing disable #then leaves the enable state untouched", () => {
	const config = [
		"[features]",
		"plugins = true",
		"",
		"[features.multi_agent_v2]",
		"enabled = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		sessionModel: null,
	});

	assert.match(result, /enabled = true/);
	assert.doesNotMatch(result, /enabled = false/);
	assert.doesNotMatch(result, /openai\/codex#26753/);
});

test("#given no session model and no root model #when config has no multi_agent_v2 section #then appends only the inert compatibility pair", () => {
	const config = ["[features]", "plugins = true", ""].join("\n");

	const result = forceDisableMultiAgentV2(config, {
		multiAgentVersion: null,
		sessionModel: null,
	});

	assert.match(result, /\[features\.multi_agent_v2\]/);
	assert.match(result, /tool_namespace = "agents"/);
	assert.match(result, /hide_spawn_agent_metadata = false/);
	assert.doesNotMatch(result, /^enabled\s*=/m);
	assert.doesNotMatch(result, /^max_concurrent_threads_per_session\s*=/m);
	assert.doesNotMatch(result, /^max_threads\s*=/m);
});
