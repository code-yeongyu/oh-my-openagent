import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install/config.mjs";

const ALWAYS_ON_FEATURES = ["plugins", "plugin_hooks"];
const DEFAULT_OFF_MULTI_AGENT_FEATURES = ["multi_agent", "child_agents_md"];
const AUTONOMOUS_PERMISSION_FEATURES = ["unified_exec", "goals"];

test("#given autonomous permissions requested #when script installer updates config #then keeps multi-agent flags disabled while enabling Codex autonomy", async () => {
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
			"child_agents_md = false",
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
	for (const featureName of DEFAULT_OFF_MULTI_AGENT_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = false`));
	}
	for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = true`));
	}
});

test("#given autonomous permissions disabled #when script installer updates config #then keeps native Codex plugin flags enabled without turning on multi-agent", async () => {
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
			"child_agents_md = false",
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
	for (const featureName of DEFAULT_OFF_MULTI_AGENT_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = false`));
	}
	for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = false`));
	}
});

test("#given indented user multi-agent flags #when script installer updates config #then preserves explicit user choices without duplicates", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-autonomous-features-indented-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[features]",
			"  multi_agent = true",
			"  child_agents_md = true",
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
	assert.equal(content.match(/^\s*multi_agent\s*=/gm)?.length, 1);
	assert.equal(content.match(/^\s*child_agents_md\s*=/gm)?.length, 1);
	assert.match(content, /^  multi_agent = true$/m);
	assert.match(content, /^  child_agents_md = true$/m);
});
