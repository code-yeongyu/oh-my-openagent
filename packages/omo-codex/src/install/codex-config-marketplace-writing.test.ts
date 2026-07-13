import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

describe("codex config marketplace writing", () => {
	test("writes config blocks and stays idempotent", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-config-"));
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				"[marketplaces.code-yeongyu-codex-plugins]",
				'last_updated = "2026-05-01T00:00:00Z"',
				'source_type = "git"',
				'source = "https://github.com/code-yeongyu/codex-plugins.git"',
				"",
				'[plugins."omo@code-yeongyu-codex-plugins"]',
				"enabled = true",
				"",
				'[plugins."omo@code-yeongyu-codex-plugins".mcp_servers.lsp]',
				"enabled = true",
				"",
				"[hooks.state.'omo@code-yeongyu-codex-plugins:hooks/hooks.json:post_tool_use:0:0']",
				'trusted_hash = "sha256:old"',
				"",
				"[marketplaces.lazycodex]",
				'last_updated = "2026-05-10T00:00:00Z"',
				'source_type = "local"',
				'source = "/tmp/stale-lazycodex-cache"',
				"",
				'[plugins."omo@lazycodex"]',
				"enabled = true",
				"",
				"[hooks.state.'omo@lazycodex:hooks/hooks.json:post_tool_use:0:0']",
				'trusted_hash = "sha256:stale"',
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
					trustedHash: "sha256:abc",
				},
			],
			agentConfigs: [
				{ name: "explorer", configFile: "./agents/explorer.toml" },
				{ name: "librarian", configFile: "./agents/librarian.toml" },
				{ name: "plan", configFile: "./agents/plan.toml" },
			],
		});
		const firstContent = await readFile(configPath, "utf8");
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
					trustedHash: "sha256:abc",
				},
			],
			agentConfigs: [
				{ name: "explorer", configFile: "./agents/explorer.toml" },
				{ name: "librarian", configFile: "./agents/librarian.toml" },
				{ name: "plan", configFile: "./agents/plan.toml" },
			],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toBe(firstContent);
		expect(content.match(/^last_updated\s*=/gm)).toHaveLength(1);
		expect(content).toContain("[features]");
		expect(content).toContain("plugins = true");
		expect(content).toContain("plugin_hooks = true");
		expect(content).toContain("[marketplaces.sisyphuslabs]");
		expect(content).toContain('source_type = "local"');
		expect(content).toContain(
			'source = "/repo/packages/omo-codex/cache/sisyphuslabs"',
		);
		expect(content).not.toContain(
			'source = "https://github.com/code-yeongyu/lazycodex.git"',
		);
		expect(content).not.toContain('ref = "main"');
		expect(content).toContain('[plugins."omo@sisyphuslabs"]');
		expect(content).toContain(
			'[hooks.state."omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0"]',
		);
		expect(content).toContain("[agents.explorer]");
		expect(content).toContain('config_file = "./agents/explorer.toml"');
		expect(content).toContain("[agents.librarian]");
		expect(content).toContain('config_file = "./agents/librarian.toml"');
		expect(content).toContain("[agents.plan]");
		expect(content).toContain('config_file = "./agents/plan.toml"');
		expect(content).not.toContain("[marketplaces.lazycodex]");
		expect(content).not.toContain("omo@lazycodex");
		expect(content).not.toContain("/tmp/stale-lazycodex-cache");
		expect(content).not.toContain("code-yeongyu-codex-plugins");
	});

	test("#given comment and subkey decoys match the desired source #when updating #then active marketplace assignments are repaired", async () => {
		const root = await mkdtemp(join(tmpdir(), "omo-codex-marketplace-decoy-"));
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				"[marketplaces.debug]",
				'last_updated = "2020-01-01T00:00:00Z"',
				'source_type = "git"',
				'source = "https://example.invalid/stale.git"',
				'# source_type = "local"',
				'# source = "/repo/packages/omo-codex"',
				'previous_source_type = "local"',
				'previous_source = "/repo/packages/omo-codex"',
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

		const content = await readFile(configPath, "utf8");
		expect(content).toContain('source_type = "local"');
		expect(content).toContain('source = "/repo/packages/omo-codex"');
		expect(content).not.toContain("example.invalid");
		expect(content).not.toContain('previous_source_type = "local"');
	});

	test("#given marketplace bootstrap preserves source #when marketplace block exists #then existing source stays byte-identical", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-preserve-marketplace-"),
		);
		const configPath = join(root, "config.toml");
		const existingMarketplaceBlock = [
			"[marketplaces.sisyphuslabs]",
			'last_updated = "2026-06-15T00:00:00Z"',
			'source_type = "git"',
			'source = "https://github.com/code-yeongyu/lazycodex.git"',
			'ref = "main"',
		].join("\n");
		await writeFile(configPath, `${existingMarketplaceBlock}\n`);

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
			preserveMarketplaceSource: true,
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain(existingMarketplaceBlock);
		expect(content).not.toContain('source = "/repo/packages/omo-codex"');
	});

	test("#given git marketplace source #when updating config #then writes second-precision timestamp and ref", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-marketplace-git-"),
		);
		const configPath = join(root, "config.toml");

		// when
		await updateCodexConfig({
			configPath,
			repoRoot: "/repo/packages/omo-codex",
			marketplaceName: "debug",
			marketplaceSource: {
				sourceType: "git",
				source: "https://github.com/code-yeongyu/lazycodex.git",
				ref: "main",
			},
			pluginNames: ["omo"],
		});

		// then
		const content = await readFile(configPath, "utf8");
		const lastUpdatedLine = content
			.split("\n")
			.find((line) => line.startsWith("last_updated = "));
		expect(lastUpdatedLine ?? "").toMatch(
			/^last_updated = "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"$/,
		);
		expect(content).toContain('source_type = "git"');
		expect(content).toContain(
			'source = "https://github.com/code-yeongyu/lazycodex.git"',
		);
		expect(content).toContain('ref = "main"');
	});
});
