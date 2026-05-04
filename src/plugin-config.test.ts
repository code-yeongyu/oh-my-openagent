import { afterEach, describe, expect, it, mock } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mergeConfigs, parseConfigPartially } from "./plugin-config";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig, type TeamModeConfig } from "./config";

const tempDirs: string[] = []
type ConfigInput = Omit<Partial<OhMyOpenCodeConfig>, "team_mode"> & {
  team_mode?: Partial<TeamModeConfig>
}

function createConfig(config: ConfigInput): OhMyOpenCodeConfig {
  return OhMyOpenCodeConfigSchema.parse(config)
}

async function importFreshPluginConfigModule(): Promise<typeof import("./plugin-config")> {
  return import(`./plugin-config?test=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  mock.restore()
  delete process.env.OPENCODE_CONFIG_DIR

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createLoadPluginConfigTestContext(prefix: string): {
  rootDir: string
  userConfigDir: string
  projectDir: string
  projectConfigDir: string
} {
  const rootDir = mkdtempSync(join(tmpdir(), prefix))
  const userConfigDir = join(rootDir, "user-config")
  const projectDir = join(rootDir, "project")
  const projectConfigDir = join(projectDir, ".opencode")

  tempDirs.push(rootDir)
  mkdirSync(userConfigDir, { recursive: true })
  mkdirSync(projectConfigDir, { recursive: true })

  return { rootDir, userConfigDir, projectDir, projectConfigDir }
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(value))
}

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
          oracle: { model: "openai/gpt-5.5" },
        },
      });

      const override = createConfig({
        agents: {
          oracle: { temperature: 0.5 },
          explore: { model: "anthropic/claude-haiku-4-5" },
        },
      });

      const result = mergeConfigs(base, override);

      expect(result.agents?.oracle).toMatchObject({ model: "openai/gpt-5.5" });
      expect(result.agents?.oracle?.temperature).toBe(0.5);
      expect(result.agents?.explore).toMatchObject({ model: "anthropic/claude-haiku-4-5" });
    });

    it("should deep merge team_mode", () => {
      const base = createConfig({
        team_mode: {
          enabled: false,
          tmux_visualization: false,
          max_parallel_members: 2,
        },
      });

      const override = {
        team_mode: {
          enabled: true,
        },
      } as OhMyOpenCodeConfig;

      const result = mergeConfigs(base, override);

      expect(result.team_mode).toMatchObject({
        enabled: true,
        max_parallel_members: 2,
      });
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
          oracle: { model: "openai/gpt-5.5" },
          momus: { model: "openai/gpt-5.4" },
        },
        disabled_hooks: ["comment-checker"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.oracle).toMatchObject({ model: "openai/gpt-5.5" });
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
          oracle: { model: "openai/gpt-5.5" },
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
          oracle: { model: "openai/gpt-5.5" },
        },
        disabled_hooks: ["not-a-real-hook"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.oracle).toMatchObject({ model: "openai/gpt-5.5" });
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
          oracle: { model: "openai/gpt-5.5" },
        },
        some_future_key: { foo: "bar" },
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.oracle).toMatchObject({ model: "openai/gpt-5.5" });
      expect((result as Record<string, unknown>)["some_future_key"]).toBeUndefined();
    });
  });
});

describe("loadPluginConfig", () => {
  it("should only honor mcp_env_allowlist from user config", async () => {
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

    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(config.mcp_env_allowlist).toEqual(["USER_ONLY_TOKEN"])
  })

  it("should ignore edits to the renamed legacy backup after migration", async () => {
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
    writeFileSync(legacyConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5.5" } } }))

    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    loadPluginConfig(projectDir, {})
    writeFileSync(backupConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5-nano" } } }))
    const reloadedConfig = loadPluginConfig(projectDir, {})

    // then
    expect(existsSync(legacyConfigPath)).toBe(false)
    expect(existsSync(backupConfigPath)).toBe(true)
    expect(readFileSync(canonicalConfigPath, "utf-8")).toContain('"openai/gpt-5.5"')
    expect(reloadedConfig.agents?.oracle?.model).toBe("openai/gpt-5.5")
  })

  it("should still load config from legacy path when migration fails", async () => {
    // given - legacy config exists but canonical path is not writable
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-fail-"))
    const userConfigDir = join(rootDir, "user-config")
    const projectDir = join(rootDir, "project")
    const projectConfigDir = join(projectDir, ".opencode")
    const legacyConfigPath = join(projectConfigDir, "oh-my-opencode.json")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(legacyConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5.5" } } }))

    // Make the directory read-only so migration write fails
    // (simulates Windows file lock / permission issues)
    if (process.platform !== "win32") {
      chmodSync(projectConfigDir, 0o555)
    }

    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    // when
    let config: OhMyOpenCodeConfig
    try {
      const fresh = await importFreshPluginConfigModule()
      config = fresh.loadPluginConfig(projectDir, {})
    } finally {
      // Restore permissions for cleanup
      if (process.platform !== "win32") {
        chmodSync(projectConfigDir, 0o755)
      }
    }

    // then - should still load the config from legacy path
    expect(config.agents?.oracle?.model).toBe("openai/gpt-5.5")
  })

  it("should load migrated legacy project config on the first load", async () => {
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
    writeFileSync(legacyConfigPath, JSON.stringify({ agents: { oracle: { model: "openai/gpt-5.5" } } }))

    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(existsSync(legacyConfigPath)).toBe(false)
    expect(existsSync(canonicalConfigPath)).toBe(true)
    expect(config.agents?.oracle?.model).toBe("openai/gpt-5.5")
  })

  it("should preserve explicit user git_master settings when project config omits git_master", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-git-master-user-"))
    const userConfigDir = join(rootDir, "user-config")
    const projectDir = join(rootDir, "project")
    const projectConfigDir = join(projectDir, ".opencode")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })

    writeFileSync(
      join(userConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({
        git_master: {
          commit_footer: false,
          include_co_authored_by: false,
        },
      })
    )

    writeFileSync(
      join(projectConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({
        agents: {
          hephaestus: { model: "openai/gpt-5.5" },
        },
      })
    )

    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(config.git_master).toEqual({
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "GIT_MASTER=1",
    })
  })

  it("should merge explicit git_master keys from user and project configs", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-git-master-merge-"))
    const userConfigDir = join(rootDir, "user-config")
    const projectDir = join(rootDir, "project")
    const projectConfigDir = join(projectDir, ".opencode")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })

    writeFileSync(
      join(userConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({
        git_master: {
          commit_footer: false,
          include_co_authored_by: false,
        },
      })
    )

    writeFileSync(
      join(projectConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({
        git_master: {
          commit_footer: true,
        },
      })
    )

    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(config.git_master).toEqual({
      commit_footer: true,
      include_co_authored_by: false,
      git_env_prefix: "GIT_MASTER=1",
    })
  })
  describe("team_mode.tmux_visualization", () => {
    it("#given canonical user config enables team_mode and legacy config also exists #when loadPluginConfig runs #then tmux_visualization remains false", async () => {
      // given
      const { userConfigDir, projectDir } = createLoadPluginConfigTestContext("omo-plugin-config-team-mode-user-")

      writeJsonFile(join(userConfigDir, "oh-my-openagent.json"), {
        team_mode: {
          enabled: true,
        },
      })
      writeJsonFile(join(userConfigDir, "oh-my-opencode.json"), {
        agents: {
          oracle: {
            model: "openai/gpt-5.4",
          },
        },
      })

      process.env.OPENCODE_CONFIG_DIR = userConfigDir

      // when
      const { loadPluginConfig } = await importFreshPluginConfigModule()
      const config = loadPluginConfig(projectDir, {})

      // then
      expect(config.team_mode?.enabled).toBe(true)
      expect(config.team_mode?.tmux_visualization).toBe(false)
    })

    it("#given canonical user config lacks team_mode and legacy config only enables team_mode #when loadPluginConfig runs #then canonical config wins and tmux_visualization stays effectively false", async () => {
      // given
      const { userConfigDir, projectDir } = createLoadPluginConfigTestContext("omo-plugin-config-team-mode-legacy-")

      writeJsonFile(join(userConfigDir, "oh-my-openagent.json"), {
        hashline_edit: true,
      })
      writeJsonFile(join(userConfigDir, "oh-my-opencode.json"), {
        team_mode: {
          enabled: true,
        },
      })

      process.env.OPENCODE_CONFIG_DIR = userConfigDir

      // when
      const { loadPluginConfig } = await importFreshPluginConfigModule()
      const config = loadPluginConfig(projectDir, {})

      // then
      expect(config.team_mode).toBeUndefined()
      expect(config.team_mode?.tmux_visualization ?? false).toBe(false)
    })

    it("#given canonical user config lacks team_mode and legacy config sets tmux_visualization=true #when loadPluginConfig runs #then legacy team_mode is not promoted into the loaded config", async () => {
      // given
      const { userConfigDir, projectDir } = createLoadPluginConfigTestContext("omo-plugin-config-team-mode-visualization-")

      writeJsonFile(join(userConfigDir, "oh-my-openagent.json"), {
        hashline_edit: true,
      })
      writeJsonFile(join(userConfigDir, "oh-my-opencode.json"), {
        team_mode: {
          enabled: true,
          tmux_visualization: true,
        },
      })

      process.env.OPENCODE_CONFIG_DIR = userConfigDir

      // when
      const { loadPluginConfig } = await importFreshPluginConfigModule()
      const config = loadPluginConfig(projectDir, {})

      // then
      // This proves a concurrent canonical file suppresses the legacy team_mode subtree entirely.
      expect(config.team_mode).toBeUndefined()
    })
  })

  it("should merge configs from ancestor directories with closer winning", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-walk-"))
    const userConfigDir = join(rootDir, "user-config")
    const homeDir = join(rootDir, "home")
    const workDir = join(homeDir, "work")
    const projectDir = join(workDir, "project")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(join(homeDir, ".opencode"), { recursive: true })
    mkdirSync(join(workDir, ".opencode"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })

    writeFileSync(
      join(userConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "user/model" } } })
    )
    writeFileSync(
      join(homeDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "home/model" } } })
    )
    writeFileSync(
      join(workDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "work/model" } } })
    )
    writeFileSync(
      join(projectDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "project/model" } } })
    )

    process.env.OPENCODE_CONFIG_DIR = userConfigDir
    process.env.HOME = homeDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(config.agents?.oracle?.model).toBe("project/model")
  })

  it("should layer ancestor configs so each contributes fields not overridden by closer ones", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-walk-layer-"))
    const userConfigDir = join(rootDir, "user-config")
    const homeDir = join(rootDir, "home")
    const workDir = join(homeDir, "work")
    const projectDir = join(workDir, "project")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(join(homeDir, ".opencode"), { recursive: true })
    mkdirSync(join(workDir, ".opencode"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })

    writeFileSync(join(userConfigDir, "oh-my-openagent.jsonc"), "{}")
    writeFileSync(
      join(homeDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "home/oracle" } } })
    )
    writeFileSync(
      join(workDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { hephaestus: { model: "work/hephaestus" } } })
    )
    writeFileSync(
      join(projectDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { sisyphus: { model: "project/sisyphus" } } })
    )

    process.env.OPENCODE_CONFIG_DIR = userConfigDir
    process.env.HOME = homeDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then - each level contributes a non-conflicting field
    expect(config.agents?.oracle?.model).toBe("home/oracle")
    expect(config.agents?.hephaestus?.model).toBe("work/hephaestus")
    expect(config.agents?.sisyphus?.model).toBe("project/sisyphus")
  })

  it("should preserve mcp_env_allowlist as user-only when ancestors set their own allowlists", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-walk-allowlist-"))
    const userConfigDir = join(rootDir, "user-config")
    const homeDir = join(rootDir, "home")
    const workDir = join(homeDir, "work")
    const projectDir = join(workDir, "project")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(join(homeDir, ".opencode"), { recursive: true })
    mkdirSync(join(workDir, ".opencode"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })

    writeFileSync(
      join(userConfigDir, "oh-my-openagent.jsonc"),
      JSON.stringify({ mcp_env_allowlist: ["USER_ONLY_TOKEN"] })
    )
    writeFileSync(
      join(homeDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ mcp_env_allowlist: ["HOME_TOKEN"] })
    )
    writeFileSync(
      join(workDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ mcp_env_allowlist: ["WORK_TOKEN"] })
    )
    writeFileSync(
      join(projectDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ mcp_env_allowlist: ["PROJECT_TOKEN"] })
    )

    process.env.OPENCODE_CONFIG_DIR = userConfigDir
    process.env.HOME = homeDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then - only the canonical user config can extend the allowlist
    expect(config.mcp_env_allowlist).toEqual(["USER_ONLY_TOKEN"])
  })

  it("should stop walking at $HOME and ignore configs above it", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-walk-stop-"))
    const userConfigDir = join(rootDir, "user-config")
    const aboveHomeDir = join(rootDir, "above-home")
    const homeDir = join(aboveHomeDir, "home")
    const projectDir = join(homeDir, "project")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(join(aboveHomeDir, ".opencode"), { recursive: true })
    mkdirSync(join(homeDir, ".opencode"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })

    writeFileSync(join(userConfigDir, "oh-my-openagent.jsonc"), "{}")
    writeFileSync(
      join(aboveHomeDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "above-home/leak" } } })
    )
    writeFileSync(
      join(homeDir, ".opencode", "oh-my-openagent.jsonc"),
      JSON.stringify({ agents: { hephaestus: { model: "home/wins" } } })
    )
    writeFileSync(join(projectDir, ".opencode", "oh-my-openagent.jsonc"), "{}")

    process.env.OPENCODE_CONFIG_DIR = userConfigDir
    process.env.HOME = homeDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then - $HOME's config applies, but the directory above it does NOT
    expect(config.agents?.hephaestus?.model).toBe("home/wins")
    expect(config.agents?.oracle).toBeUndefined()
  })

  it("should migrate legacy basenames found in ancestor directories", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-plugin-config-walk-legacy-"))
    const userConfigDir = join(rootDir, "user-config")
    const homeDir = join(rootDir, "home")
    const workDir = join(homeDir, "work")
    const projectDir = join(workDir, "project")
    const ancestorLegacyPath = join(workDir, ".opencode", "oh-my-opencode.jsonc")
    const ancestorCanonicalPath = join(workDir, ".opencode", "oh-my-openagent.jsonc")

    tempDirs.push(rootDir)
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(join(homeDir, ".opencode"), { recursive: true })
    mkdirSync(join(workDir, ".opencode"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })

    writeFileSync(join(userConfigDir, "oh-my-openagent.jsonc"), "{}")
    writeFileSync(
      ancestorLegacyPath,
      JSON.stringify({ agents: { oracle: { model: "ancestor-legacy/model" } } })
    )

    process.env.OPENCODE_CONFIG_DIR = userConfigDir
    process.env.HOME = homeDir

    // when
    const { loadPluginConfig } = await importFreshPluginConfigModule()
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(existsSync(ancestorLegacyPath)).toBe(false)
    expect(existsSync(ancestorCanonicalPath)).toBe(true)
    expect(config.agents?.oracle?.model).toBe("ancestor-legacy/model")
  })
})
