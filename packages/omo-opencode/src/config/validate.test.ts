import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { validatePluginConfig } from "./validate"

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly OCX_PROFILE: string | undefined
  readonly OMO_PROFILE: string | undefined
  readonly OPENCODE_CONFIG_DIR: string | undefined
}

type Fixture = {
  readonly project: string
  readonly root: string
}

const ENV_KEYS = ["HOME", "OCX_PROFILE", "OMO_PROFILE", "OPENCODE_CONFIG_DIR"] as const

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function withOmoConfig<T>(name: string, run: (fixture: Fixture) => T): T {
  const snapshot: EnvSnapshot = {
    HOME: process.env.HOME,
    OCX_PROFILE: process.env.OCX_PROFILE,
    OMO_PROFILE: process.env.OMO_PROFILE,
    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  }
  const root = mkdtempSync(join(tmpdir(), `omo-config-validate-${name}-`))
  const fixture = { root, project: join(root, "project") }

  try {
    mkdirSync(fixture.project, { recursive: true })
    process.env.HOME = root
    delete process.env.OCX_PROFILE
    delete process.env.OMO_PROFILE
    delete process.env.OPENCODE_CONFIG_DIR
    return run(fixture)
  } finally {
    rmSync(root, { recursive: true, force: true })
    restoreEnv(snapshot)
  }
}

function writeJsonc(path: string, config: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
}

function writeUserConfig(fixture: Fixture, config: unknown): void {
  writeJsonc(join(fixture.root, ".omo", "omo.jsonc"), config)
}

function writeProjectConfig(fixture: Fixture, config: unknown): void {
  writeJsonc(join(fixture.project, ".omo", "omo.jsonc"), config)
}

