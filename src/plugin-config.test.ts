import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { OhMyOpenCodeConfig } from "./config";
import { loadPluginConfig, mergeConfigs } from "./plugin-config";

const ENV_KEYS = [
	"OH_MY_OPENCODE_CONFIG_DIR",
	"OH_MY_OPENCODE_CONFIG",
	"OH_MY_OPENCODE_CONFIG_CONTENT",
];

let envSnapshot: Record<string, string | undefined> = {};

function snapshotEnv(): void {
	envSnapshot = Object.fromEntries(
		ENV_KEYS.map((key) => [key, process.env[key]]),
	);
}

function restoreEnv(): void {
	for (const key of ENV_KEYS) {
		const value = envSnapshot[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

function createTempDir(name: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `omo-${name}-`));
}

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function cleanupDir(dirPath: string): void {
	fs.rmSync(dirPath, { recursive: true, force: true });
}

beforeEach(() => {
	snapshotEnv();
});

afterEach(() => {
	restoreEnv();
});

describe("mergeConfigs", () => {
	describe("categories merging", () => {
		// #given base config has categories, override has different categories
		// #when merging configs
		// #then should deep merge categories, not override completely

		it("should deep merge categories from base and override", () => {
			const base = {
				categories: {
					general: {
						model: "openai/gpt-5.2",
						temperature: 0.5,
					},
					quick: {
						model: "anthropic/claude-haiku-4-5",
					},
				},
			} as OhMyOpenCodeConfig;

			const override = {
				categories: {
					general: {
						temperature: 0.3,
					},
					visual: {
						model: "google/gemini-3-pro-preview",
					},
				},
			} as unknown as OhMyOpenCodeConfig;

			const result = mergeConfigs(base, override);

			// #then general.model should be preserved from base
			expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
			// #then general.temperature should be overridden
			expect(result.categories?.general?.temperature).toBe(0.3);
			// #then quick should be preserved from base
			expect(result.categories?.quick?.model).toBe(
				"anthropic/claude-haiku-4-5",
			);
			// #then visual should be added from override
			expect(result.categories?.visual?.model).toBe(
				"google/gemini-3-pro-preview",
			);
		});

		it("should preserve base categories when override has no categories", () => {
			const base: OhMyOpenCodeConfig = {
				categories: {
					general: {
						model: "openai/gpt-5.2",
					},
				},
			};

			const override: OhMyOpenCodeConfig = {};

			const result = mergeConfigs(base, override);

			expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
		});

		it("should use override categories when base has no categories", () => {
			const base: OhMyOpenCodeConfig = {};

			const override: OhMyOpenCodeConfig = {
				categories: {
					general: {
						model: "openai/gpt-5.2",
					},
				},
			};

			const result = mergeConfigs(base, override);

			expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
		});
	});

	describe("existing behavior preservation", () => {
		it("should deep merge agents", () => {
			const base: OhMyOpenCodeConfig = {
				agents: {
					oracle: { model: "openai/gpt-5.2" },
				},
			};

			const override: OhMyOpenCodeConfig = {
				agents: {
					oracle: { temperature: 0.5 },
					explore: { model: "anthropic/claude-haiku-4-5" },
				},
			};

			const result = mergeConfigs(base, override);

			expect(result.agents?.oracle?.model).toBe("openai/gpt-5.2");
			expect(result.agents?.oracle?.temperature).toBe(0.5);
			expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5");
		});

		it("should merge disabled arrays without duplicates", () => {
			const base: OhMyOpenCodeConfig = {
				disabled_hooks: ["comment-checker", "think-mode"],
			};

			const override: OhMyOpenCodeConfig = {
				disabled_hooks: ["think-mode", "session-recovery"],
			};

			const result = mergeConfigs(base, override);

			expect(result.disabled_hooks).toContain("comment-checker");
			expect(result.disabled_hooks).toContain("think-mode");
			expect(result.disabled_hooks).toContain("session-recovery");
			expect(result.disabled_hooks?.length).toBe(3);
		});
	});
});

describe("loadPluginConfig precedence", () => {
	// #given multiple config sources
	// #when loading plugin config
	// #then apply precedence user < env path < project < inline

	it("prefers jsonc over json for user config", () => {
		const tempDir = createTempDir("jsonc");
		const projectRoot = path.join(tempDir, "project");

		fs.mkdirSync(projectRoot, { recursive: true });
		writeJson(path.join(projectRoot, "package.json"), { name: "test" });

		process.env.OH_MY_OPENCODE_CONFIG_DIR = tempDir;

		const jsonPath = path.join(tempDir, "oh-my-opencode.json");
		const jsoncPath = path.join(tempDir, "oh-my-opencode.jsonc");

		writeJson(jsonPath, { auto_update: false });
		writeJson(jsoncPath, { auto_update: true });

		const config = loadPluginConfig(projectRoot, {});

		expect(config.auto_update).toBe(true);

		cleanupDir(tempDir);
	});

	it("applies precedence user < env path < project", () => {
		const tempDir = createTempDir("precedence");
		const projectRoot = path.join(tempDir, "project");
		const projectConfigPath = path.join(
			projectRoot,
			".opencode",
			"oh-my-opencode.json",
		);

		fs.mkdirSync(projectRoot, { recursive: true });
		writeJson(path.join(projectRoot, "package.json"), { name: "test" });

		process.env.OH_MY_OPENCODE_CONFIG_DIR = tempDir;

		writeJson(path.join(tempDir, "oh-my-opencode.json"), {
			auto_update: false,
		});

		const envConfigPath = path.join(tempDir, "env.json");
		writeJson(envConfigPath, { auto_update: true });
		process.env.OH_MY_OPENCODE_CONFIG = envConfigPath;

		writeJson(projectConfigPath, { auto_update: false });

		const config = loadPluginConfig(projectRoot, {});

		expect(config.auto_update).toBe(false);

		cleanupDir(tempDir);
	});

	it("applies inline content with highest precedence", () => {
		const tempDir = createTempDir("inline");
		const projectRoot = path.join(tempDir, "project");
		const projectConfigPath = path.join(
			projectRoot,
			".opencode",
			"oh-my-opencode.json",
		);

		fs.mkdirSync(projectRoot, { recursive: true });
		writeJson(path.join(projectRoot, "package.json"), { name: "test" });

		process.env.OH_MY_OPENCODE_CONFIG_DIR = tempDir;

		writeJson(path.join(tempDir, "oh-my-opencode.json"), {
			auto_update: false,
		});

		writeJson(projectConfigPath, { auto_update: false });

		process.env.OH_MY_OPENCODE_CONFIG_CONTENT = JSON.stringify({
			auto_update: true,
		});

		const config = loadPluginConfig(projectRoot, {});

		expect(config.auto_update).toBe(true);

		cleanupDir(tempDir);
	});

	it("merges project configs from root to leaf", () => {
		const tempDir = createTempDir("search-up");
		const projectRoot = path.join(tempDir, "project");
		const nestedDir = path.join(projectRoot, "apps", "demo");

		fs.mkdirSync(nestedDir, { recursive: true });
		writeJson(path.join(projectRoot, "package.json"), { name: "test" });

		writeJson(path.join(projectRoot, ".opencode", "oh-my-opencode.json"), {
			auto_update: false,
			disabled_hooks: ["think-mode"],
		});

		writeJson(path.join(nestedDir, ".opencode", "oh-my-opencode.json"), {
			auto_update: true,
			disabled_hooks: ["comment-checker"],
		});

		const config = loadPluginConfig(nestedDir, {});

		expect(config.auto_update).toBe(true);
		expect(config.disabled_hooks).toContain("think-mode");
		expect(config.disabled_hooks).toContain("comment-checker");

		cleanupDir(tempDir);
	});
});
