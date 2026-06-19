import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

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

test("#given empty Codex config #when script installer updates config #then leaves Context7 to the plugin MCP manifest", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-context7-"));
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
	assert.doesNotMatch(config, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(config, /@upstash\/context7-mcp/);
	assert.doesNotMatch(config, /YOUR_API_KEY/);
});

test("#given sisyphuslabs omo install #when script installer updates config #then enables Context7 plugin mcp policy", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-context7-plugin-policy-"));
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]/);
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/);
	assert.doesNotMatch(config, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(config, /@upstash\/context7-mcp/);
	assert.doesNotMatch(config, /YOUR_API_KEY/);
});

test("#given existing Context7 MCP config #when script installer updates config #then leaves user setup untouched", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-context7-existing-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[mcp_servers.context7]",
			'command = "node"',
			'args = ["/opt/context7/server.js"]',
			'startup_timeout_sec = 40',
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
	assert.match(config, /\[mcp_servers\.context7\]/);
	assert.match(config, /command = "node"/);
	assert.match(config, /args = \["\/opt\/context7\/server\.js"\]/);
	assert.match(config, /startup_timeout_sec = 40/);
	assert.doesNotMatch(config, /YOUR_API_KEY/);
});

test("#given Codex config is a symlink #when script installer updates config #then writes through the target", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-symlink-"));
	const targetPath = join(root, "actual-config.toml");
	const configPath = join(root, "config.toml");
	await writeFile(targetPath, "[features]\nplugins = false\n");
	await symlink(targetPath, configPath);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
		pluginNames: ["omo"],
	});

	// then
	const configStat = await lstat(configPath);
	const targetConfig = await readFile(targetPath, "utf8");
	assert.equal(configStat.isSymbolicLink(), true);
	assert.match(targetConfig, /plugins = true/);
	assert.match(targetConfig, /\[plugins\."omo@sisyphuslabs"\]/);
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
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

test("#given empty Codex config #when script installer updates config #then sets the generated MultiAgentV2 thread limit", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-roles-"));
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
	const v2Section = config.slice(config.indexOf("[features.multi_agent_v2]"));
	assert.match(v2Section, /max_concurrent_threads_per_session = 10000/);
	assert.doesNotMatch(v2Section, /hide_spawn_agent_metadata/);
});

test("#given user config hiding spawn_agent metadata #when script installer updates config #then preserves the generated source behavior", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-hide-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[features.multi_agent_v2]",
			"usage_hint_enabled = false",
			"hide_spawn_agent_metadata = true",
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
	assert.match(config, /hide_spawn_agent_metadata = true/);
	assert.doesNotMatch(config, /hide_spawn_agent_metadata = false/);
	assert.match(config, /usage_hint_enabled = false/);
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

test("#given legacy agents max_threads #when script installer updates config #then removes the conflicting legacy thread cap", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-legacy-threads-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\.multi_agent_v2\]/);
	assert.match(config, /enabled = true/);
	assert.match(config, /max_concurrent_threads_per_session = 10000/);
	assert.match(config, /\[agents\]/);
	assert.doesNotMatch(config, /^max_threads\s*=/m);
	assert.match(config, /max_depth = 4/);
	assert.match(config, /job_max_runtime_seconds = 3600/);
});

test("#given managed agent role sections #when script installer updates config #then preserves role config while removing only root agents max_threads", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-role-section-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		agentConfigs: [{ name: "explorer", configFile: "./agents/explorer.toml" }],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^max_threads\s*=/m);
	assert.match(config, /\[agents\.explorer\]/);
	assert.match(config, /description = "read-only explorer"/);
	assert.match(config, /config_file = "\.\/agents\/explorer\.toml"/);
});

test("#given existing trust and lsp blocks #when updating config #then existing blocks are preserved", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-config-baseline-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'[plugins."omo@sisyphuslabs"]',
			"enabled = true",
			"",
			'[plugins."omo@sisyphuslabs".mcp_servers.lsp]',
			"enabled = true",
			"",
			'[hooks.state."omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0"]',
			'trusted_hash = "sha256:keep"',
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
		pluginNames: ["omo"],
		trustedHookStates: [{ key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:keep" }],
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\]/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.lsp\]/);
	assert.match(content, /\[hooks\.state\."omo@sisyphuslabs:hooks\/hooks\.json:post_tool_use:0:0"\]/);
	assert.match(content, /trusted_hash = "sha256:keep"/);
});
