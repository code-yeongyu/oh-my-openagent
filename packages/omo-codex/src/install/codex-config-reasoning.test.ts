/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";
import { readCodexModelCatalog } from "./codex-model-catalog";

describe("codex-config-reasoning", () => {
	test("#given empty Codex config #when updating config #then preserves Codex root model inheritance", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-config-reasoning-"));
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
		expect(content).not.toMatch(/^model\s*=/m);
		expect(content).not.toMatch(/^model_context_window\s*=/m);
		expect(content).not.toMatch(/^model_reasoning_effort\s*=/m);
		expect(content).not.toMatch(/^plan_mode_reasoning_effort\s*=/m);
	});

	test("#given existing model and reasoning config #when updating config #then replaces stale defaults without duplicate keys", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-reasoning-existing-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.5"',
				"model_context_window = 272000",
				'model_reasoning_effort = "low"',
				'plan_mode_reasoning_effort = "medium"',
				"",
				"[features]",
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
		expect(content.match(/^model\s*=/gm)).toHaveLength(1);
		expect(content.match(/^model_context_window\s*=/gm)).toHaveLength(1);
		expect(content.match(/^model_reasoning_effort\s*=/gm)).toHaveLength(1);
		expect(content.match(/^plan_mode_reasoning_effort\s*=/gm)).toHaveLength(1);
		expect(content).toContain('model = "gpt-5.6-sol"');
		expect(content).toContain("model_context_window = 372000");
		expect(content).toContain('model_reasoning_effort = "high"');
		expect(content).toContain('plan_mode_reasoning_effort = "xhigh"');
		expect(content).not.toContain("model_context_window = 272000");
		expect(content).not.toContain('model_reasoning_effort = "low"');
		expect(content).not.toContain('plan_mode_reasoning_effort = "medium"');
		expect(content).toContain("[features]");
		expect(content).toContain("plugins = true");
	});

	test("#given user-customized model config #when updating config #then preserves user reasoning values", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-reasoning-custom-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "my-private-model"',
				"model_context_window = 123456",
				'model_reasoning_effort = "medium"',
				'plan_mode_reasoning_effort = "medium"',
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
		expect(content).toContain('model = "my-private-model"');
		expect(content).toContain("model_context_window = 123456");
		expect(content).toContain('model_reasoning_effort = "medium"');
		expect(content).toContain('plan_mode_reasoning_effort = "medium"');
	});

	test("#given bundled model catalog #when updating config #then reads defaults from catalog", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-reasoning-catalog-"),
		);
		const repoRoot = join(root, "omo-codex");
		const configPath = join(root, "config.toml");
		await mkdir(join(repoRoot, "plugin"), { recursive: true });
		await writeFile(
			configPath,
			[
				'model = "catalog-old"',
				"model_context_window = 654321",
				'model_reasoning_effort = "low"',
				'plan_mode_reasoning_effort = "medium"',
				"",
			].join("\n"),
		);
		await writeFile(
			join(repoRoot, "plugin", "model-catalog.json"),
			JSON.stringify({
				version: "test.catalog",
				current: {
					model: "catalog-default",
					model_context_window: 123456,
					model_reasoning_effort: "medium",
					plan_mode_reasoning_effort: "high",
				},
				managedProfiles: [
					{
						version: "test.old",
						match: {
							model: "catalog-old",
							model_context_window: 654321,
							model_reasoning_effort: "low",
							plan_mode_reasoning_effort: "medium",
						},
					},
				],
			}),
		);

		// when
		await updateCodexConfig({
			configPath,
			repoRoot,
			marketplaceName: "debug",
			marketplaceSource: { sourceType: "local", source: repoRoot },
			pluginNames: ["omo"],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain('model = "catalog-default"');
		expect(content).toContain("model_context_window = 123456");
		expect(content).toContain('model_reasoning_effort = "medium"');
		expect(content).toContain('plan_mode_reasoning_effort = "high"');
	});

	test("#given fallback Codex model catalog #when catalog file is unavailable #then no managed preset uses pure GPT-5.4", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-fallback-catalog-"),
		);

		// when
		const catalog = await readCodexModelCatalog(root);

		// then
		expect(catalog.current.model).toBe("gpt-5.6-sol");
		expect(
			catalog.managedProfiles.map((profile) => profile.model),
		).not.toContain("gpt-5.4");
	});
});
