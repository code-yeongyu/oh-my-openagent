/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

test("#given a multiline custom hint containing a table-like line #when updating config #then routing keys remain unique and valid", async () => {
	// given
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-mav2-multiline-boundary-"),
	);
	const configPath = join(root, "config.toml");
	const customHint = [
		"multi_agent_mode_hint_text = '''Direct work policy:",
		"[Direct work]",
		"Keep bounded tasks local.'''",
	].join("\n");
	const initial = [
		'model = "gpt-5.6-sol"',
		"",
		"[features.multi_agent_v2]",
		customHint,
		'tool_namespace = "custom-user-namespace"',
		"hide_spawn_agent_metadata = true",
		"",
	].join("\n");
	await writeFile(configPath, initial);

	// when
	await update(configPath);
	const first = await readFile(configPath, "utf8");
	await update(configPath);
	const second = await readFile(configPath, "utf8");
	await update(configPath);
	const third = await readFile(configPath, "utf8");

	// then
	const parsed: unknown = Bun.TOML.parse(first);
	const v2 = readV2Table(parsed);
	expect(v2.multi_agent_mode_hint_text).toBe(
		"Direct work policy:\n[Direct work]\nKeep bounded tasks local.",
	);
	expect(v2.tool_namespace).toBe("agents");
	expect(v2.hide_spawn_agent_metadata).toBe(false);
	expect(first.match(/^tool_namespace\s*=/gm)).toHaveLength(1);
	expect(first.match(/^hide_spawn_agent_metadata\s*=/gm)).toHaveLength(1);
	expect(first).toContain(customHint);
	expect(second).toContain(customHint);
	expect(third).toBe(second);
});

test("#given a quoted dotted V2 header and assignment-looking hint text #when updating #then the existing table is edited semantically", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-quoted-header-"));
	const configPath = join(root, "config.toml");
	const initial = [
		'model = "gpt-5.6-sol"',
		"",
		'[features."multi_agent_v2"]',
		"multi_agent_mode_hint_text = '''",
		'tool_namespace = "user policy text"',
		"'''",
		'tool_namespace = "custom-user-namespace"',
		"hide_spawn_agent_metadata = true",
		"",
	].join("\n");
	await writeFile(configPath, initial);

	await update(configPath);
	const result = await readFile(configPath, "utf8");
	const v2 = readV2Table(Bun.TOML.parse(result));

	expect(v2.multi_agent_mode_hint_text).toBe(
		'\ntool_namespace = "user policy text"\n',
	);
	expect(v2.tool_namespace).toBe("agents");
	expect(
		result.match(/\[features\.(?:"multi_agent_v2"|multi_agent_v2)\]/g),
	).toHaveLength(1);
});

test("#given unterminated TOML #when updating repeatedly #then installer fails closed without mutation", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-malformed-"));
	const configPath = join(root, "config.toml");
	const initial =
		'model = "gpt-5.6-sol"\nnotes = """\n[features.multi_agent_v2]\n';
	await writeFile(configPath, initial);

	await update(configPath);
	await update(configPath);

	expect(await readFile(configPath, "utf8")).toBe(initial);
});

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

function readV2Table(value: unknown): Record<string, unknown> {
	const root = requireRecord(value, "config");
	const features = requireRecord(root.features, "features");
	return requireRecord(features.multi_agent_v2, "features.multi_agent_v2");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new TypeError(`${label} must be a TOML table`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
