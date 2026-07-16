import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

describe("codex config legacy MultiAgent migration", () => {
	test("#given legacy boolean MultiAgentV2 flag and table #when updating config #then normalizes to table config", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-legacy-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				"[features]",
				"multi_agent_v2 = true",
				"plugins = false",
				"",
				"[features.multi_agent_v2]",
				"usage_hint_enabled = false",
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
		expect(content).not.toMatch(/^multi_agent_v2\s*=/m);
		expect(content).toContain("[features.multi_agent_v2]");
		const v2LegacySection = content
			.slice(content.indexOf("[features.multi_agent_v2]"))
			.split(/^\[/m)
			.slice(0, 1)
			.join("");
		expect(v2LegacySection).not.toContain("enabled");
		expect(content).toContain("usage_hint_enabled = false");
		expect(content).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given legacy boolean MultiAgentV2 flag false #when updating config #then normalizes to a disabled table config", async () => {
		// given
		// A pinned v1 model keeps the legacy boolean materializing as a disabled
		// table; the stamped v2-preferred default would drop the disable instead.
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-legacy-false-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.5"',
				"",
				"[features]",
				"multi_agent_v2 = false",
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
		expect(content).not.toMatch(/^multi_agent_v2\s*=/m);
		expect(content).toContain("[features.multi_agent_v2]");
		expect(content).toMatch(/\[features\.multi_agent_v2\]\nenabled = false\n/);
		expect(content).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given legacy agents max_threads #when updating config #then preserves the user thread cap", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-multi-agent-legacy-threads-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.5"',
				"",
				"[agents]",
				"max_threads = 16",
				"max_depth = 4",
				"job_max_runtime_seconds = 3600",
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
		expect(content).toContain("[features.multi_agent_v2]");
		const v2ThreadsSection = content
			.slice(content.indexOf("[features.multi_agent_v2]"))
			.split(/^\[/m)
			.slice(0, 1)
			.join("");
		expect(v2ThreadsSection).not.toContain("enabled");
		expect(content).not.toContain("max_concurrent_threads_per_session");
		expect(content).toContain("[agents]");
		expect(content).toContain("max_threads = 16");
		expect(content).toContain("max_depth = 4");
		expect(content).toContain("job_max_runtime_seconds = 3600");
	});
});
