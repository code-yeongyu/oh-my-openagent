import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

describe("codex config MultiAgent model resolution", () => {
	test("#given gpt-5.6 v2 model in models_cache #when updating config #then preserves agents.max_threads and clears legacy disable", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-v2-preferred-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.6-sol"',
				"",
				"[features]",
				"multi_agent_v2 = false",
				"",
				"[agents]",
				"max_threads = 16",
				"max_depth = 4",
				"",
			].join("\n"),
		);
		await writeFile(
			join(root, "models_cache.json"),
			JSON.stringify({
				models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }],
			}),
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
		expect(content).toMatch(/^\s*max_threads\s*=\s*16$/m);
		expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m);
		expect(content).not.toMatch(/^\s*enabled\s*=\s*false/m);
		expect(content).toContain("max_depth = 4");
		expect(content).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given gpt-5.6 family model without models_cache #when updating config #then treats it as V2-preferred", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-v2-nocache-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(configPath, ['model = "gpt-5.6-terra"', ""].join("\n"));

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
		expect(content).not.toMatch(/^\s*max_threads\s*=/m);
		expect(content).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given gpt-5.6-luna resolving v1 in models_cache #when updating config #then leaves an absent thread cap absent", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-v1-luna-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(configPath, ['model = "gpt-5.6-luna"', ""].join("\n"));
		await writeFile(
			join(root, "models_cache.json"),
			JSON.stringify({
				models: [{ slug: "gpt-5.6-luna", multi_agent_version: "v1" }],
			}),
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
		expect(content).not.toMatch(/^\s*max_threads\s*=/m);
		expect(content).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given user-modified config without root model #when updating config #then does not introduce agents.max_threads", async () => {
		// given: Codex Desktop selects the model in the UI; a user-modified config
		// (reasoning profile not applied) keeps no root model, so the installer
		// cannot prove the session is not a GPT-5.6 V2 model that rejects
		// agents.max_threads at thread/start (#6002).
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-no-model-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model_reasoning_effort = "high"',
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
		expect(content).not.toMatch(/^\s*max_threads\s*=/m);
		expect(content).not.toContain("max_concurrent_threads_per_session");
	});
});

test("#given model_catalog_json declares a v2 family model as v1 #when updating config #then leaves agents.max_threads absent", async () => {
	// given: Codex documents model_catalog_json as a complete replacement for
	// models_cache.json (codex-rs load_model_catalog). A user forcing gpt-5.6-sol
	// to v1 via that catalog must not create a user concurrency setting.
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-config-model-catalog-override-"),
	);
	const configPath = join(root, "config.toml");
	const catalogPath = join(root, "custom-catalog.json");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			`model_catalog_json = ${JSON.stringify(catalogPath)}`,
			"",
			"[features]",
			"multi_agent_v2 = false",
			"",
		].join("\n"),
	);
	await writeFile(
		catalogPath,
		JSON.stringify({
			models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }],
		}),
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
	expect(content).not.toMatch(/^\s*max_threads\s*=/m);
	expect(content).not.toContain("max_concurrent_threads_per_session");
});
