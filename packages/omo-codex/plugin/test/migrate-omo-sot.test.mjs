import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateOmoSotConfig } from "../scripts/migrate-omo-sot.mjs";

test("#given no OMO SOT #when seeding #then creates a parseable scaffold once", async () => {
	const home = await mkdtemp(join(tmpdir(), "omo-sot-seed-"));

	const first = await migrateOmoSotConfig({ env: { HOME: home }, seed: true });
	const before = await readFile(join(home, ".omo", "config.jsonc"), "utf8");
	const second = await migrateOmoSotConfig({ env: { HOME: home }, seed: true });
	const after = await readFile(join(home, ".omo", "config.jsonc"), "utf8");

	assert.equal(first.seeded, true);
	assert.equal(second.seeded, false);
	assert.equal(after, before);
	assert.equal(parseJsonc(after)["[codex]"].codegraph.enabled, undefined);
	assert.equal(parseJsonc(after).codegraph.enabled, undefined);
	assert.match(after, /"enabled"/);
	assert.match(after, /"\[opencode\]"/);
});

test("#given no OMO SOT and legacy CodeGraph env #when seeding #then creates scaffold with Codex scoped migration", async () => {
	const home = await mkdtemp(join(tmpdir(), "omo-sot-seed-env-"));

	await migrateOmoSotConfig({
		env: {
			HOME: home,
			CODEX_CODEGRAPH_AUTO_PROVISION: "yes",
			CODEX_CODEGRAPH_ENABLED: "1",
			OMO_CODEGRAPH_INSTALL_DIR: "/tmp/codegraph",
			OMO_CODEGRAPH_TELEMETRY: "false",
		},
		seed: true,
	});

	const content = await readFile(join(home, ".omo", "config.jsonc"), "utf8");
	const parsed = parseJsonc(content);
	assert.equal(parsed.codegraph.enabled, undefined);
	assert.deepEqual(parsed["[codex]"].codegraph, {
		auto_provision: true,
		enabled: true,
		install_dir: "/tmp/codegraph",
		telemetry: false,
	});
	assert.match(content, /Shared OMO settings/);
	assert.match(content, /"\[opencode\]"/);
});

test("#given legacy CodeGraph env #when migrating #then adds Codex scoped codegraph values", async () => {
	const home = await mkdtemp(join(tmpdir(), "omo-sot-env-"));
	await mkdir(join(home, ".omo"), { recursive: true });
	await writeFile(join(home, ".omo", "config.jsonc"), "{\n}\n");

	const result = await migrateOmoSotConfig({
		env: {
			HOME: home,
			CODEX_CODEGRAPH_AUTO_PROVISION: "0",
			CODEX_CODEGRAPH_ENABLED: "false",
			OMO_CODEGRAPH_INSTALL_DIR: "/tmp/codegraph",
			OMO_CODEGRAPH_TELEMETRY: "1",
		},
		seed: true,
	});

	const parsed = parseJsonc(await readFile(join(home, ".omo", "config.jsonc"), "utf8"));
	assert.equal(result.changed, true);
	assert.deepEqual(parsed["[codex]"].codegraph, {
		auto_provision: false,
		enabled: false,
		install_dir: "/tmp/codegraph",
		telemetry: true,
	});
});

test("#given existing user SOT #when migrating env #then preserves user values and comments", async () => {
	const home = await mkdtemp(join(tmpdir(), "omo-sot-preserve-"));
	const configPath = join(home, ".omo", "config.jsonc");
	await mkdir(join(home, ".omo"), { recursive: true });
	await writeFile(
		configPath,
		[
			"{",
			"  // keep my debounce",
			'  "codegraph": {',
			"    \"watch_debounce_ms\": 4242",
			"  }",
			"}",
			"",
		].join("\n"),
	);

	await migrateOmoSotConfig({ env: { HOME: home, CODEX_CODEGRAPH_ENABLED: "0" }, seed: true });

	const content = await readFile(configPath, "utf8");
	const parsed = parseJsonc(content);
	assert.match(content, /keep my debounce/);
	assert.equal(parsed.codegraph.watch_debounce_ms, 4242);
	assert.equal(parsed["[codex]"].codegraph.enabled, false);
});

test("#given existing Codex scoped SOT #when migrating env #then user value wins", async () => {
	const home = await mkdtemp(join(tmpdir(), "omo-sot-user-wins-"));
	const configPath = join(home, ".omo", "config.jsonc");
	await mkdir(join(home, ".omo"), { recursive: true });
	await writeFile(configPath, '{\n  "[codex]": { "codegraph": { "enabled": true } }\n}\n');

	await migrateOmoSotConfig({ env: { HOME: home, CODEX_CODEGRAPH_ENABLED: "0" }, seed: true });

	const parsed = parseJsonc(await readFile(configPath, "utf8"));
	assert.equal(parsed["[codex]"].codegraph.enabled, true);
});

test("#given opencode scoped SOT #when migrating env #then opencode block is not changed", async () => {
	const home = await mkdtemp(join(tmpdir(), "omo-sot-opencode-"));
	const configPath = join(home, ".omo", "config.jsonc");
	await mkdir(join(home, ".omo"), { recursive: true });
	await writeFile(configPath, '{\n  "[opencode]": { "codegraph": { "enabled": true } }\n}\n');

	await migrateOmoSotConfig({ env: { HOME: home, CODEX_CODEGRAPH_ENABLED: "0" }, seed: true });

	const parsed = parseJsonc(await readFile(configPath, "utf8"));
	assert.equal(parsed["[opencode]"].codegraph.enabled, true);
	assert.equal(parsed["[codex]"].codegraph.enabled, false);
});

test("#given malformed existing SOT #when migrating #then leaves it untouched and warns", async () => {
	const home = await mkdtemp(join(tmpdir(), "omo-sot-malformed-"));
	const configPath = join(home, ".omo", "config.jsonc");
	await mkdir(join(home, ".omo"), { recursive: true });
	await writeFile(configPath, '{ "codegraph":');

	const result = await migrateOmoSotConfig({ env: { HOME: home, CODEX_CODEGRAPH_ENABLED: "0" }, seed: true });

	assert.equal(await readFile(configPath, "utf8"), '{ "codegraph":');
	assert.equal(result.changed, false);
	assert.equal(result.seeded, false);
	assert.match(result.warnings.join("\n"), /Could not parse/);
});

function parseJsonc(content) {
	return JSON.parse(stripTrailingCommas(stripJsonComments(content)));
}

function stripJsonComments(content) {
	let result = "";
	let inString = false;
	let escape = false;
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		const next = content[index + 1];
		if (inString) {
			result += char;
			if (escape) escape = false;
			else if (char === "\\") escape = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") {
			inString = true;
			result += char;
			continue;
		}
		if (char === "/" && next === "/") {
			while (index < content.length && content[index] !== "\n") index += 1;
			result += "\n";
			continue;
		}
		result += char;
	}
	return result;
}

function stripTrailingCommas(content) {
	return content.replace(/,\s*([}\]])/g, "$1");
}
