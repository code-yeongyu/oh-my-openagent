import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given autonomous permissions requested #when script installer updates config #then enables full Codex autonomy", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-autonomous-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'approval_policy = "on-request"',
			'sandbox_mode = "workspace-write"',
			'network_access = "disabled"',
			"",
			"[notice]",
			"hide_full_access_warning = false",
			"",
			"[windows]",
			'sandbox = "workspace-write"',
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
	const config = await readFile(configPath, "utf8");
	assert.match(config, /approval_policy = "never"/);
	assert.match(config, /sandbox_mode = "danger-full-access"/);
	assert.match(config, /network_access = "enabled"/);
	assert.match(config, /\[notice\]/);
	assert.match(config, /hide_full_access_warning = true/);
	assert.match(config, /hide_world_writable_warning = true/);
	assert.doesNotMatch(config, /sandbox = "workspace-write"/);
});
