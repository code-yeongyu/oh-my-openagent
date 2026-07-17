import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadPluginConfig } from "../plugin-config/layered-config-loader"
import { validatePluginConfig } from "./validate"

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly OPENCODE_CONFIG_DIR: string | undefined
  readonly XDG_CONFIG_HOME: string | undefined
}

const ENV_KEYS = ["HOME", "OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME"] as const

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function withIsolatedConfig<T>(name: string, run: (root: string) => T): T {
  const original: EnvSnapshot = {
    HOME: process.env.HOME,
    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  }
  const root = join(tmpdir(), `omo-config-validate-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  try {
    mkdirSync(root, { recursive: true })
    process.env.HOME = root
    process.env.OPENCODE_CONFIG_DIR = join(root, "custom-config")
    process.env.XDG_CONFIG_HOME = join(root, "xdg-config")
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
    restoreEnv(original)
  }
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function snapshotFiles(directory: string): Record<string, number> {
  const files: Record<string, number> = {}
  for (const fileName of readdirSync(directory)) {
    const filePath = join(directory, fileName)
    files[fileName] = statSync(filePath).mtimeMs
  }
  return files
}

function pickRenderedConfigFields(config: ReturnType<typeof validatePluginConfig>["config"]): unknown {
  return {
    agents: config.agents,
    categories: config.categories,
    disabled_providers: config.disabled_providers,
    mcp_env_allowlist: config.mcp_env_allowlist,
    browser_automation_engine: config.browser_automation_engine,
    team_mode: config.team_mode,
    tui: config.tui,
  }
}

describe("validatePluginConfig", () => {
  it("returns defaults with tui sidebar enabled when no config exists", () => {
    withIsolatedConfig("defaults", (root) => {
      const project = join(root, "project")
      mkdirSync(project, { recursive: true })

      const result = validatePluginConfig(project)

      expect(result.valid).toBe(true)
      expect(result.messages).toEqual([])
      expect(result.path).toBeNull()
      expect(result.config.tui?.sidebar.enabled).toBe(true)
    })
  })

  it("allows tui sidebar to be disabled by config", () => {
    withIsolatedConfig("disabled", (root) => {
      const project = join(root, "project")
      writeJson(join(project, ".opencode", "oh-my-openagent.json"), {
        tui: { sidebar: { enabled: false } },
      })

      const result = validatePluginConfig(project)

      expect(result.valid).toBe(true)
      expect(result.config.tui?.sidebar.enabled).toBe(false)
    })
  })

  it("detects invalid ancestor configs from a child directory", () => {
    withIsolatedConfig("ancestor-invalid", (root) => {
      const project = join(root, "project")
      const child = join(project, "child", "deep")
      mkdirSync(child, { recursive: true })
      writeJson(join(project, ".opencode", "oh-my-openagent.json"), {
        agents: { sisyphus: { model: 123 } },
      })

      const result = validatePluginConfig(child)

      expect(result.valid).toBe(false)
      expect(result.messages.some((message: string) => message.includes("agents.sisyphus.model"))).toBe(true)
    })
  })

  it("uses nearest ancestor precedence and matches the runtime rendered config fields", () => {
    withIsolatedConfig("precedence", (root) => {
      const far = join(root, "project")
      const near = join(far, "near")
      const child = join(near, "child")
      mkdirSync(child, { recursive: true })
      writeJson(join(far, ".opencode", "oh-my-openagent.json"), {
        tui: { sidebar: { enabled: false } },
        team_mode: { enabled: false },
      })
      writeJson(join(near, ".opencode", "oh-my-openagent.json"), {
        tui: { sidebar: { enabled: true } },
        team_mode: { enabled: true },
      })

      const readonlyResult = validatePluginConfig(child)
      const runtimeConfig = loadPluginConfig(child, {})

      expect(readonlyResult.config.tui?.sidebar.enabled).toBe(true)
      expect(pickRenderedConfigFields(readonlyResult.config)).toEqual(pickRenderedConfigFields(runtimeConfig))
    })
  })

  it("preserves user-only playwright MCP arguments like the runtime loader", () => {
    withIsolatedConfig("playwright-user-only", (root) => {
      const userConfigDir = process.env.OPENCODE_CONFIG_DIR
      if (!userConfigDir) throw new Error("OPENCODE_CONFIG_DIR must be set by the test harness")

      const project = join(root, "project")
      writeJson(join(userConfigDir, "oh-my-openagent.json"), {
        browser_automation_engine: {
          provider: "playwright",
          playwright_mcp_args: ["--headless"],
        },
      })
      writeJson(join(project, ".opencode", "oh-my-openagent.json"), {
        browser_automation_engine: {
          provider: "playwright",
          playwright_mcp_args: ["--user-agent", "${GITHUB_TOKEN}"],
        },
      })

      const readonlyResult = validatePluginConfig(project)
      const runtimeConfig = loadPluginConfig(project, {})

      expect(readonlyResult.config.browser_automation_engine).toEqual(
        runtimeConfig.browser_automation_engine,
      )
      expect(readonlyResult.config.browser_automation_engine?.playwright_mcp_args).toEqual([
        "--headless",
      ])
    })
  })

  it("keeps valid config sections from a partially invalid layer", () => {
    withIsolatedConfig("partial", (root) => {
      const project = join(root, "project")
      writeJson(join(project, ".opencode", "oh-my-openagent.json"), {
        agents: { sisyphus: { model: 123 } },
        tui: { sidebar: { enabled: false } },
      })

      const result = validatePluginConfig(project)

      expect(result.valid).toBe(false)
      expect(result.config.tui?.sidebar.enabled).toBe(false)
      expect(result.messages.some((message: string) => message.includes("agents.sisyphus.model"))).toBe(true)
    })
  })

  it("applies disabled provider substitutions like the runtime loader", () => {
    withIsolatedConfig("disabled-provider", (root) => {
      const project = join(root, "project")
      writeJson(join(project, ".opencode", "oh-my-openagent.json"), {
        disabled_providers: ["blocked"],
        agents: {
          sisyphus: {
            model: "blocked/primary",
            fallback_models: ["allowed/fallback"],
          },
        },
      })

      const readonlyResult = validatePluginConfig(project)
      const runtimeConfig = loadPluginConfig(project, {})

      expect(readonlyResult.config.agents?.sisyphus?.model).toBe("allowed/fallback")
      expect(readonlyResult.config.agents?.sisyphus?.model).toBe(runtimeConfig.agents?.sisyphus?.model)
    })
  })

  it("does not migrate or rewrite legacy config files", () => {
    withIsolatedConfig("no-write", (root) => {
      const project = join(root, "project")
      const configDir = join(project, ".opencode")
      mkdirSync(configDir, { recursive: true })
      writeJson(join(configDir, "oh-my-opencode.json"), {
        tui: { sidebar: { enabled: false } },
      })
      const before = snapshotFiles(configDir)

      const result = validatePluginConfig(project)

      expect(result.valid).toBe(true)
      expect(result.config.tui?.sidebar.enabled).toBe(false)
      expect(snapshotFiles(configDir)).toEqual(before)
      expect(existsSync(join(configDir, "oh-my-openagent.json"))).toBe(false)
    })
  })

  it("migrates deprecated ralph_loop config to goal", () => {
    withIsolatedConfig("ralph-loop-migration", (root) => {
      const project = join(root, "project")
      mkdirSync(join(project, ".opencode"), { recursive: true })
      writeJson(join(project, ".opencode", "oh-my-openagent.json"), {
        ralph_loop: {
          enabled: true,
          default_max_iterations: 50,
        },
      })

      const result = validatePluginConfig(project)

      expect(result.valid).toBe(true)
      expect(result.config.goal?.enabled).toBe(true)
      expect(result.config.goal?.auto_start).toBe(false)
      expect(result.config.goal?.default_max_iterations).toBe(50)
    })
  })

  it("preserves explicit goal config over migrated ralph_loop values", () => {
    withIsolatedConfig("ralph-loop-goal-override", (root) => {
      const project = join(root, "project")
      mkdirSync(join(project, ".opencode"), { recursive: true })
      writeJson(join(project, ".opencode", "oh-my-openagent.json"), {
        goal: {
          enabled: false,
          default_max_iterations: 75,
        },
        ralph_loop: {
          enabled: true,
          default_max_iterations: 50,
        },
      })

      const result = validatePluginConfig(project)

      expect(result.config.goal?.enabled).toBe(false)
      expect(result.config.goal?.default_max_iterations).toBe(75)
    })
  })
})
