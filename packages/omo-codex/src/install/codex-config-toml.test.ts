/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

describe("codex config permissions", () => {
	test("#given autonomous permissions requested #when updating config #then enables full Codex autonomy", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-config-autonomous-"));
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
				"hide_world_writable_warning = false",
				"hide_rate_limit_model_nudge = true",
				"",
				"[windows]",
				'sandbox = "elevated"',
				"wsl2_proxy = true",
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
			autonomousPermissions: true,
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain('approval_policy = "never"');
		expect(content).toContain('sandbox_mode = "danger-full-access"');
		expect(content).toContain('network_access = "enabled"');
		expect(content).toContain("[notice]");
		expect(content).toContain("hide_full_access_warning = true");
		expect(content).toContain("hide_world_writable_warning = true");
		expect(content).toContain("hide_rate_limit_model_nudge = true");
		expect(content).toContain("[windows]");
		expect(content).toContain("wsl2_proxy = true");
		expect(content).not.toContain('approval_policy = "on-request"');
		expect(content).not.toContain('sandbox_mode = "workspace-write"');
		expect(content).not.toContain('sandbox = "elevated"');
	});
});
