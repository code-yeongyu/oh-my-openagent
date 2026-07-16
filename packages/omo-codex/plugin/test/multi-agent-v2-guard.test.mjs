import assert from "node:assert/strict";
import test from "node:test";

import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";
import { parseToml } from "./parse-toml.mjs";

test("#given stale V2 routing #when guard runs #then it converges to the agents namespace pair idempotently", () => {
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		'tool_namespace = "collaboration"',
		"hide_spawn_agent_metadata = true",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });
	const v2 = parseToml(result).features.multi_agent_v2;

	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
	assert.ok(v2.multi_agent_mode_hint_text.trim().length > 0);
	assert.equal("enabled" in v2, false);
	assert.equal(
		forceDisableMultiAgentV2(result, { multiAgentVersion: "v2" }),
		result,
	);
});

test("#given either half of the V2 routing pair #when guard runs #then it completes the coherent pair", () => {
	const configs = [
		[
			"hide_spawn_agent_metadata = false",
			"max_concurrent_threads_per_session = 6",
		],
		['tool_namespace = "agents"', "max_concurrent_threads_per_session = 6"],
	];

	for (const settings of configs) {
		const config = [
			'model = "gpt-5.6-sol"',
			"",
			"[features.multi_agent_v2]",
			...settings,
			"",
		].join("\n");
		const v2 = parseToml(
			forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" }),
		).features.multi_agent_v2;

		assert.equal(v2.tool_namespace, "agents");
		assert.equal(v2.hide_spawn_agent_metadata, false);
		assert.ok(v2.multi_agent_mode_hint_text.trim().length > 0);
		assert.equal(v2.max_concurrent_threads_per_session, 6);
	}
});

test("#given a custom V2 hint #when guard runs #then it preserves the assignment bytes", () => {
	const customHint =
		'multi_agent_mode_hint_text = "CUSTOM HINT: keep exactly these bytes; do not normalize."';
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		"[features.multi_agent_v2]",
		customHint,
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });
	const v2 = parseToml(result).features.multi_agent_v2;

	assert.equal(
		sectionText(result, "[features.multi_agent_v2]").split(customHint).length -
			1,
		1,
	);
	assert.equal(
		v2.multi_agent_mode_hint_text,
		"CUSTOM HINT: keep exactly these bytes; do not normalize.",
	);
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
});

test("#given empty literal and multiline V2 hints #when guard runs #then each existing assignment survives", () => {
	const hints = [
		'multi_agent_mode_hint_text = ""',
		"multi_agent_mode_hint_text = 'literal custom hint # keep bytes'",
		'multi_agent_mode_hint_text = """line one\nline two"""',
	];

	for (const hint of hints) {
		const config = [
			'model = "gpt-5.6-sol"',
			"",
			"[features.multi_agent_v2]",
			hint,
			"",
		].join("\n");
		const result = forceDisableMultiAgentV2(config, {
			multiAgentVersion: "v2",
		});

		parseToml(result);
		assert.equal(
			sectionText(result, "[features.multi_agent_v2]").split(
				"multi_agent_mode_hint_text",
			).length - 1,
			1,
		);
		assert.ok(result.includes(hint));
	}
});

test("#given a multiline hint containing a header-looking line #when guard runs #then routing keys stay unique and TOML remains valid", () => {
	const customHint = [
		"multi_agent_mode_hint_text = '''Direct work policy:",
		"[Direct work]",
		"Keep bounded tasks local.'''",
	].join("\n");
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		"[features.multi_agent_v2]",
		customHint,
		'tool_namespace = "custom-user-namespace"',
		"hide_spawn_agent_metadata = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });
	const v2 = parseToml(result).features.multi_agent_v2;

	assert.equal(
		v2.multi_agent_mode_hint_text,
		"Direct work policy:\n[Direct work]\nKeep bounded tasks local.",
	);
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
	assert.equal(result.match(/^tool_namespace\s*=/gm)?.length, 1);
	assert.equal(result.match(/^hide_spawn_agent_metadata\s*=/gm)?.length, 1);
});

test("#given a quoted dotted V2 header and assignment-looking hint #when guard runs #then it updates the active settings only", () => {
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		'[features."multi_agent_v2"]',
		"multi_agent_mode_hint_text = '''",
		'tool_namespace = "user policy text"',
		"'''",
		'tool_namespace = "custom-user-namespace"',
		"hide_spawn_agent_metadata = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });
	const v2 = parseToml(result).features.multi_agent_v2;

	assert.equal(
		v2.multi_agent_mode_hint_text,
		'tool_namespace = "user policy text"\n',
	);
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(
		result.match(/\[features\.(?:"multi_agent_v2"|multi_agent_v2)\]/g)?.length,
		1,
	);
});

test("#given unterminated TOML #when guard runs repeatedly #then it fails closed without appending tables", () => {
	const config =
		'model = "gpt-5.6-sol"\nnotes = """\n[features.multi_agent_v2]\n';
	const first = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });

	assert.equal(first, config);
	assert.equal(
		forceDisableMultiAgentV2(first, { multiAgentVersion: "v2" }),
		config,
	);
});

function sectionText(config, header) {
	const start = config.indexOf(header);
	if (start === -1) return "";
	const rest = config.slice(start);
	const next = rest.slice(header.length).search(/\n\[/);
	return next === -1 ? rest : rest.slice(0, header.length + next);
}
