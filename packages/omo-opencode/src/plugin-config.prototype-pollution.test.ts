import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPluginConfig, mergeConfigs, parseConfigPartially } from "./plugin-config"
import { OhMyOpenCodeConfigSchema } from "./config"

const tempDirs: string[] = []

function hasOwnKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HOME

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("plugin config prototype pollution guards", () => {
  it("#given unsafe top-level keys #when partially parsing config #then prototype keys are ignored", () => {
    // given
    const rawConfig = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true},"agents":{"oracle":{"model":"safe/model"}}}') as Record<string, unknown>

    // when
    const result = parseConfigPartially(rawConfig)

    // then
    expect(result?.agents?.oracle?.model).toBe("safe/model")
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(hasOwnKey(result ?? {}, "__proto__")).toBe(false)
    expect(hasOwnKey(result ?? {}, "constructor")).toBe(false)
  })

  it("#given unsafe nested merge keys #when merging configs #then inherited prototypes are not polluted", () => {
    // given
    const base = OhMyOpenCodeConfigSchema.parse({
      agents: {
        oracle: { model: "base/model" },
      },
    })
    const override = OhMyOpenCodeConfigSchema.parse({
      agents: JSON.parse('{"__proto__":{"polluted":true},"oracle":{"temperature":0.4}}'),
    })

    // when
    const result = mergeConfigs(base, override)

    // then
    expect(result.agents?.oracle?.model).toBe("base/model")
    expect(result.agents?.oracle?.temperature).toBe(0.4)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(hasOwnKey(result.agents ?? {}, "__proto__")).toBe(false)
  })

  it("#given project config with unsafe keys and mcp_env_allowlist #when loading layers #then user allowlist remains the only allowlist", () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "omo-config-proto-"))
    tempDirs.push(rootDir)
    const userConfigDir = join(rootDir, "user-config")
    const homeDir = join(rootDir, "home")
    const projectDir = join(homeDir, "project")

    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(userConfigDir, "oh-my-openagent.jsonc"),
      '{"mcp_env_allowlist":["USER_ONLY_TOKEN"],"agents":{"oracle":{"model":"user/model"}}}',
    )
    writeFileSync(
      join(projectDir, ".opencode", "oh-my-openagent.jsonc"),
      '{"__proto__":{"polluted":true},"mcp_env_allowlist":["PROJECT_TOKEN"],"agents":{"oracle":{"temperature":0.2}}}',
    )

    process.env.OPENCODE_CONFIG_DIR = userConfigDir
    process.env.HOME = homeDir

    // when
    const config = loadPluginConfig(projectDir, {})

    // then
    expect(config.mcp_env_allowlist).toEqual(["USER_ONLY_TOKEN"])
    expect(config.agents?.oracle?.model).toBe("user/model")
    expect(config.agents?.oracle?.temperature).toBe(0.2)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(hasOwnKey(config, "__proto__")).toBe(false)
  })
})
