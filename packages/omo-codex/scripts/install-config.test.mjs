// allow: SIZE_OK - Node installer config tests mirror the source installer matrix with one filesystem fixture; this release adds config cases and future edits should split by installer concern.

import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given empty Codex config #when script installer updates config #then sets subagent thread limits without forcing MultiAgentV2", async () => {
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
	// The stamped default model is v2-preferred, so the installer must not
	// introduce agents.max_threads (Codex rejects it under MultiAgentV2).
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(config, /^\s*max_threads\s*=/m);
	assert.match(config, /\[features\.multi_agent_v2\]/);
	const v2Section = multiAgentV2Section(config);
	assert.doesNotMatch(v2Section, /^enabled\s*=/m);
	assert.match(v2Section, /max_concurrent_threads_per_session = 16/);
});

test("#given queue multi-agent mode #when script installer updates config #then removes unsupported root key", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-mode-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'multi_agent_mode = "queue"',
			"",
			"[features]",
			"multi_agent = true",
			"",
		].join("\n"),
	);

	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(config, /multi_agent_mode = "queue"/);
});

test("#given indented steering mode and inline-comment features table #when script installer updates config #then removes root key and keeps one features table", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-toml-root-regression-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'  multi_agent_mode = "steering"',
			"",
			"[features] # keep comment",
			"plugins = false",
			"",
		].join("\n"),
	);

	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	const config = await readFile(configPath, "utf8");
	assert.equal(config.match(/^\s*multi_agent_mode\s*=/gm)?.length ?? 0, 0);
	assert.equal(config.match(/^\s*\[features\](?:\s*#.*)?$/gm)?.length, 1);
	assert.match(config, /^\[features\] # keep comment$/m);
	assert.doesNotMatch(config, /multi_agent_mode = "queue"/);
	assert.doesNotMatch(config, /multi_agent_mode = "steering"/);
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
			"[mcp_servers.context7] # stale npx package from old docs",
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

test("#given real Context7 API key and placeholder comment #when script installer updates config #then preserves user setup", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-context7-real-key-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[mcp_servers.context7]",
			'command = "npx"',
			'args = ["-y", "@upstash/context7-mcp", "--api-key", "ctx7sk_live_example"] # replace YOUR_API_KEY in docs only',
			"startup_timeout_sec = 20",
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
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[mcp_servers\.context7\]/);
	assert.match(config, /ctx7sk_live_example/);
	assert.match(config, /replace YOUR_API_KEY in docs only/);
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]/);
});

test("#given stale Context7 placeholder MCP config #when script installer updates config #then removes it for plugin MCP", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-context7-placeholder-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[mcp_servers.context7]",
			'command = "npx"',
			'args = ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]',
			"startup_timeout_sec = 20",
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
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]/);
	assert.doesNotMatch(config, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(config, /@upstash\/context7-mcp/);
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

test("#given existing MultiAgentV2 table #when script installer updates config #then preserves unrelated tuning while setting subagent thread limits", async () => {
	// given
	// A pinned v1 model keeps this on the preserve-user-disable path; the
	// stamped v2-preferred default would clear the disable instead.
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-existing-"));
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\.multi_agent_v2\]/);
	assert.doesNotMatch(sectionText(config, "[features.multi_agent_v2]"), /enabled = true/);
	assert.match(config, /usage_hint_enabled = false/);
	assert.match(config, /max_concurrent_threads_per_session = 4/);
	assert.doesNotMatch(config, /max_concurrent_threads_per_session = 1000/);
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
	// The stamped default model is v2-preferred, so agents.max_threads is not
	// introduced (Codex rejects it under MultiAgentV2).
	const config = await readFile(configPath, "utf8");
	const v2Section = config.slice(config.indexOf("[features.multi_agent_v2]"));
	assert.doesNotMatch(config, /^\s*max_threads\s*=/m);
	assert.match(v2Section, /max_concurrent_threads_per_session = 16/);
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
	const v2Section = multiAgentV2Section(config);
	assert.doesNotMatch(v2Section, /^enabled\s*=/m);
	assert.match(v2Section, /usage_hint_enabled = false/);
	assert.match(v2Section, /max_concurrent_threads_per_session = 16/);
});

test("#given legacy boolean MultiAgentV2 flag false #when script installer updates config #then normalizes to a disabled table config", async () => {
	// given
	// A pinned v1 model keeps the legacy boolean materializing as a disabled
	// table; the stamped v2-preferred default would drop the disable instead.
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-legacy-false-"));
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^multi_agent_v2\s*=/m);
	assert.match(config, /\[features\.multi_agent_v2\]/);
	const disabledV2Section = multiAgentV2Section(config);
	assert.match(disabledV2Section, /^enabled = false$/m);
	assert.match(disabledV2Section, /^max_concurrent_threads_per_session = 16$/m);
});

test("#given legacy agents max_threads #when script installer updates config #then raises the root subagent thread cap", async () => {
	// given
	// A pinned v1 model keeps the legacy low-cap raise path exercised; the
	// stamped v2-preferred default would remove agents.max_threads instead.
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-legacy-threads-"));
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\.multi_agent_v2\]/);
	const v2Section = multiAgentV2Section(config);
	assert.doesNotMatch(v2Section, /^enabled\s*=/m);
	assert.match(v2Section, /max_concurrent_threads_per_session = 16/);
	assert.match(config, /\[agents\]/);
	assert.match(config, /max_threads = 1000/);
	assert.doesNotMatch(config, /max_threads = 16/);
	assert.match(config, /max_depth = 4/);
	assert.match(config, /job_max_runtime_seconds = 3600/);
});

test("#given managed agent role sections #when script installer updates config #then preserves role config while raising only root agents max_threads", async () => {
	// given
	// A pinned v1 model keeps the legacy low-cap raise path exercised; the
	// stamped v2-preferred default would remove agents.max_threads instead.
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-multi-agent-role-section-"));
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		agentConfigs: [{ name: "explorer", configFile: "./agents/explorer.toml" }],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /max_threads = 1000/);
	assert.doesNotMatch(config, /max_threads = 16/);
	assert.match(config, /\[agents\.explorer\]/);
	assert.match(config, /description = "read-only explorer"/);
	assert.match(config, /config_file = "\.\/agents\/explorer\.toml"/);
});

function sectionText(config, header) {
	const start = config.indexOf(header);
	if (start === -1) return "";
	const afterStart = config.slice(start + header.length);
	const nextSectionOffset = afterStart.search(/\n\[/);
	return nextSectionOffset === -1 ? config.slice(start) : config.slice(start, start + header.length + nextSectionOffset);
}

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

function multiAgentV2Section(config) {
	const header = "[features.multi_agent_v2]";
	const start = config.indexOf(header);
	assert.notEqual(start, -1);
	const rest = config.slice(start);
	const nextHeader = rest.slice(1).search(/^\[/m);
	return nextHeader === -1 ? rest : rest.slice(0, nextHeader + 1);
}
