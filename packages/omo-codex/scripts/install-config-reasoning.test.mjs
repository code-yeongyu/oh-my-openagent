import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install/config.mjs";

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
	assert.match(content, /model = "gpt-5\.4"/);
	assert.match(content, /model_context_window = 1000000/);
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
	assert.match(content, /model = "gpt-5\.4"/);
	assert.match(content, /model_context_window = 1000000/);
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(content, /model = "gpt-5\.5"/);
	assert.doesNotMatch(content, /model_context_window = 272000/);
	assert.doesNotMatch(content, /model_reasoning_effort = "low"/);
	assert.doesNotMatch(content, /plan_mode_reasoning_effort = "medium"/);
});
