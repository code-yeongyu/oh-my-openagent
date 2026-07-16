/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";
import { ensureCodexMultiAgentV2Config } from "./codex-multi-agent-v2-config";

describe("codex MultiAgentV2 config", () => {
	test("#given blank config #when ensuring installer V2 config #then leaves the cap absent", () => {
		const result = ensureCodexMultiAgentV2Config("");

		expect(result).toContain("[features.multi_agent_v2]");
		expect(result).toContain('tool_namespace = "agents"');
		expect(result).toContain("hide_spawn_agent_metadata = false");
		expect(result).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given a V2 model and no V2 table #when ensuring installer config #then adds routing without a cap", () => {
		const result = ensureCodexMultiAgentV2Config('model = "gpt-5.6-sol"\n', {
			multiAgentVersion: "v2",
		});

		expect(result).toContain("[features.multi_agent_v2]");
		expect(result).toContain('tool_namespace = "agents"');
		expect(result).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given an explicit custom V2 cap #when ensuring installer config #then preserves the user value", () => {
		const result = ensureCodexMultiAgentV2Config(
			[
				'model = "gpt-5.6-sol"',
				"",
				"[features.multi_agent_v2]",
				"max_concurrent_threads_per_session = 7",
				"",
			].join("\n"),
			{ multiAgentVersion: "v2" },
		);

		expect(result).toContain("max_concurrent_threads_per_session = 7");
		expect(result).not.toContain("max_concurrent_threads_per_session = 1000");
	});

	test("#given an unmarked V2 cap of 1000 #when ensuring installer config #then preserves it as user-owned", () => {
		const result = ensureCodexMultiAgentV2Config(
			[
				'model = "gpt-5.6-sol"',
				"",
				"[features.multi_agent_v2]",
				"max_concurrent_threads_per_session = 1000",
				"",
			].join("\n"),
			{ multiAgentVersion: "v2" },
		);

		expect(result).toContain("max_concurrent_threads_per_session = 1000");
	});

	test("#given a historical OMO-managed V2 cap #when ensuring installer config #then removes the managed 1000", () => {
		const result = ensureCodexMultiAgentV2Config(
			[
				'model = "gpt-5.6-sol"',
				"",
				"# Work around openai/codex#26753: multi_agent_v2 is re-disabled on every Codex session start",
				"# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
				"[features.multi_agent_v2]",
				"enabled = false",
				"max_concurrent_threads_per_session = 1000",
				"",
			].join("\n"),
			{ multiAgentVersion: "v2" },
		);

		expect(result).not.toContain("max_concurrent_threads_per_session");
	});

	test("#given an unrelated historical marker elsewhere #when ensuring installer config #then the user cap and comment survive", () => {
		const config = [
			"# User note: see openai/codex#26753 for background",
			'model = "gpt-5.6-sol"',
			"",
			"[features.multi_agent_v2]",
			"max_concurrent_threads_per_session = 1000",
			"",
		].join("\n");

		const result = ensureCodexMultiAgentV2Config(config, {
			multiAgentVersion: "v2",
		});

		expect(result).toContain(
			"# User note: see openai/codex#26753 for background",
		);
		expect(result).toContain("max_concurrent_threads_per_session = 1000");
	});

	test("#given legacy agents max_threads #when ensuring any model version #then the user value is preserved", () => {
		for (const multiAgentVersion of ["v1", "v2", null] as const) {
			const config = [
				'model = "gpt-5.5"',
				"",
				"[agents]",
				"max_threads = 6",
				"",
			].join("\n");

			expect(
				ensureCodexMultiAgentV2Config(config, { multiAgentVersion }),
			).toContain("max_threads = 6");
		}
	});

	test("#given legacy boolean flag and table #when updating config #then output remains valid TOML without enabling V2", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-valid-toml-"));
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.6-sol"',
				"",
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
		const parsed = parseToml(content);
		expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m);
		const multiAgentV2 = parsed.features.multi_agent_v2;
		expect(multiAgentV2.usage_hint_enabled).toBe(false);
		expect("max_concurrent_threads_per_session" in multiAgentV2).toBe(false);
		expect(multiAgentV2.tool_namespace).toBe("agents");
		expect(multiAgentV2.hide_spawn_agent_metadata).toBe(false);
		const modeHint = multiAgentV2.multi_agent_mode_hint_text;
		expect(typeof modeHint).toBe("string");
		if (typeof modeHint !== "string")
			throw new Error("multi_agent_mode_hint_text must be a string");
		expect(modeHint.trim()).not.toBe("");
	});

	test("#given disabled boolean shorthand #when updating config #then explicit disable is preserved in table form", async () => {
		// given
		// A pinned v1 model keeps the explicit disable materializing in table form;
		// the stamped v2-preferred default would drop the disable instead.
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-mav2-disabled-shorthand-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				'model = "gpt-5.5"',
				"",
				"[features]",
				"multi_agent_v2 = false # user disabled the beta path",
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
		const parsed = parseToml(content);
		expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m);
		expect(parsed.features.multi_agent_v2).toEqual({
			enabled: false,
		});
	});
});

interface ParsedCodexConfig {
	readonly features: {
		readonly multi_agent_v2: Record<string, boolean | number | string>;
	};
}

function parseToml(config: string): ParsedCodexConfig {
	const parsed: unknown = Bun.TOML.parse(config);
	if (!isParsedCodexConfig(parsed)) {
		throw new Error("Parsed TOML did not have the expected Codex config shape");
	}
	return parsed;
}

function isParsedCodexConfig(value: unknown): value is ParsedCodexConfig {
	if (!isRecord(value)) return false;
	const features = value.features;
	if (!isRecord(features)) return false;
	return isRecord(features.multi_agent_v2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
