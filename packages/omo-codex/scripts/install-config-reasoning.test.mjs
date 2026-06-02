import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install/config.mjs";

test("#given empty Codex config #when script installer updates config #then sets default and Plan-mode reasoning effort", async () => {
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
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
});

test("#given existing reasoning config #when script installer updates config #then replaces stale defaults without duplicate keys", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-reasoning-existing-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
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
	assert.equal(content.match(/^model_reasoning_effort\s*=/gm)?.length, 1);
	assert.equal(content.match(/^plan_mode_reasoning_effort\s*=/gm)?.length, 1);
	assert.match(content, /model_reasoning_effort = "high"/);
	assert.match(content, /plan_mode_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(content, /model_reasoning_effort = "low"/);
	assert.doesNotMatch(content, /plan_mode_reasoning_effort = "medium"/);
});