describe("validatePluginConfig", () => {
  it("#given no omo config #when validating #then returns plugin defaults", () => {
    withOmoConfig("defaults", (fixture) => {
      const result = validatePluginConfig(fixture.project)

      expect(result.messages).toEqual([])
      expect(result.valid).toBe(true)
      expect(result.path).toBeNull()
      expect(result.config.tui?.sidebar.enabled).toBe(true)
    })
  })

  it("#given a project omo harness block #when validating #then loads the opencode view", () => {
    withOmoConfig("project-view", (fixture) => {
      writeProjectConfig(fixture, { "[opencode]": { tui: { sidebar: { enabled: false } } } })

      const result = validatePluginConfig(fixture.project)

      expect(result.valid).toBe(true)
      expect(result.config.tui?.sidebar.enabled).toBe(false)
    })
  })

  it("#given an invalid ancestor omo harness block #when validating from a child #then reports the schema path", () => {
    withOmoConfig("ancestor-invalid", (fixture) => {
      const child = join(fixture.project, "child", "deep")
      mkdirSync(child, { recursive: true })
      writeProjectConfig(fixture, { "[opencode]": { agents: { sisyphus: { model: 123 } } } })

      const result = validatePluginConfig(child)

      expect(result.valid).toBe(false)
      expect(result.messages.some((message) => message.includes("agents.sisyphus.model"))).toBe(true)
    })
  })

  it("#given user and project omo views #when validating #then preserves plugin merge and disabled-set semantics", () => {
    withOmoConfig("merge", (fixture) => {
      writeUserConfig(fixture, {
        "[opencode]": {
          agents: { sisyphus: { model: "user/model", prompt: "user prompt" } },
          categories: { deep: { model: "user/deep", temperature: 0.2 } },
          claude_code: { mcp: true },
          disabled_agents: ["user-agent"],
          tui: { sidebar: { enabled: false } },
        },
      })
      writeProjectConfig(fixture, {
        "[opencode]": {
          agents: { sisyphus: { model: "project/model", temperature: 0.7 } },
          categories: { deep: { prompt_append: "project appendix" } },
          claude_code: { commands: true },
          disabled_agents: ["project-agent"],
        },
      })

      const result = validatePluginConfig(fixture.project)

      expect(result.config.agents?.sisyphus).toMatchObject({
        model: "project/model",
        prompt: "user prompt",
        temperature: 0.7,
      })
      expect(result.config.categories?.["deep-low"]).toMatchObject({
        model: "user/deep",
        temperature: 0.2,
        prompt_append: "project appendix",
      })
      expect(result.config.claude_code).toMatchObject({ mcp: true, commands: true })
      expect(result.config.disabled_agents).toEqual(["user-agent", "project-agent"])
      expect(result.config.tui?.sidebar.enabled).toBe(false)
    })
  })

  it("#given protected fields in user and project base blocks #when validating #then honors only the user base values", () => {
    withOmoConfig("protected-user-base", (fixture) => {
      writeUserConfig(fixture, {
        "[opencode]": {
          mcp_env_allowlist: ["USER_BASE_TOKEN"],
          browser_automation_engine: { provider: "playwright", playwright_mcp_args: ["--user-base"] },
        },
      })
      writeProjectConfig(fixture, {
        "[opencode]": {
          mcp_env_allowlist: ["PROJECT_BASE_TOKEN"],
          browser_automation_engine: { provider: "playwright", playwright_mcp_args: ["--project-base"] },
        },
        profiles: {
          kimi: {
            "[opencode]": {
              mcp_env_allowlist: ["PROJECT_PROFILE_TOKEN"],
              browser_automation_engine: { provider: "playwright", playwright_mcp_args: ["--project-profile"] },
            },
          },
        },
      })
      process.env.OCX_PROFILE = "kimi"

      const result = validatePluginConfig(fixture.project)

      expect(result.config.mcp_env_allowlist).toEqual(["USER_BASE_TOKEN"])
      expect(result.config.browser_automation_engine?.playwright_mcp_args).toEqual(["--user-base"])
    })
  })

  it("#given protected fields in an active user profile and project profile #when validating #then honors only the user profile values", () => {
    withOmoConfig("protected-user-profile", (fixture) => {
      writeUserConfig(fixture, {
        "[opencode]": {
          mcp_env_allowlist: ["USER_BASE_TOKEN"],
          browser_automation_engine: { provider: "playwright", playwright_mcp_args: ["--user-base"] },
        },
        profiles: {
          kimi: {
            "[opencode]": {
              mcp_env_allowlist: ["USER_PROFILE_TOKEN"],
              browser_automation_engine: { provider: "playwright", playwright_mcp_args: ["--user-profile"] },
            },
          },
        },
      })
      writeProjectConfig(fixture, {
        "[opencode]": {
          mcp_env_allowlist: ["PROJECT_BASE_TOKEN"],
          browser_automation_engine: { provider: "playwright", playwright_mcp_args: ["--project-base"] },
        },
        profiles: {
          kimi: {
            "[opencode]": {
              mcp_env_allowlist: ["PROJECT_PROFILE_TOKEN"],
              browser_automation_engine: { provider: "playwright", playwright_mcp_args: ["--project-profile"] },
            },
          },
        },
      })
      process.env.OCX_PROFILE = "kimi"

      const result = validatePluginConfig(fixture.project)

      expect(result.config.mcp_env_allowlist).toEqual(["USER_PROFILE_TOKEN"])
      expect(result.config.browser_automation_engine?.playwright_mcp_args).toEqual(["--user-profile"])
    })
  })

  it("#given the user enables atomic in the opencode block #when validating #then the authorized settings reach the plugin config", () => {
    withOmoConfig("atomic-user", (fixture) => {
      writeUserConfig(fixture, { "[opencode]": { atomic: { enabled: true, context: { limit: 8 } } } })
      writeProjectConfig(fixture, { atomic: { context: { limit: 2 } } })

      const result = validatePluginConfig(fixture.project)

      expect(result.messages).toEqual([])
      expect(result.valid).toBe(true)
      expect(result.config.atomic).toEqual({
        enabled: true,
        context: { enabled: true, limit: 2, budget_chars: 8000, timeout_ms: 1000, cache_ttl_ms: 15_000 },
        recording: { enabled: true, owner: "auto", timeout_ms: 30_000 },
      })
    })
  })

  it("#given a project that enables atomic and sets binary_path #when validating #then both are ignored with a warning and the config stays valid", () => {
    withOmoConfig("atomic-project", (fixture) => {
      writeProjectConfig(fixture, {
        atomic: { enabled: true },
        "[opencode]": { atomic: { binary_path: "/tmp/evil/atomic" } },
      })

      const result = validatePluginConfig(fixture.project)

      expect(result.valid).toBe(true)
      expect(result.config.atomic).toBeUndefined()
      expect(result.warnings).toEqual([
        "config: ~/project/.omo/omo.jsonc: atomic.enabled ignored (user config only)",
        "config: ~/project/.omo/omo.jsonc: [opencode].atomic.binary_path ignored (user config only)",
      ])
    })
  })

  it("#given an invalid [opencode].atomic value #when validating #then the value is dropped and the rest of atomic still applies", () => {
    withOmoConfig("atomic-invalid", (fixture) => {
      writeUserConfig(fixture, { "[opencode]": { atomic: { enabled: true, recording: { owner: "nobody" } } } })

      const result = validatePluginConfig(fixture.project)

      expect(result.config.atomic?.enabled).toBe(true)
      expect(result.config.atomic?.recording?.owner).toBe("auto")
      expect(result.warnings).toContain(
        "config: ~/.omo/omo.jsonc: [opencode].atomic.recording.owner ignored (invalid value)",
      )
    })
  })

  it("#given atomic absent, false, or enabled only by the project #when validating #then the plugin config equals the origin/dev capture", () => {
    // Plugin config for this user block, captured from origin/dev eb6f16df59 before `atomic` existed.
    const originDevConfig = {
      git_master: { commit_footer: false, include_co_authored_by: true, git_env_prefix: "GIT_MASTER=1" },
      tui: { sidebar: { enabled: false } },
      agent_definitions: [],
      disabled_agents: [],
      disabled_mcps: [],
      disabled_hooks: ["comment-checker"],
      disabled_commands: [],
      disabled_skills: [],
      disabled_tools: [],
      disabled_providers: [],
      mcp_env_allowlist: [],
    }
    const user = { "[opencode]": { tui: { sidebar: { enabled: false } }, disabled_hooks: ["comment-checker"] } }
    const variants = [
      { user, project: undefined },
      { user: { ...user, atomic: { enabled: false, context: { limit: 3 } } }, project: undefined },
      {
        user,
        project: {
          atomic: { enabled: true, binary_path: "/tmp/evil/atomic" },
          "[opencode]": { atomic: { enabled: true } },
        },
      },
    ]

    for (const [index, variant] of variants.entries()) {
      withOmoConfig(`atomic-off-${index}`, (fixture) => {
        writeUserConfig(fixture, variant.user)
        if (variant.project !== undefined) writeProjectConfig(fixture, variant.project)

        const result = validatePluginConfig(fixture.project)

        expect(result.config).toEqual(originDevConfig)
      })
    }
  })

  it("#given unknown opencode keys #when validating #then reports and strips every unknown path without losing known values", () => {
    withOmoConfig("unknown-keys", (fixture) => {
      writeProjectConfig(fixture, {
        "[opencode]": {
          unknown_switch: true,
          tui: { sidebar: { enabled: false, unknown_sidebar_switch: true } },
        },
      })

      const result = validatePluginConfig(fixture.project)

      expect(result.valid).toBe(false)
      expect(result.messages.some((message) => message.includes("Unknown config key: unknown_switch"))).toBe(true)
      expect(
        result.messages.some((message) => message.includes("Unknown config key: tui.sidebar.unknown_sidebar_switch")),
      ).toBe(true)
      expect(Object.hasOwn(result.config, "unknown_switch")).toBe(false)
      expect(Object.hasOwn(result.config.tui?.sidebar ?? {}, "unknown_sidebar_switch")).toBe(false)
      expect(result.config.tui?.sidebar.enabled).toBe(false)
    })
  })

  it("#given an OCX profile overlay #when OCX_PROFILE changes #then flips the resolved sisyphus model", () => {
    withOmoConfig("ocx-profile", (fixture) => {
      writeUserConfig(fixture, {
        "[opencode]": { agents: { sisyphus: { model: "base/model" } } },
        profiles: { kimi: { "[opencode]": { agents: { sisyphus: { model: "kimi/model" } } } } },
      })

      const base = validatePluginConfig(fixture.project)
      process.env.OCX_PROFILE = "kimi"
      const kimi = validatePluginConfig(fixture.project)

      expect(base.config.agents?.sisyphus?.model).toBe("base/model")
      expect(kimi.config.agents?.sisyphus?.model).toBe("kimi/model")
    })
  })

  it("#given a model catalog reference in the opencode view #when validating #then resolves the model identifier", () => {
    withOmoConfig("model-catalog", (fixture) => {
      writeProjectConfig(fixture, {
        models: { kimi: { model: "provider/kimi" } },
        "[opencode]": { agents: { sisyphus: { model: "kimi" } } },
      })

      const result = validatePluginConfig(fixture.project)

      expect(result.config.agents?.sisyphus?.model).toBe("provider/kimi")
    })
  })

  it("#given a migrated canonical agent model chain #when validating #then materializes the runtime model fields", () => {
    withOmoConfig("canonical-agent-models", (fixture) => {
      writeProjectConfig(fixture, {
        "[opencode]": {
          agents: {
            explore: {
              models: [
                { model: "provider/primary", reasoning: "low" },
                { model: "provider/fallback", reasoning: "medium" },
              ],
            },
          },
        },
      })

      const result = validatePluginConfig(fixture.project)

      expect(result.messages).toEqual([])
      expect(result.valid).toBe(true)
      expect(result.config.agents?.explore?.model).toBe("provider/primary")
      expect(result.config.agents?.explore?.reasoning).toBe("low")
      expect(result.config.agents?.explore?.fallback_models).toEqual([
        { model: "provider/fallback", reasoning: "medium" },
      ])
    })
  })
})
