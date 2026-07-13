import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

type CatalogVersion = "v1" | "v2";
type FixtureFiles = Readonly<Record<string, string>>;

interface ConfigSnapshot {
	readonly v2: Record<string, unknown>;
	readonly agents: Record<string, unknown> | null;
}

describe("codex MultiAgentV2 hint preservation", () => {
	for (const [name, assignment] of [
		[
			"double-quoted custom",
			'multi_agent_mode_hint_text = "CUSTOM HINT: preserve this value."',
		],
		["empty", 'multi_agent_mode_hint_text = ""'],
		[
			"literal",
			"multi_agent_mode_hint_text = 'literal custom hint # keep value'",
		],
		["multiline", 'multi_agent_mode_hint_text = """line one\nline two"""'],
	] as const) {
		test(`#given existing ${name} mode hint #when updating v2 config #then preserves its parsed value`, async () => {
			// given
			const initial = toml(
				'model = "gpt-5.6-sol"',
				"",
				"[features.multi_agent_v2]",
				assignment,
			);
			const expectedHint = readString(
				parseConfig(initial).v2,
				"multi_agent_mode_hint_text",
			);
			const configPath = await createFixture(initial, {
				"models_cache.json": modelCatalog("gpt-5.6-sol", "v2"),
			});

			// when
			const snapshot = await updateAndRead(configPath);

			// then
			expect(readString(snapshot.v2, "multi_agent_mode_hint_text")).toBe(
				expectedHint,
			);
		});
	}
});

async function createFixture(
	config: string,
	files: FixtureFiles = {},
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-regression-"));
	const configPath = join(root, "config.toml");
	await Promise.all([
		writeFile(configPath, config),
		...Object.entries(files).map(([name, content]) =>
			writeFile(join(root, name), content),
		),
	]);
	return configPath;
}

async function updateAndRead(configPath: string): Promise<ConfigSnapshot> {
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
	return parseConfig(await readFile(configPath, "utf8"));
}

function parseConfig(config: string): ConfigSnapshot {
	const parsed: unknown = Bun.TOML.parse(config);
	const root = requireTable(parsed, "config");
	const features = requireTable(root.features, "features");
	return {
		v2: requireTable(features.multi_agent_v2, "features.multi_agent_v2"),
		agents:
			root.agents === undefined ? null : requireTable(root.agents, "agents"),
	};
}

function requireTable(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new TypeError(`${label} must be a TOML table`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(table: Record<string, unknown>, key: string): string {
	const value = table[key];
	if (typeof value !== "string")
		throw new TypeError(`${key} must be a TOML string`);
	return value;
}

function modelCatalog(slug: string, version: CatalogVersion): string {
	return JSON.stringify({ models: [{ slug, multi_agent_version: version }] });
}

function toml(...lines: readonly string[]): string {
	return `${lines.join("\n")}\n`;
}
