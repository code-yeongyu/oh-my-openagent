import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OhMyOpenCodeConfig, OhMyOpenCodeConfigSchema } from "./config";
import {
	loadPluginConfig,
	mergeConfigs,
	parseConfigPartially,
} from "./plugin-config";

describe("mergeConfigs", () => {
	describe("categories merging", () => {
		// given base config has categories, override has different categories
		// when merging configs
		// then should deep merge categories, not override completely

		it("should deep merge categories from base and override", () => {
			const base = {
				categories: {
					general: {
						model: "openai/gpt-5.4",
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
						model: "google/gemini-3.1-pro",
					},
				},
			} as unknown as OhMyOpenCodeConfig;

			const result = mergeConfigs(base, override);

			// then general.model should be preserved from base
			expect(result.categories?.general?.model).toBe("openai/gpt-5.4");
			// then general.temperature should be overridden
			expect(result.categories?.general?.temperature).toBe(0.3);
			// then quick should be preserved from base
			expect(result.categories?.quick?.model).toBe(
				"anthropic/claude-haiku-4-5",
			);
			// then visual should be added from override
			expect(result.categories?.visual?.model).toBe("google/gemini-3.1-pro");
		});

		it("should preserve base categories when override has no categories", () => {
			const base: OhMyOpenCodeConfig = {
				categories: {
					general: {
						model: "openai/gpt-5.4",
					},
				},
			};

			const override: OhMyOpenCodeConfig = {};

			const result = mergeConfigs(base, override);

			expect(result.categories?.general?.model).toBe("openai/gpt-5.4");
		});

		it("should use override categories when base has no categories", () => {
			const base: OhMyOpenCodeConfig = {};

			const override: OhMyOpenCodeConfig = {
				categories: {
					general: {
						model: "openai/gpt-5.4",
					},
				},
			};

			const result = mergeConfigs(base, override);

			expect(result.categories?.general?.model).toBe("openai/gpt-5.4");
		});
	});

	describe("existing behavior preservation", () => {
		it("should deep merge agents", () => {
			const base: OhMyOpenCodeConfig = {
				agents: {
					oracle: { model: "openai/gpt-5.4" },
				},
			};

			const override: OhMyOpenCodeConfig = {
				agents: {
					oracle: { temperature: 0.5 },
					explore: { model: "anthropic/claude-haiku-4-5" },
				},
			};

			const result = mergeConfigs(base, override);

			expect(result.agents?.oracle).toMatchObject({ model: "openai/gpt-5.4" });
			expect(result.agents?.oracle?.temperature).toBe(0.5);
			expect(result.agents?.explore).toMatchObject({
				model: "anthropic/claude-haiku-4-5",
			});
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

		it("should union disabled_tools from base and override without duplicates", () => {
			const base: OhMyOpenCodeConfig = {
				disabled_tools: ["todowrite", "interactive_bash"],
			};

			const override: OhMyOpenCodeConfig = {
				disabled_tools: ["interactive_bash", "look_at"],
			};

			const result = mergeConfigs(base, override);

			expect(result.disabled_tools).toContain("todowrite");
			expect(result.disabled_tools).toContain("interactive_bash");
			expect(result.disabled_tools).toContain("look_at");
			expect(result.disabled_tools?.length).toBe(3);
		});
	});
});

describe("parseConfigPartially", () => {
	describe("disabled_hooks compatibility", () => {
		//#given a config with a future hook name unknown to this version
		//#when validating against the full config schema
		//#then should accept the hook name so runtime and schema stay aligned

		it("should accept unknown disabled_hooks values for forward compatibility", () => {
			const result = OhMyOpenCodeConfigSchema.safeParse({
				disabled_hooks: ["future-hook-name"],
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.disabled_hooks).toEqual(["future-hook-name"]);
			}
		});
	});

	describe("fully valid config", () => {
		//#given a config where all sections are valid
		//#when parsing the config
		//#then should return the full parsed config unchanged

		it("should return the full config when everything is valid", () => {
			const rawConfig = {
				agents: {
					oracle: { model: "openai/gpt-5.4" },
					momus: { model: "openai/gpt-5.4" },
				},
				disabled_hooks: ["comment-checker"],
			};

			const result = parseConfigPartially(rawConfig);

			expect(result).not.toBeNull();
			expect(result!.agents?.oracle).toMatchObject({ model: "openai/gpt-5.4" });
			expect(result!.agents?.momus).toMatchObject({ model: "openai/gpt-5.4" });
			expect(result!.disabled_hooks).toEqual(["comment-checker"]);
		});
	});

	describe("partially invalid config", () => {
		//#given a config where one section is invalid but others are valid
		//#when parsing the config
		//#then should return valid sections and skip invalid ones

		it("should preserve valid agent overrides when another section is invalid", () => {
			const rawConfig = {
				agents: {
					oracle: { model: "openai/gpt-5.4" },
					momus: { model: "openai/gpt-5.4" },
					prometheus: {
						permission: {
							edit: { "*": "ask", ".sisyphus/**": "allow" },
						},
					},
				},
				disabled_hooks: ["comment-checker"],
			};

			const result = parseConfigPartially(rawConfig);

			expect(result).not.toBeNull();
			expect(result!.disabled_hooks).toEqual(["comment-checker"]);
			expect(result!.agents).toBeUndefined();
		});

		it("should preserve valid agents when a non-agent section is invalid", () => {
			const rawConfig = {
				agents: {
					oracle: { model: "openai/gpt-5.4" },
				},
				disabled_hooks: ["not-a-real-hook"],
			};

			const result = parseConfigPartially(rawConfig);

			expect(result).not.toBeNull();
			expect(result!.agents?.oracle).toMatchObject({ model: "openai/gpt-5.4" });
			expect(result!.disabled_hooks).toEqual(["not-a-real-hook"]);
		});
	});

	describe("completely invalid config", () => {
		//#given a config where all sections are invalid
		//#when parsing the config
		//#then should return an empty object (not null)

		it("should return empty object when all sections are invalid", () => {
			const rawConfig = {
				agents: { oracle: { temperature: "not-a-number" } },
				disabled_hooks: ["not-a-real-hook"],
			};

			const result = parseConfigPartially(rawConfig);

			expect(result).not.toBeNull();
			expect(result!.agents).toBeUndefined();
			expect(result!.disabled_hooks).toEqual(["not-a-real-hook"]);
		});
	});

	describe("empty config", () => {
		//#given an empty config object
		//#when parsing the config
		//#then should return schema defaults applied by zod

		it("should return schema defaults for empty input", () => {
			const result = parseConfigPartially({});

			expect(result).not.toBeNull();
			expect(result!.git_master).toBeDefined();
			expect(result!.git_master?.commit_footer).toBe(true);
			expect(result!.git_master?.include_co_authored_by).toBe(true);
			expect(result!.git_master?.git_env_prefix).toBe("GIT_MASTER=1");
		});
	});

	describe("unknown keys", () => {
		//#given a config with keys not in the schema
		//#when parsing the config
		//#then should silently ignore unknown keys and preserve valid ones

		it("should ignore unknown keys and return valid sections", () => {
			const rawConfig = {
				agents: {
					oracle: { model: "openai/gpt-5.4" },
				},
				some_future_key: { foo: "bar" },
			};

			const result = parseConfigPartially(rawConfig);

			expect(result).not.toBeNull();
			expect(result!.agents?.oracle).toMatchObject({ model: "openai/gpt-5.4" });
			expect(
				(result as Record<string, unknown>)["some_future_key"],
			).toBeUndefined();
		});
	});
});

describe("loadPluginConfig", () => {
	let userConfigDir = "";
	let projectDir = "";

	beforeEach(() => {
		userConfigDir = join(
			tmpdir(),
			`omo-plugin-config-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		projectDir = join(
			tmpdir(),
			`omo-plugin-config-project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);

		mkdirSync(userConfigDir, { recursive: true });
		mkdirSync(join(projectDir, ".opencode"), { recursive: true });
		process.env.OPENCODE_CONFIG_DIR = userConfigDir;
	});

	afterEach(() => {
		rmSync(userConfigDir, { recursive: true, force: true });
		rmSync(projectDir, { recursive: true, force: true });
		delete process.env.OPENCODE_CONFIG_DIR;
	});

	it("loads legacy-only user config for compatibility and copies canonical jsonc", () => {
		writeFileSync(
			join(userConfigDir, "oh-my-opencode.jsonc"),
			JSON.stringify({ disabled_hooks: ["legacy-user-hook"] }, null, 2) + "\n",
			"utf-8",
		);

		const result = loadPluginConfig(projectDir, {});

		expect(result.disabled_hooks).toEqual(["legacy-user-hook"]);
		expect(existsSync(join(userConfigDir, "oh-my-openagent.jsonc"))).toBe(true);
	});

	it("merges user canonical config with project canonical override", () => {
		writeFileSync(
			join(userConfigDir, "oh-my-openagent.jsonc"),
			JSON.stringify(
				{ agents: { oracle: { model: "openai/gpt-5.4" } } },
				null,
				2,
			) + "\n",
			"utf-8",
		);
		writeFileSync(
			join(projectDir, ".opencode", "oh-my-openagent.jsonc"),
			JSON.stringify(
				{ agents: { oracle: { model: "anthropic/claude-opus-4-6" } } },
				null,
				2,
			) + "\n",
			"utf-8",
		);

		const result = loadPluginConfig(projectDir, {});

		expect(result.agents?.oracle?.model).toBe("anthropic/claude-opus-4-6");
	});

	it("prefers project canonical config over project legacy config when both exist", () => {
		writeFileSync(
			join(projectDir, ".opencode", "oh-my-opencode.jsonc"),
			JSON.stringify({ disabled_hooks: ["legacy-project-hook"] }, null, 2) +
				"\n",
			"utf-8",
		);
		writeFileSync(
			join(projectDir, ".opencode", "oh-my-openagent.jsonc"),
			JSON.stringify({ disabled_hooks: ["canonical-project-hook"] }, null, 2) +
				"\n",
			"utf-8",
		);

		const result = loadPluginConfig(projectDir, {});

		expect(result.disabled_hooks).toEqual(["canonical-project-hook"]);
	});

	it("loads legacy-only project config and copies canonical jsonc", () => {
		writeFileSync(
			join(projectDir, ".opencode", "oh-my-opencode.jsonc"),
			JSON.stringify({ disabled_hooks: ["legacy-project-hook"] }, null, 2) +
				"\n",
			"utf-8",
		);

		const result = loadPluginConfig(projectDir, {});

		expect(result.disabled_hooks).toEqual(["legacy-project-hook"]);
		expect(
			existsSync(join(projectDir, ".opencode", "oh-my-openagent.jsonc")),
		).toBe(true);
	});

	it("falls back to legacy config when canonical config is malformed", () => {
		writeFileSync(
			join(userConfigDir, "oh-my-openagent.jsonc"),
			"{ invalid jsonc",
			"utf-8",
		);
		writeFileSync(
			join(userConfigDir, "oh-my-opencode.jsonc"),
			JSON.stringify({ disabled_hooks: ["legacy-fallback-hook"] }, null, 2) +
				"\n",
			"utf-8",
		);

		const result = loadPluginConfig(projectDir, {});

		expect(result.disabled_hooks).toEqual(["legacy-fallback-hook"]);
	});
});
