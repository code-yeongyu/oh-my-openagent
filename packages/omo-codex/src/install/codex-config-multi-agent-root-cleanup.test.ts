import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";
import { findTomlSection } from "./toml-section-editor";

describe("codex config MultiAgent root cleanup", () => {
	test("#given empty Codex config #when updating config #then creates MultiAgentV2 section without root multi-agent mode", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-"));
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
		const content = await readFile(configPath, "utf8");
		expect(content).not.toMatch(/^\s*multi_agent_mode\s*=/m);
		expect(content).toContain("[features.multi_agent_v2]");
		const v2Section = findTomlSection(content, "features.multi_agent_v2");
		expect(v2Section).toBeDefined();
		expect(v2Section?.text).not.toContain("enabled");
		expect(content).not.toContain("max_concurrent_threads_per_session");
		// An inherited/UI-selected model may resolve to V2, where Codex rejects
		// agents.max_threads, so a fresh install must not introduce it.
		expect(content).not.toMatch(/^\s*max_threads\s*=/m);
		expect(v2Section?.text).toContain('tool_namespace = "agents"');
		expect(v2Section?.text).toContain("hide_spawn_agent_metadata = false");
	});

	test("#given stale queue multi-agent mode #when updating config #then removes unsupported root key", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-mode-"),
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
		const content = await readFile(configPath, "utf8");
		expect(content).not.toMatch(/^\s*multi_agent_mode\s*=/m);
		expect(content).not.toContain('multi_agent_mode = "queue"');
	});

	test("#given stale indented steering mode and inline-comment features table #when updating config #then removes root key and preserves table", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-toml-root-regression-"),
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
		const content = await readFile(configPath, "utf8");
		expect(content.match(/^\s*multi_agent_mode\s*=/gm)).toBeNull();
		expect(content.match(/^\s*\[features\](?:\s*#.*)?$/gm)).toHaveLength(1);
		expect(content).toContain("[features] # keep comment");
		expect(content).not.toContain('multi_agent_mode = "queue"');
		expect(content).not.toContain('multi_agent_mode = "steering"');
	});

	test("#given stale proactive multi-agent mode #when updating config #then removes unsupported root key", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-proactive-cleanup-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'multi_agent_mode = "proactive"',
				"",
				"[features]",
				"multi_agent = true",
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
		const content = await readFile(configPath, "utf8");
		expect(content).not.toMatch(/^\s*multi_agent_mode\s*=/m);
		expect(content).toContain("[features]");
	});

	test("#given existing MultiAgentV2 table #when updating config #then preserves user enabled flag and unrelated tuning while setting thread limit", async () => {
		// given
		// A pinned v1 model keeps this exercising the preserve-user-disable path;
		// an absent model remains inherited and does not prove the disable stale.
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-existing-"),
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
		const content = await readFile(configPath, "utf8");
		expect(content).toContain("[features.multi_agent_v2]");
		expect(content).toContain("enabled = false");
		expect(content).toContain("usage_hint_enabled = false");
		expect(content).toContain("max_concurrent_threads_per_session = 4");
		expect(content).not.toContain("max_concurrent_threads_per_session = 1000");
	});
});
