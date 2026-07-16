/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

describe("codex subagent limit config", () => {
	test("#given empty Codex config #when updating config #then leaves the v2 cap absent without agents.max_threads", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-subagent-limit-empty-"),
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
		// An inherited/UI-selected model may resolve to V2, where Codex rejects
		// a fresh agents.max_threads setting.
		const content = await readFile(configPath, "utf8");
		expect(content).not.toMatch(/^\s*max_threads\s*=/m);
		expect(content).toContain("[features.multi_agent_v2]");
		expect(content).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given existing low agents max_threads #when updating config #then preserves the user cap", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-subagent-limit-existing-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.5"',
				"",
				"[agents]",
				"max_threads = 6",
				"max_depth = 4",
				"",
				"[agents.explorer]",
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
		expect(content).toMatch(/\[agents\][\s\S]*?max_threads = 6/);
		expect(content).toContain("max_depth = 4");
		expect(content).toContain("[agents.explorer]");
		expect(content).toContain('config_file = "./agents/explorer.toml"');
	});
});
