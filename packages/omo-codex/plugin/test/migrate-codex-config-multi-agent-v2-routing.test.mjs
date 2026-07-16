import assert from "node:assert/strict";
import test from "node:test";

import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";
import { parseToml as parseTomlWithPython } from "./parse-toml.mjs";

test("#given gpt-5.6-terra with managed disable #when model catalog prefers v2 #then clears enabled=false and managed comments", () => {
	const config = [
		'model = "gpt-5.6-terra"',
		"",
		"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
		"# because enabling it fails every turn with HTTP 400 (openai/codex#26753).",
		"# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1 (or OMO_CODEX_CONFIG_MIGRATION_DISABLED=1).",
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });

	assert.doesNotMatch(result, /^\s*enabled\s*=\s*false/m);
	assert.doesNotMatch(result, /openai\/codex#26753/);
	assert.doesNotMatch(result, /Managed by LazyCodex: multi_agent_v2/);
	assert.match(result, /\[features\.multi_agent_v2\]/);
	assert.match(result, /max_concurrent_threads_per_session = 1000/);
});

test("#given gpt-5.6 v2 model with hide_spawn_agent_metadata=false #when clearing #then keeps safe metadata visibility and installs namespace hint", () => {
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		"hide_spawn_agent_metadata = false",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });
	const parsed = parseTomlWithPython(result);
	const v2 = parsed.features.multi_agent_v2;

	assert.doesNotMatch(result, /^\s*enabled\s*=\s*false/m);
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
	assert.ok(v2.multi_agent_mode_hint_text.trim().length > 0);
	assert.match(result, /max_concurrent_threads_per_session = 1000/);
});

test("#given gpt-5.6 v2 model with hide_spawn_agent_metadata=true #when clearing #then normalizes metadata visibility to the safe value", () => {
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		"[features.multi_agent_v2]",
		"enabled = false",
		"hide_spawn_agent_metadata = true",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });
	const parsed = parseTomlWithPython(result);
	const v2 = parsed.features.multi_agent_v2;

	assert.doesNotMatch(result, /^\s*enabled\s*=\s*false/m);
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
	assert.equal(typeof v2.multi_agent_mode_hint_text, "string");
	assert.ok(v2.multi_agent_mode_hint_text.trim().length > 0);
});

test("#given v1 model with hide_spawn_agent_metadata=false #when forcing disable #then keeps the metadata override", () => {
	const config = [
		'model = "gpt-5.5"',
		"",
		"[features.multi_agent_v2]",
		"hide_spawn_agent_metadata = false",
		"max_concurrent_threads_per_session = 1000",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v1" });

	assert.match(result, /hide_spawn_agent_metadata = false/);
	assert.match(result, /enabled = false/);
});

test("#given gpt-5.6-sol with no multi_agent_v2 section #when model catalog prefers v2 #then appends safe routing without a disable", () => {
	const config = [
		'model = "gpt-5.6-sol"',
		"",
		"[features]",
		"plugins = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v2" });
	const parsed = parseTomlWithPython(result);
	const v2 = parsed.features?.multi_agent_v2;

	assert.doesNotMatch(result, /enabled = false/);
	assert.ok(v2, "expected runtime guard to create [features.multi_agent_v2]");
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
	assert.equal(typeof v2.multi_agent_mode_hint_text, "string");
	assert.ok(v2.multi_agent_mode_hint_text.trim().length > 0);
	assert.match(result, /plugins = true/);
});
