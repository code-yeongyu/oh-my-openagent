import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { multiAgentV2Section } from "./install-config-fixture.mjs";
import { updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given empty Codex config #when script installer updates config #then sets subagent thread limits without forcing MultiAgentV2", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-"),
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
	// An inherited/UI-selected model may resolve to V2, so the installer must
	// not introduce agents.max_threads (Codex rejects it under MultiAgentV2).
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(config, /^\s*max_threads\s*=/m);
	assert.match(config, /\[features\.multi_agent_v2\]/);
	const v2Section = multiAgentV2Section(config);
	assert.doesNotMatch(v2Section, /^enabled\s*=/m);
	assert.doesNotMatch(v2Section, /max_concurrent_threads_per_session/);
});

test("#given queue multi-agent mode #when script installer updates config #then removes unsupported root key", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-multi-agent-mode-"),
	);
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
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /^\s*multi_agent_mode\s*=/m);
	assert.doesNotMatch(config, /multi_agent_mode = "queue"/);
});

test("#given indented steering mode and inline-comment features table #when script installer updates config #then removes root key and keeps one features table", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-toml-root-regression-"),
	);
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
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
		pluginNames: ["omo"],
	});

	const config = await readFile(configPath, "utf8");
	assert.equal(config.match(/^\s*multi_agent_mode\s*=/gm)?.length ?? 0, 0);
	assert.equal(config.match(/^\s*\[features\](?:\s*#.*)?$/gm)?.length, 1);
	assert.match(config, /^\[features\] # keep comment$/m);
	assert.doesNotMatch(config, /multi_agent_mode = "queue"/);
	assert.doesNotMatch(config, /multi_agent_mode = "steering"/);
});

test("#given Codex config is a symlink #when script installer updates config #then writes through the target", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-symlink-"),
	);
	const targetPath = join(root, "actual-config.toml");
	const configPath = join(root, "config.toml");
	await writeFile(targetPath, "[features]\nplugins = false\n");
	await symlink(targetPath, configPath);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex/cache/sisyphuslabs",
		},
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
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-sisyphuslabs-"),
	);
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex",
		},
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
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex/cache/sisyphuslabs",
		},
		pluginNames: ["omo"],
		trustedHookStates: [
			{
				key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0",
				trustedHash: "sha256:keep",
			},
		],
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\]/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.lsp\]/);
	assert.match(
		content,
		/\[hooks\.state\."omo@sisyphuslabs:hooks\/hooks\.json:post_tool_use:0:0"\]/,
	);
	assert.match(content, /trusted_hash = "sha256:keep"/);
});
