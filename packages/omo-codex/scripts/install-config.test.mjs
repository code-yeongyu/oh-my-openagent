import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install/config.mjs";

test("#given empty Codex config #when script installer updates config #then enables MultiAgentV2 with ten thousand session threads", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-"));
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\.multi_agent_v2\]/);
	assert.match(config, /enabled = true/);
	assert.match(config, /max_concurrent_threads_per_session = 10000/);
});

test("#given sisyphuslabs config without explicit source #when script installer updates config #then uses local marketplace", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-sisyphuslabs-"));
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[marketplaces\.sisyphuslabs\]/);
	assert.match(config, /source_type = "local"/);
	assert.match(config, /source = "\/repo\/packages\/omo-codex"/);
	assert.doesNotMatch(config, /lazycodex\.git/);
	assert.doesNotMatch(config, /ref = "main"/);
});

test("#given existing MultiAgentV2 table #when script installer updates config #then preserves unrelated tuning while setting ten thousand session threads", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-existing-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\.multi_agent_v2\]/);
	assert.match(config, /enabled = true/);
	assert.match(config, /usage_hint_enabled = false/);
	assert.match(config, /max_concurrent_threads_per_session = 10000/);
	assert.doesNotMatch(config, /max_concurrent_threads_per_session = 4/);
});

test("#given legacy boolean MultiAgentV2 flag and table #when script installer updates config #then normalizes to table config", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-legacy-"));
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^multi_agent_v2\s*=/m);
	assert.match(config, /\[features\.multi_agent_v2\]/);
	assert.match(config, /enabled = true/);
	assert.match(config, /usage_hint_enabled = false/);
	assert.match(config, /max_concurrent_threads_per_session = 10000/);
});
