import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

describe("codex config agent and file writing", () => {
	test("#given managed agent role sections #when updating config #then preserves role config and user max_threads", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-role-section-"),
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
			agentConfigs: [
				{ name: "explorer", configFile: "./agents/explorer.toml" },
			],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain("max_threads = 16");
		expect(content).toContain("[agents.explorer]");
		expect(content).toContain('description = "read-only explorer"');
		expect(content).toContain('config_file = "./agents/explorer.toml"');
	});

	test("#given config path is a symlink #when updating config #then writes through target and preserves link", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-config-symlink-"));
		const targetPath = join(root, "target.toml");
		const configPath = join(root, "config.toml");
		await writeFile(targetPath, "");
		await symlink(targetPath, configPath);

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
		const linkStats = await lstat(configPath);
		const content = await readFile(targetPath, "utf8");
		expect(linkStats.isSymbolicLink()).toBe(true);
		expect(content).toContain("[marketplaces.debug]");
		expect(content).toContain('[plugins."omo@debug"]');
	});

	test("repairs existing agent config_file entries without dropping descriptions", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-config-agents-"));
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				"[agents.explorer]",
				'description = "existing description"',
				'config_file = "./agents/stale-explorer.toml"',
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
			agentConfigs: [
				{ name: "explorer", configFile: "./agents/explorer.toml" },
			],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain("[agents.explorer]");
		expect(content).toContain('description = "existing description"');
		expect(content).toContain('config_file = "./agents/explorer.toml"');
		expect(content).not.toContain("stale-explorer");
		expect(content).not.toContain("ref = undefined");
	});

	test("#given agent name needs quoting #when updating config #then writes quoted agent key", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-quoted-agent-"),
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
			agentConfigs: [
				{ name: "review.agent", configFile: "./agents/review.agent.toml" },
			],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain('[agents."review.agent"]');
		expect(content).toContain('config_file = "./agents/review.agent.toml"');
	});
});
