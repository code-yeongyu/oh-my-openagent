import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readCodexModelCatalog, updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given empty Codex config #when script installer updates config #then sets worker model and reasoning defaults", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-reasoning-"));
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
	const content = await readFile(configPath, "utf8");
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
});

test("#given existing model and reasoning config #when script installer updates config #then replaces stale defaults without duplicate keys", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-reasoning-existing-"));
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.equal(content.match(/^model\s*=/gm)?.length, 1);
	assert.equal(content.match(/^model_context_window\s*=/gm)?.length, 1);
	assert.equal(content.match(/^model_reasoning_effort\s*=/gm)?.length, 1);
	assert.equal(content.match(/^plan_mode_reasoning_effort\s*=/gm)?.length, 1);
	assert.match(content, /model = "gpt-5\.5"/);
	assert.match(content, /model_context_window = 400000/);
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(content, /model = "gpt-5\.2"/);
	assert.doesNotMatch(content, /model_context_window = 272000/);
	assert.doesNotMatch(content, /model_reasoning_effort = "low"/);
	assert.doesNotMatch(content, /plan_mode_reasoning_effort = "medium"/);
});

test("#given user-customized model config #when script installer updates config #then preserves user reasoning values", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-reasoning-custom-"));
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
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /model = "my-private-model"/);
	assert.match(content, /model_context_window = 123456/);
	assert.match(content, /model_reasoning_effort = "medium"/);
	assert.match(content, /plan_mode_reasoning_effort = "medium"/);
});

test("#given bundled model catalog #when script installer updates config #then reads defaults from catalog", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-reasoning-catalog-"));
	const repoRoot = join(root, "omo-codex");
	const configPath = join(root, "config.toml");
	await mkdir(join(repoRoot, "plugin"), { recursive: true });
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
			managedProfiles: [],
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
	assert.match(content, /model = "catalog-default"/);
	assert.match(content, /model_context_window = 123456/);
	assert.match(content, /model_reasoning_effort = "medium"/);
	assert.match(content, /plan_mode_reasoning_effort = "high"/);
});

test("#given fallback model catalog #when catalog file is unavailable #then no managed preset uses pure GPT-5.4", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-fallback-catalog-"));

	// when
	const catalog = await readCodexModelCatalog(root);

	// then
	assert.equal(catalog.current.model, "gpt-5.5");
	assert.equal(catalog.managedProfiles.some((profile) => profile.model === "gpt-5.4"), false);
});
