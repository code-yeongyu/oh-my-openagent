import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseToml } from "../plugin/test/parse-toml.mjs";
import { updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given generated installer sees a multiline hint with a table-like line #when updating #then routing keys stay unique", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-generated-mav2-boundary-"),
	);
	const configPath = join(root, "config.toml");
	const customHint = [
		"multi_agent_mode_hint_text = '''Direct work policy:",
		"[Direct work]",
		"Keep bounded tasks local.'''",
	].join("\n");
	await writeFile(
		configPath,
		[
			'model = "gpt-5.6-sol"',
			"",
			"[features.multi_agent_v2]",
			customHint,
			'tool_namespace = "custom-user-namespace"',
			"hide_spawn_agent_metadata = true",
			"",
		].join("\n"),
	);

	await update(configPath);
	const result = await readFile(configPath, "utf8");
	const v2 = parseToml(result).features.multi_agent_v2;

	assert.equal(
		v2.multi_agent_mode_hint_text,
		"Direct work policy:\n[Direct work]\nKeep bounded tasks local.",
	);
	assert.equal(v2.tool_namespace, "agents");
	assert.equal(v2.hide_spawn_agent_metadata, false);
	assert.equal(result.match(/^tool_namespace\s*=/gm)?.length, 1);
	assert.equal(result.match(/^hide_spawn_agent_metadata\s*=/gm)?.length, 1);
	assert.ok(result.includes(customHint));
});

test("#given generated installer sees malformed TOML #when updating twice #then bytes remain unchanged", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-generated-malformed-"));
	const configPath = join(root, "config.toml");
	const initial =
		'model = "gpt-5.6-sol"\nnotes = """\n[features.multi_agent_v2]\n';
	await writeFile(configPath, initial);

	await update(configPath);
	await update(configPath);

	assert.equal(await readFile(configPath, "utf8"), initial);
});

async function update(configPath) {
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
