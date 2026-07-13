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

interface RoutingAbsentScenario {
	readonly name: string;
	readonly config: string;
	readonly files?: FixtureFiles;
}

interface DisableScenario {
	readonly name: string;
	readonly config: string;
	readonly files?: FixtureFiles;
	readonly maxDepth?: number;
}

const ROUTING_ABSENT_SCENARIOS: readonly RoutingAbsentScenario[] = [
	{
		name: "catalog-declared v1 model",
		config: toml(
			'model = "gpt-5.6-sol"',
			'model_catalog_json = "custom-catalog.json"',
		),
		files: { "custom-catalog.json": modelCatalog("gpt-5.6-sol", "v1") },
	},
	{
		name: "unknown non-gpt-5.6 model",
		config: toml('model = "custom-model"'),
	},
	{
		name: "nested replacement catalog with a root v1 model",
		config: toml(
			'model = "custom-model"',
			"",
			"[agents.custom]",
			"model_catalog_json = 'nested-catalog.json'",
		),
		files: {
			"models_cache.json": modelCatalog("custom-model", "v1"),
			"nested-catalog.json": modelCatalog("custom-model", "v2"),
		},
	},
	{
		name: "single-quoted relative v1 catalog",
		config: toml(
			'model = "gpt-5.6-sol"',
			"model_catalog_json = 'custom-catalog.json'",
		),
		files: { "custom-catalog.json": modelCatalog("gpt-5.6-sol", "v1") },
	},
];

const DISABLE_SCENARIOS: readonly DisableScenario[] = [
	{
		name: "catalog-declared gpt-5.6 v2 model",
		config: toml(
			'model = "gpt-5.6-sol"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 6",
			"",
			"[agents]",
			"max_threads = 16",
			"max_depth = 4",
		),
		files: { "models_cache.json": modelCatalog("gpt-5.6-sol", "v2") },
		maxDepth: 4,
	},
	{
		name: "root gpt-5.6 model without a catalog",
		config: toml(
			'model = "gpt-5.6-terra"',
			"",
			"[features.multi_agent_v2]",
			"enabled = false",
			"max_concurrent_threads_per_session = 6",
			"",
			"[agents]",
			"max_threads = 16",
		),
	},
];

describe("codex MultiAgentV2 model routing", () => {
	for (const scenario of ROUTING_ABSENT_SCENARIOS) {
		test(`#given ${scenario.name} #when updating config #then leaves V2 routing choices absent`, async () => {
			// given
			const configPath = await createFixture(scenario.config, scenario.files);

			// when
			const snapshot = await updateAndRead(configPath);

			// then
			expectV2RoutingAbsent(snapshot.v2);
			expect(snapshot.v2.max_concurrent_threads_per_session).toBeUndefined();
			expect(snapshot.agents?.max_threads).toBeUndefined();
		});
	}

	for (const scenario of DISABLE_SCENARIOS) {
		test(`#given ${scenario.name} and an existing disable #when updating config #then clears the disable while preserving concurrency`, async () => {
			// given
			const configPath = await createFixture(scenario.config, scenario.files);

			// when
			const snapshot = await updateAndRead(configPath);

			// then
			expectV2Routing(snapshot.v2);
			expect(snapshot.v2.enabled).toBeUndefined();
			expect(snapshot.v2.max_concurrent_threads_per_session).toBe(6);
			expect(snapshot.agents?.max_threads).toBe(16);
			expect(snapshot.agents?.max_depth).toBe(scenario.maxDepth);
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

function expectV2Routing(v2: Record<string, unknown>): void {
	expect(v2.tool_namespace).toBe("agents");
	expect(v2.hide_spawn_agent_metadata).toBe(false);
}

function expectV2RoutingAbsent(v2: Record<string, unknown>): void {
	expect(v2.tool_namespace).toBeUndefined();
	expect(v2.hide_spawn_agent_metadata).toBeUndefined();
	expect(v2.multi_agent_mode_hint_text).toBeUndefined();
}

function modelCatalog(slug: string, version: CatalogVersion): string {
	return JSON.stringify({ models: [{ slug, multi_agent_version: version }] });
}

function toml(...lines: readonly string[]): string {
	return `${lines.join("\n")}\n`;
}
