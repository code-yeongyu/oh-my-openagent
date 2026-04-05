import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as shared from "./shared"
import { loadPluginConfig, mergeConfigs, parseConfigPartially } from "./plugin-config";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./config";

const tempDirs: string[] = []

function createConfig(config: Partial<OhMyOpenCodeConfig>): OhMyOpenCodeConfig {
  return OhMyOpenCodeConfigSchema.parse(config)
}

afterEach(() => {
  mock.restore()

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("mergeConfigs", () => {
  describe("categories merging", () => {
    // given base config has categories, override has different categories
    // when merging configs
    // then should deep merge categories, not override completely

    it("should deep merge categories from base and override", () => {
      const base = createConfig({
        categories: {
          general: {
            model: "openai/gpt-5.4",
            temperature: 0.5,
          },
          quick: {
            model: "anthropic/claude-haiku-4-5",
          },
        },
      });

      const override = createConfig({
        categories: {
          general: {
            temperature: 0.3,
          },
          visual: {
            model: "google/gemini-3.1-pro",
          },
        },
      });

      const result = mergeConfigs(base, override);

      // then general.model should be preserved from base
      expect(result.categories?.general?.model).toBe("openai/gpt-5.4");
      // then general.temperature should be overridden
      expect(result.categories?.general?.temperature).toBe(0.3);
      // then quick should be preserved from base
      expect(result.categories?.quick?.model).toBe("anthropic/claude-haiku-4-5");
      // then visual should be added from override
      expect(result.categories?.visual?.model).toBe("google/gemini-3.1-pro");
    });

    it("should preserve base categories when override has no categories", () => {
      const base = createConfig({
        categories: {
          general: {
            model: "openai/gpt-5.4",
          },
        },
      });

      const override = createConfig({});

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.4");
    });

    it("should use override categories when base has no categories", () => {
      const base = createConfig({});

      const override = createConfig({
        categories: {
          general: {
            model: "openai/gpt-5.4",
          },
        },
      });

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.4");
    });
  });

  describe("existing behavior preservation", () => {
    it("should deep merge agents", () => {
      const base = createConfig({
        agents: {
          oracle: { model: "openai/gpt-5.4" },
        },
      });

      const override = createConfig({
        agents: {
          oracle: { temperature: 0.5 },
          explore: { model: "anthropic/claude-haiku-4-5" },
        },
      });

      const result = mergeConfigs(base, override);

      expect(result.agents?.oracle).toMatchObject({ model: "openai/gpt-5.4" });
      expect(result.agents?.oracle?.temperature).toBe(0.5);
      expect(result.agents?.explore).toMatchObject({ model: "anthropic/claude-haiku-4-5" });
    });

    it("should merge disabled arrays without duplicates", () => {
      const base = createConfig({
        disabled_hooks: ["comment-checker", "think-mode"],
      });

      const override = createConfig({
        disabled_hooks: ["think-mode", "session-recovery"],
      });

      const result = mergeConfigs(base, override);

      expect(result.disabled_hooks).toContain("comment-checker");
      expect(result.disabled_hooks).toContain("think-mode");
      expect(result.disabled_hooks).toContain("session-recovery");
      expect(result.disabled_hooks?.length).toBe(3);
    });

    it("should union disabled_tools from base and override without duplicates", () => {
      const base = createConfig({
        disabled_tools: ["todowrite", "interactive_bash"],
      });

      const override = createConfig({
        disabled_tools: ["interactive_bash", "look_at"],
      });

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
    //#then should return an empty object (fast path - full parse succeeds)

    it("should return empty object for empty input", () => {
      const result = parseConfigPartially({});

      expect(result).not.toBeNull();
      expect(result).toEqual({
        git_master: {
          commit_footer: true,
          include_co_authored_by: true,
          git_env_prefix: "GIT_MASTER=1",
        },
      });
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
      expect((result as Record<string, unknown>)["some_future_key"]).toBeUndefined();
    });
  });
});

describe("loadPluginConfig", () => {
  it("should only honor mcp_env_allowlist from user config", () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-"))
    const userConfigDir = join(rootDir, "user-config")
    const projectDir = join(rootDir, "project")
    const projectConfigDir = join(projectDir, ".opencode")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })

    writeFileSync(
      join(userConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({ mcp_env_allowlist: ["USER_ONLY_TOKEN"] })
    )
    writeFileSync(
      join(projectConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({ mcp_env_allowlist: ["PROJECT_TOKEN"] })
    )

    spyOn(shared, "getOpenCodeConfigDir").mockReturnValue(userConfigDir)

    // when
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(config.mcp_env_allowlist).toEqual(["USER_ONLY_TOKEN"])
  })

  it("should ignore edits to the renamed legacy backup after migration", () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-legacy-"))
    const userConfigDir = join(rootDir, "user-config")
    const projectDir = join(rootDir, "project")
    const projectConfigDir = join(projectDir, ".opencode")
    const legacyConfigPath = join(projectConfigDir, "oh-my-opencode.jsonc")
    const backupConfigPath = `${legacyConfigPath}.bak`
    const canonicalConfigPath = join(projectConfigDir, "oh-my-openagent.jsonc")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(legacyConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5.4" } } }))

    spyOn(shared, "getOpenCodeConfigDir").mockReturnValue(userConfigDir)

    // when
    loadPluginConfig(projectDir, {})
    writeFileSync(backupConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5-nano" } } }))
    const reloadedConfig = loadPluginConfig(projectDir, {})

    // then
    expect(existsSync(legacyConfigPath)).toBe(false)
    expect(existsSync(backupConfigPath)).toBe(true)
    expect(readFileSync(canonicalConfigPath, "utf-8")).toContain('"openai/gpt-5.4"')
    expect(reloadedConfig.agents?.oracle?.model).toBe("openai/gpt-5.4")
  })

  it("should still load config from legacy path when migration fails", () => {
    // given - legacy config exists but canonical path is not writable
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-fail-"))
    const userConfigDir = join(rootDir, "user-config")
    const projectDir = join(rootDir, "project")
    const projectConfigDir = join(projectDir, ".opencode")
    const legacyConfigPath = join(projectConfigDir, "oh-my-opencode.json")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(legacyConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5.4" } } }))

    // Make the directory read-only so migration write fails
    // (simulates Windows file lock / permission issues)
    if (process.platform !== "win32") {
      chmodSync(projectConfigDir, 0o555)
    }

    spyOn(shared, "getOpenCodeConfigDir").mockReturnValue(userConfigDir)

    // when
    let config: OhMyOpenCodeConfig
    try {
      config = loadPluginConfig(projectDir, {})
    } finally {
      // Restore permissions for cleanup
      if (process.platform !== "win32") {
        chmodSync(projectConfigDir, 0o755)
      }
    }

    // then - should still load the config from legacy path
    expect(config.agents?.oracle?.model).toBe("openai/gpt-5.4")
  })

  it("should load migrated legacy project config on the first load", () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-first-load-"))
    const userConfigDir = join(rootDir, "user-config")
    const projectDir = join(rootDir, "project")
    const projectConfigDir = join(projectDir, ".opencode")
    const legacyConfigPath = join(projectConfigDir, "oh-my-opencode.jsonc")
    const canonicalConfigPath = join(projectConfigDir, "oh-my-openagent.jsonc")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(legacyConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5.4" } } }))

    spyOn(shared, "getOpenCodeConfigDir").mockReturnValue(userConfigDir)

    // when
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(existsSync(legacyConfigPath)).toBe(false)
    expect(existsSync(canonicalConfigPath)).toBe(true)
    expect(config.agents?.oracle?.model).toBe("openai/gpt-5.4")
  })
})
