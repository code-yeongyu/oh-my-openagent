import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given empty Codex config #when script installer updates config #then leaves Context7 to the plugin MCP manifest", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-context7-"),
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
	const config = await readFile(configPath, "utf8");
	assert.doesNotMatch(config, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(config, /@upstash\/context7-mcp/);
	assert.doesNotMatch(config, /YOUR_API_KEY/);
});

test("#given sisyphuslabs omo install #when script installer updates config #then enables Context7 plugin mcp policy", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-context7-plugin-policy-"),
	);
	const configPath = join(root, "config.toml");

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
	const config = await readFile(configPath, "utf8");
	assert.match(
		config,
		/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]/,
	);
	assert.match(
		config,
		/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/,
	);
	assert.doesNotMatch(config, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(config, /@upstash\/context7-mcp/);
	assert.doesNotMatch(config, /YOUR_API_KEY/);
});

test("#given existing Context7 MCP config #when script installer updates config #then leaves user setup untouched", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-context7-existing-"),
	);
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[mcp_servers.context7] # stale npx package from old docs",
			'command = "node"',
			'args = ["/opt/context7/server.js"]',
			"startup_timeout_sec = 40",
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
	assert.match(config, /\[mcp_servers\.context7\]/);
	assert.match(config, /command = "node"/);
	assert.match(config, /args = \["\/opt\/context7\/server\.js"\]/);
	assert.match(config, /startup_timeout_sec = 40/);
	assert.doesNotMatch(config, /YOUR_API_KEY/);
});

test("#given real Context7 API key and placeholder comment #when script installer updates config #then preserves user setup", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-context7-real-key-"),
	);
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
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex/cache/sisyphuslabs",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[mcp_servers\.context7\]/);
	assert.match(config, /ctx7sk_live_example/);
	assert.match(config, /replace YOUR_API_KEY in docs only/);
	assert.match(
		config,
		/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]/,
	);
});

test("#given stale Context7 placeholder MCP config #when script installer updates config #then removes it for plugin MCP", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-script-config-context7-placeholder-"),
	);
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
		marketplaceSource: {
			sourceType: "local",
			source: "/repo/packages/omo-codex/cache/sisyphuslabs",
		},
		pluginNames: ["omo"],
	});

	// then
	const config = await readFile(configPath, "utf8");
	assert.match(
		config,
		/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\]/,
	);
	assert.doesNotMatch(config, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(config, /@upstash\/context7-mcp/);
	assert.doesNotMatch(config, /YOUR_API_KEY/);
});
