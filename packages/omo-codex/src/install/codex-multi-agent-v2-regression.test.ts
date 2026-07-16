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

describe("codex MultiAgentV2 routing defaults", () => {
	test("#given catalog-declared gpt-5.6 v2 install #when updating config #then writes parsed routing defaults idempotently", async () => {
		// given
		const configPath = await createFixture(toml('model = "gpt-5.6-sol"'), {
			"models_cache.json": modelCatalog("gpt-5.6-sol", "v2"),
		});

		// when
		const first = await updateAndRead(configPath);

		// then
		expectV2Routing(first.v2);
		expect(first.v2.max_concurrent_threads_per_session).toBeUndefined();
		expect(readString(first.v2, "multi_agent_mode_hint_text").trim()).not.toBe(
			"",
		);
		expect((await updateAndRead(configPath)).v2).toEqual(first.v2);
	});

	for (const [name, setting] of [
		["metadata visibility", "hide_spawn_agent_metadata = false"],
		["agents namespace", 'tool_namespace = "agents"'],
	] as const) {
		test(`#given v2 config with only ${name} pinned #when updating config #then completes parsed routing defaults`, async () => {
			// given
			const configPath = await createFixture(
				toml(
					'model = "gpt-5.6-sol"',
					"",
					"[features.multi_agent_v2]",
					setting,
					"max_concurrent_threads_per_session = 6",
				),
				{ "models_cache.json": modelCatalog("gpt-5.6-sol", "v2") },
			);

			// when
			const snapshot = await updateAndRead(configPath);

			// then
			expectV2Routing(snapshot.v2);
			expect(snapshot.v2.max_concurrent_threads_per_session).toBe(6);
		});
	}

	test("#given nested gpt-5.6 agent model without a root model #when updating config #then installs only the inert compatibility pair", async () => {
		// given
		const configPath = await createFixture(
			toml(
				'model_reasoning_effort = "high"',
				"",
				"[agents.custom]",
				'model = "gpt-5.6-terra"',
			),
		);

		// when
		const snapshot = await updateAndRead(configPath);

		// then
		expectV2Routing(snapshot.v2);
		expect(snapshot.v2.enabled).toBeUndefined();
		expect(snapshot.v2.max_concurrent_threads_per_session).toBeUndefined();
		expect(snapshot.agents?.max_threads).toBeUndefined();
	});
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

function expectV2Routing(v2: Record<string, unknown>): void {
	expect(v2.tool_namespace).toBe("agents");
	expect(v2.hide_spawn_agent_metadata).toBe(false);
}

function modelCatalog(slug: string, version: CatalogVersion): string {
	return JSON.stringify({ models: [{ slug, multi_agent_version: version }] });
}

function toml(...lines: readonly string[]): string {
	return `${lines.join("\n")}\n`;
}
