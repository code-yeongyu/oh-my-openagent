import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

const ALWAYS_ON_FEATURES = ["plugins", "plugin_hooks", "multi_agent"];
const AUTONOMOUS_PERMISSION_FEATURES = ["unified_exec", "goals"];

test("#given autonomous permissions requested #when script installer updates config #then enables Codex autonomy feature flags", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-autonomous-features-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'network_access = "disabled"',
			"",
			"[features]",
			"multi_agent = false",
			"unified_exec = false",
			"goals = false",
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
		autonomousPermissions: true,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /network_access = "enabled"/);
	for (const featureName of ALWAYS_ON_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = true`));
	}
	for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = true`));
	}
});

test("#given autonomous permissions disabled #when script installer updates config #then keeps native Codex feature flags enabled", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-autonomous-features-disabled-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'network_access = "disabled"',
			"",
			"[features]",
			"multi_agent = false",
			"unified_exec = false",
			"goals = false",
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
		autonomousPermissions: false,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /network_access = "disabled"/);
	for (const featureName of ALWAYS_ON_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = true`));
	}
	for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = false`));
	}
});

test("#given existing child_agents_md setting #when script installer updates config #then preserves it without stamping unsupported values", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-child-agents-preserve-"));
	const configPath = join(root, "config.toml");
	await writeFile(configPath, ["[features]", "child_agents_md = false", ""].join("\n"));

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		autonomousPermissions: true,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /child_agents_md = false/);
	assert.doesNotMatch(content, /child_agents_md = true/);
});

test("#given config without child_agents_md #when script installer updates config #then does not add unsupported feature key", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-child-agents-absent-"));
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		autonomousPermissions: true,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /child_agents_md/);
});
