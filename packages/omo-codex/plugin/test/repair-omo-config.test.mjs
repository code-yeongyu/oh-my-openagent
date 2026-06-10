import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	applyOmoConfigRepair,
	discoverOmoInstallState,
	isOmoConfigHealthy,
	repairOmoCodexConfig,
} from "../scripts/repair-omo-config.mjs";

const SOURCE_PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function seedInstalledOmo(codexHome) {
	const cacheRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0");
	await mkdir(join(cacheRoot, ".codex-plugin"), { recursive: true });
	await mkdir(join(cacheRoot, "hooks"), { recursive: true });
	await cp(join(SOURCE_PLUGIN_ROOT, ".codex-plugin", "plugin.json"), join(cacheRoot, ".codex-plugin", "plugin.json"));
	await cp(join(SOURCE_PLUGIN_ROOT, "hooks", "hooks.json"), join(cacheRoot, "hooks", "hooks.json"));
	await mkdir(join(codexHome, "agents"), { recursive: true });
	await writeFile(join(codexHome, "agents", "plan.toml"), 'model_reasoning_effort = "high"\n');
}

test("#given stripped Codex config after provider switch #when repairing #then restores omo plugin without touching auth settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-repair-provider-switch-"));
	const codexHome = join(root, "codex-home");
	await seedInstalledOmo(codexHome);

	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			'model_provider = "custom"',
			"",
			"[model_providers.custom]",
			'name = "custom"',
			'wire_api = "responses"',
			"requires_openai_auth = true",
			'base_url = "https://api.example.test/openai"',
			"",
		].join("\n"),
	);

	const result = await repairOmoCodexConfig({ env: { CODEX_HOME: codexHome }, platform: "win32" });
	const content = await readFile(configPath, "utf8");

	assert.equal(result.repaired, true);
	assert.match(content, /\[marketplaces\.sisyphuslabs\]/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\]/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\][\s\S]*enabled = true/);
	assert.match(content, /base_url = "https:\/\/api\.example\.test\/openai"/);
	assert.match(content, /model_provider = "custom"/);
	assert.doesNotMatch(content, /plan_mode_reasoning_effort = "xhigh"/);
});

test("#given official Codex config without custom provider #when repairing #then preserves chatgpt-oriented settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-repair-official-"));
	const codexHome = join(root, "codex-home");
	await seedInstalledOmo(codexHome);

	const configPath = join(codexHome, "config.toml");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			'model_reasoning_effort = "xhigh"',
			"",
			"[windows]",
			'sandbox = "elevated"',
			"",
		].join("\n"),
	);

	const result = await repairOmoCodexConfig({ env: { CODEX_HOME: codexHome }, platform: "linux" });
	const content = await readFile(configPath, "utf8");

	assert.equal(result.repaired, true);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\]/);
	assert.match(content, /model_reasoning_effort = "xhigh"/);
	assert.doesNotMatch(content, /\[model_providers\./);
});

test("#given healthy omo config #when repairing #then leaves config unchanged", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-repair-healthy-"));
	const codexHome = join(root, "codex-home");
	await seedInstalledOmo(codexHome);
	const discovered = await discoverOmoInstallState({ codexHome, platform: "linux" });
	assert.notEqual(discovered, null);

	const healthyConfig = applyOmoConfigRepair("", discovered);
	assert.equal(isOmoConfigHealthy(healthyConfig, discovered), true);

	const configPath = join(codexHome, "config.toml");
	await writeFile(configPath, healthyConfig);
	const result = await repairOmoCodexConfig({ env: { CODEX_HOME: codexHome }, platform: "linux" });
	assert.equal(result.repaired, false);
	assert.equal(result.reason, "ok");
});