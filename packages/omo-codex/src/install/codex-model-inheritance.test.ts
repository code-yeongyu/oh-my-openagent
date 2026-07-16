/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

const ROOT_PROFILE_KEY =
	/^(model|model_context_window|model_reasoning_effort|plan_mode_reasoning_effort)\s*=/;

describe("Codex model inheritance", () => {
	test("#given blank config #when installer updates config #then root model inheritance remains intact", async () => {
		const content = await installConfig("");

		expect(rootProfileAssignments(content)).toEqual([]);
		expect(content).toContain("[features.multi_agent_v2]");
		expect(content).toContain('tool_namespace = "agents"');
		expect(content).toContain("hide_spawn_agent_metadata = false");
	});

	test("#given project-style section config #when installer updates config #then root model inheritance remains intact", async () => {
		const content = await installConfig(
			[
				"[mcp_servers.local]",
				'command = "node"',
				"",
				"[hooks]",
				"enabled = true",
				"",
				"[features]",
				"plugins = false",
				"",
				"[agents]",
				"max_depth = 4",
				"",
			].join("\n"),
		);

		expect(rootProfileAssignments(content)).toEqual([]);
		expect(content).toContain("[mcp_servers.local]");
		expect(content).toContain("[hooks]");
		expect(content).toContain("max_depth = 4");
		expect(content).toContain('tool_namespace = "agents"');
		expect(content).toContain("hide_spawn_agent_metadata = false");
	});

	test("#given explicit root GPT-5.6 config #when installer updates config #then it preserves the explicit selection", async () => {
		const content = await installConfig(
			['model = "gpt-5.6-sol"', 'model_reasoning_effort = "max"', ""].join(
				"\n",
			),
		);

		expect(rootProfileAssignments(content)).toEqual([
			'model = "gpt-5.6-sol"',
			'model_reasoning_effort = "max"',
		]);
	});

	test("#given explicit custom root config #when installer updates config #then it preserves the custom selection", async () => {
		const content = await installConfig(
			['model = "private/model"', 'model_reasoning_effort = "medium"', ""].join(
				"\n",
			),
		);

		expect(rootProfileAssignments(content)).toEqual([
			'model = "private/model"',
			'model_reasoning_effort = "medium"',
		]);
	});

	test("#given only a nested agent model #when installer updates config #then the nested pin remains and root model stays inherited", async () => {
		const content = await installConfig(
			[
				"[agents.explorer]",
				'model = "gpt-5.6-terra"',
				'model_reasoning_effort = "medium"',
				"",
			].join("\n"),
		);

		expect(rootProfileAssignments(content)).toEqual([]);
		expect(content).toContain('[agents.explorer]\nmodel = "gpt-5.6-terra"');
		expect(content).toContain('tool_namespace = "agents"');
		expect(content).toContain("hide_spawn_agent_metadata = false");
	});

	test("#given inherited root model config #when installer runs twice #then the second run is byte-idempotent", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-model-inherit-idempotent-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(configPath, "[features]\nplugins = false\n");

		await update(configPath);
		const first = await readFile(configPath, "utf8");
		await update(configPath);
		const second = await readFile(configPath, "utf8");

		expect(second).toBe(first);
		expect(rootProfileAssignments(second)).toEqual([]);
	});
});

async function installConfig(initial: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-model-inherit-"));
	const configPath = join(root, "config.toml");
	await writeFile(configPath, initial);
	await update(configPath);
	return readFile(configPath, "utf8");
}

async function update(configPath: string): Promise<void> {
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
}

function rootProfileAssignments(config: string): string[] {
	const assignments: string[] = [];
	for (const line of config.split(/\n/)) {
		if (line.trimStart().startsWith("[")) break;
		if (ROOT_PROFILE_KEY.test(line.trimStart())) assignments.push(line.trim());
	}
	return assignments;
}
