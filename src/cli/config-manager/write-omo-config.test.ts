import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseJsonc } from "../../shared/jsonc-parser";
import type { InstallConfig } from "../types";
import { resetConfigContext } from "./config-context";
import { generateOmoConfig } from "./generate-omo-config";
import { writeOmoConfig } from "./write-omo-config";

const installConfig: InstallConfig = {
	hasClaude: true,
	isMax20: true,
	hasOpenAI: true,
	hasGemini: true,
	hasCopilot: false,
	hasOpencodeZen: false,
	hasZaiCodingPlan: false,
	hasKimiForCoding: false,
};

function getRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}

	return {};
}

describe("writeOmoConfig", () => {
	let testConfigDir = "";
	let legacyConfigPath = "";
	let canonicalConfigPath = "";

	beforeEach(() => {
		testConfigDir = join(
			tmpdir(),
			`omo-write-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		legacyConfigPath = join(testConfigDir, "oh-my-opencode.json");
		canonicalConfigPath = join(testConfigDir, "oh-my-openagent.jsonc");

		mkdirSync(testConfigDir, { recursive: true });
		process.env.OPENCODE_CONFIG_DIR = testConfigDir;
		resetConfigContext();
	});

	afterEach(() => {
		rmSync(testConfigDir, { recursive: true, force: true });
		resetConfigContext();
		delete process.env.OPENCODE_CONFIG_DIR;
	});

	it("writes the canonical jsonc path for new installs", () => {
		// when
		const result = writeOmoConfig(installConfig);

		// then
		expect(result.success).toBe(true);
		expect(result.configPath).toBe(canonicalConfigPath);
		expect(existsSync(canonicalConfigPath)).toBe(true);
	});

	it("preserves legacy user values while writing merged config to the canonical path", () => {
		// given
		const existingConfig = {
			agents: {
				sisyphus: {
					model: "custom/provider-model",
				},
			},
			disabled_hooks: ["comment-checker"],
		};
		writeFileSync(
			legacyConfigPath,
			JSON.stringify(existingConfig, null, 2) + "\n",
			"utf-8",
		);

		const generatedDefaults = generateOmoConfig(installConfig);

		// when
		const result = writeOmoConfig(installConfig);

		// then
		expect(result.success).toBe(true);
		expect(result.configPath).toBe(canonicalConfigPath);

		const savedConfig = parseJsonc<Record<string, unknown>>(
			readFileSync(canonicalConfigPath, "utf-8"),
		);
		const savedAgents = getRecord(savedConfig.agents);
		const savedSisyphus = getRecord(savedAgents.sisyphus);
		expect(savedSisyphus.model).toBe("custom/provider-model");
		expect(savedConfig.disabled_hooks).toEqual(["comment-checker"]);

		for (const defaultKey of Object.keys(generatedDefaults)) {
			expect(savedConfig).toHaveProperty(defaultKey);
		}
	});

	it("prefers canonical config as the merge source when canonical and legacy configs coexist", () => {
		// given
		writeFileSync(
			legacyConfigPath,
			JSON.stringify(
				{ agents: { sisyphus: { model: "legacy/provider-model" } } },
				null,
				2,
			) + "\n",
			"utf-8",
		);
		writeFileSync(
			canonicalConfigPath,
			JSON.stringify(
				{ agents: { sisyphus: { model: "canonical/provider-model" } } },
				null,
				2,
			) + "\n",
			"utf-8",
		);

		// when
		const result = writeOmoConfig(installConfig);

		// then
		expect(result.success).toBe(true);
		const savedConfig = parseJsonc<Record<string, unknown>>(
			readFileSync(canonicalConfigPath, "utf-8"),
		);
		const savedAgents = getRecord(savedConfig.agents);
		const savedSisyphus = getRecord(savedAgents.sisyphus);
		expect(savedSisyphus.model).toBe("canonical/provider-model");
	});

	it("updates an existing canonical json file in place instead of creating a second canonical file", () => {
		const canonicalJsonPath = join(testConfigDir, "oh-my-openagent.json");
		writeFileSync(
			canonicalJsonPath,
			JSON.stringify(
				{ agents: { sisyphus: { model: "canonical-json/provider-model" } } },
				null,
				2,
			) + "\n",
			"utf-8",
		);

		const result = writeOmoConfig(installConfig);

		expect(result.success).toBe(true);
		expect(result.configPath).toBe(canonicalJsonPath);
		expect(existsSync(canonicalConfigPath)).toBe(false);

		const savedConfig = parseJsonc<Record<string, unknown>>(
			readFileSync(canonicalJsonPath, "utf-8"),
		);
		const savedAgents = getRecord(savedConfig.agents);
		const savedSisyphus = getRecord(savedAgents.sisyphus);
		expect(savedSisyphus.model).toBe("canonical-json/provider-model");
	});

	it("falls back to legacy config when canonical config is malformed", () => {
		writeFileSync(canonicalConfigPath, "{ invalid jsonc", "utf-8");
		writeFileSync(
			legacyConfigPath,
			JSON.stringify(
				{ agents: { sisyphus: { model: "legacy-fallback/provider-model" } } },
				null,
				2,
			) + "\n",
			"utf-8",
		);

		const result = writeOmoConfig(installConfig);

		expect(result.success).toBe(true);
		const savedConfig = parseJsonc<Record<string, unknown>>(
			readFileSync(canonicalConfigPath, "utf-8"),
		);
		const savedAgents = getRecord(savedConfig.agents);
		const savedSisyphus = getRecord(savedAgents.sisyphus);
		expect(savedSisyphus.model).toBe("legacy-fallback/provider-model");
	});
});
