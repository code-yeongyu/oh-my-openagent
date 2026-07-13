import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { multiAgentV2Section, sectionText } from "./install-config-fixture.mjs";
import { updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given existing MultiAgentV2 table #when script installer updates config #then preserves unrelated tuning and the custom cap", async () => {
	// given
	// A pinned v1 model keeps this on the preserve-user-disable path; the
	// stamped v2-preferred default would clear the disable instead.
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-existing-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"usage_hint_enabled = false",
			"max_concurrent_threads_per_session = 4",
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\.multi_agent_v2\]/);
	assert.doesNotMatch(
		sectionText(config, "[features.multi_agent_v2]"),
		/enabled = true/,
	);
	assert.match(config, /usage_hint_enabled = false/);
	assert.match(config, /max_concurrent_threads_per_session = 4/);
	assert.doesNotMatch(config, /max_concurrent_threads_per_session = 1000/);
});

test("#given empty Codex config #when script installer updates config #then leaves the generated V2 cap absent", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-roles-"),
	);
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	// An inherited/UI-selected model may resolve to V2, so agents.max_threads is
	// not introduced (Codex rejects it under MultiAgentV2).
	const config = await readFile(configPath, "utf8");
	const v2Section = multiAgentV2Section(config);
	assert.doesNotMatch(config, /^\s*max_threads\s*=/m);
	assert.match(v2Section, /^tool_namespace = "agents"$/m);
	assert.match(v2Section, /^hide_spawn_agent_metadata = false$/m);
	assert.match(v2Section, /^multi_agent_mode_hint_text = ".+"$/m);
	assert.doesNotMatch(v2Section, /max_concurrent_threads_per_session/);
});

test("#given user config hiding spawn_agent metadata #when script installer updates config #then normalizes the generated safe pair", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-hide-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[features.multi_agent_v2]",
			"usage_hint_enabled = false",
			"hide_spawn_agent_metadata = true",
			'multi_agent_mode_hint_text = "custom hint"',
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	const v2Section = multiAgentV2Section(config);
	assert.match(v2Section, /^tool_namespace = "agents"$/m);
	assert.match(v2Section, /^hide_spawn_agent_metadata = false$/m);
	assert.doesNotMatch(v2Section, /^hide_spawn_agent_metadata = true$/m);
	assert.match(v2Section, /^usage_hint_enabled = false$/m);
	assert.match(v2Section, /^multi_agent_mode_hint_text = "custom hint"$/m);
});

test("#given legacy boolean MultiAgentV2 flag and table #when script installer updates config #then normalizes to table config", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-legacy-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[features]",
			"multi_agent_v2 = true",
			"plugins = false",
			"",
			"[features.multi_agent_v2]",
			"usage_hint_enabled = false",
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^multi_agent_v2\s*=/m);
	assert.match(config, /\[features\.multi_agent_v2\]/);
	const v2Section = multiAgentV2Section(config);
	assert.doesNotMatch(v2Section, /^enabled\s*=/m);
	assert.match(v2Section, /usage_hint_enabled = false/);
	assert.doesNotMatch(v2Section, /max_concurrent_threads_per_session/);
});

test("#given legacy boolean MultiAgentV2 flag false #when script installer updates config #then normalizes to a disabled table config", async () => {
	// given
	// A pinned v1 model keeps the legacy boolean materializing as a disabled
	// table; the stamped v2-preferred default would drop the disable instead.
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-legacy-false-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"",
			"[features]",
			"multi_agent_v2 = false",
			"plugins = false",
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^multi_agent_v2\s*=/m);
	assert.match(config, /\[features\.multi_agent_v2\]/);
	const disabledV2Section = multiAgentV2Section(config);
	assert.match(disabledV2Section, /^enabled = false$/m);
	assert.doesNotMatch(disabledV2Section, /max_concurrent_threads_per_session/);
});

test("#given legacy agents max_threads #when script installer updates config #then preserves the user thread cap", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-legacy-threads-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"",
			"[agents]",
			"max_threads = 16",
			"max_depth = 4",
			"job_max_runtime_seconds = 3600",
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\.multi_agent_v2\]/);
	const v2Section = multiAgentV2Section(config);
	assert.doesNotMatch(v2Section, /^enabled\s*=/m);
	assert.doesNotMatch(v2Section, /max_concurrent_threads_per_session/);
	assert.match(config, /\[agents\]/);
	assert.match(config, /max_threads = 16/);
	assert.match(config, /max_depth = 4/);
	assert.match(config, /job_max_runtime_seconds = 3600/);
});

test("#given managed agent role sections #when script installer updates config #then preserves role config and user max_threads", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-role-section-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"",
			"[agents]",
			"max_threads = 16",
			"",
			"[agents.explorer]",
			'description = "read-only explorer"',
			'config_file = "./agents/explorer.toml"',
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
		agentConfigs: [{ name: "explorer", configFile: "./agents/explorer.toml" }],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /max_threads = 16/);
	assert.match(config, /\[agents\.explorer\]/);
	assert.match(config, /description = "read-only explorer"/);
	assert.match(config, /config_file = "\.\/agents\/explorer\.toml"/);
});
