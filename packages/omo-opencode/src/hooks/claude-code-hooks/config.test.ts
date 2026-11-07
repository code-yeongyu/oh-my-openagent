const { afterEach, beforeEach, describe, expect, mock, spyOn, test } = require("bun:test")
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const { clearClaudeHooksConfigCache, loadClaudeHooksConfig } = await import("./config")

describe("loadClaudeHooksConfig", () => {
  const originalDateNow = Date.now
  let originalWorkingDirectory = ""
  let tempDirectory = ""
  let customSettingsPath = ""
  let mockedNow = 0

  beforeEach(() => {
    //#given
    originalWorkingDirectory = process.cwd()
    tempDirectory = mkdtempSync(join(tmpdir(), "omo-claude-hooks-config-"))
    customSettingsPath = join(tempDirectory, "custom-settings.json")
    mkdirSync(join(tempDirectory, ".claude"), { recursive: true })
    process.chdir(tempDirectory)
    mockedNow = 1_000
    Date.now = () => mockedNow
    clearClaudeHooksConfigCache()
  })

  afterEach(() => {
    clearClaudeHooksConfigCache()
    Date.now = originalDateNow
    process.chdir(originalWorkingDirectory)
    rmSync(tempDirectory, { recursive: true, force: true })
  })

  test("#given cached hook config #when file changes within ttl #then cached value is reused", async () => {
    //#given
    writeSettingsFile(customSettingsPath, "first-stop-command")

    //#when
    const firstResult = await loadClaudeHooksConfig(customSettingsPath)
    writeSettingsFile(customSettingsPath, "second-stop-command")
    mockedNow += 5_000
    const secondResult = await loadClaudeHooksConfig(customSettingsPath)

    //#then
    expect(getStopCommands(firstResult)).toContain("first-stop-command")
    expect(getStopCommands(secondResult)).toContain("first-stop-command")
    expect(getStopCommands(secondResult)).not.toContain("second-stop-command")
  })

  test("#given cached hook config #when ttl expires or cache clears #then updated file contents are reloaded", async () => {
    //#given
    writeSettingsFile(customSettingsPath, "first-stop-command")
    await loadClaudeHooksConfig(customSettingsPath)

    //#when
    writeSettingsFile(customSettingsPath, "second-stop-command")
    mockedNow += 31_000
    const ttlReloaded = await loadClaudeHooksConfig(customSettingsPath)

    writeSettingsFile(customSettingsPath, "third-stop-command")
    clearClaudeHooksConfigCache()
    const manuallyReloaded = await loadClaudeHooksConfig(customSettingsPath)

    //#then
    expect(getStopCommands(ttlReloaded)).toContain("second-stop-command")
    expect(getStopCommands(ttlReloaded)).not.toContain("first-stop-command")
    expect(getStopCommands(manuallyReloaded)).toContain("third-stop-command")
    expect(getStopCommands(manuallyReloaded)).not.toContain("second-stop-command")
  })

  test("#given settings parsing throws a non-Error value #when hooks config loads #then it falls back to no config", async () => {
    //#given
    writeSettingsFile(customSettingsPath, "stop-command")
    const thrownValue = "parse failed"
    const parseSpy = spyOn(JSON, "parse").mockImplementation(() => {
      throw thrownValue
    })

    try {
      //#when
      const result = await loadClaudeHooksConfig(customSettingsPath)

      //#then
      expect(result).toBeNull()
    } finally {
      parseSpy.mockRestore()
    }
  })
})

function writeSettingsFile(filePath: string, command: string): void {
  writeFileSync(
    filePath,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [{ command }],
          },
        ],
      },
    }),
  )
}

function getStopCommands(config: Awaited<ReturnType<typeof loadClaudeHooksConfig>>): string[] {
  return (config?.Stop ?? []).flatMap((matcher) =>
    matcher.hooks.flatMap((hook) =>
      "command" in hook && typeof hook.command === "string" ? [hook.command] : [],
    ),
  )
}

describe("mergePluginHooksConfigs", () => {
  const { mergePluginHooksConfigs, setPluginHooksConfigs, clearClaudeHooksConfigCache: _clearCache, resetPluginHooksState } = require("./config")
  const { setAdditionalAllowedMcpEnvVars, resetAdditionalAllowedMcpEnvVars } = require("../../features/claude-code-mcp-loader/configure-allowed-env-vars")

  afterEach(() => {
    resetAdditionalAllowedMcpEnvVars()
    resetPluginHooksState()
  })

  test("#given empty plugin hooks #when merged #then returns base unchanged", () => {
    // given
    const base = {
      Stop: [{ matcher: "*", hooks: [{ type: "command" as const, command: "echo stop" }] }],
    }

    // when
    const result = mergePluginHooksConfigs(base, [])

    // then
    expect(result).toEqual(base)
  })

  test("#given plugin command hook #when merged #then allowedEnvVars is set to MCP allowlist", () => {
    // given
    setAdditionalAllowedMcpEnvVars(["MY_VAR"])
    const base = {}
    const pluginConfig = {
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "echo hello" }],
          },
        ],
      },
    }

    // when
    const result = mergePluginHooksConfigs(base, [pluginConfig])

    // then
    const stopHooks = result.Stop ?? []
    expect(stopHooks.length).toBe(1)
    const hook = stopHooks[0].hooks[0]
    expect(hook.type).toBe("command")
    if (hook.type === "command") {
      expect(hook.allowedEnvVars).toContain("MY_VAR")
    }
  })

  test("#given plugin HTTP hook with allowedEnvVars #when merged #then vars are intersected with MCP allowlist", () => {
    // given
    setAdditionalAllowedMcpEnvVars(["MY_TOKEN"])
    const base = {}
    const pluginConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "http", url: "https://example.com/hook", allowedEnvVars: ["MY_TOKEN", "SECRET_KEY"] }],
          },
        ],
      },
    }

    // when
    const result = mergePluginHooksConfigs(base, [pluginConfig])

    // then
    const preToolHooks = result.PreToolUse ?? []
    expect(preToolHooks.length).toBe(1)
    const hook = preToolHooks[0].hooks[0]
    expect(hook.type).toBe("http")
    if (hook.type === "http") {
      expect(hook.allowedEnvVars).toContain("MY_TOKEN")
      expect(hook.allowedEnvVars).not.toContain("SECRET_KEY")
    }
  })

  test("#given plugin HTTP hook with no allowedEnvVars #when merged #then hook passes through without crash", () => {
    // given
    const base = {}
    const pluginConfig = {
      hooks: {
        PostToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "http", url: "https://example.com/post" }],
          },
        ],
      },
    }

    // when
    const result = mergePluginHooksConfigs(base, [pluginConfig])

    // then
    const postToolHooks = result.PostToolUse ?? []
    expect(postToolHooks.length).toBe(1)
    const hook = postToolHooks[0].hooks[0]
    expect(hook.type).toBe("http")
    if (hook.type === "http") {
      expect(hook.allowedEnvVars).toBeUndefined()
    }
  })

  test("#given plugin hook with invalid action type #when merged #then it is filtered out", () => {
    // given
    const base = {}
    const pluginConfig = {
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "echo valid" },
              { type: "invalid", something: "bad" },
              { notAHook: true },
            ],
          },
        ],
      },
    }

    // when
    const result = mergePluginHooksConfigs(base, [pluginConfig])

    // then
    const stopHooks = result.Stop ?? []
    expect(stopHooks.length).toBe(1)
    expect(stopHooks[0].hooks.length).toBe(1)
    expect(stopHooks[0].hooks[0].type).toBe("command")
  })

  test("#given plugin hook with non-array hooks #when merged #then it is skipped", () => {
    // given
    const base = {}
    const pluginConfig = {
      hooks: {
        Stop: "not-an-array",
        PreToolUse: 42,
      },
    }

    // when
    const result = mergePluginHooksConfigs(base, [pluginConfig])

    // then
    expect(result.Stop).toBeUndefined()
    expect(result.PreToolUse).toBeUndefined()
  })
})

describe("setPluginHooksConfigs", () => {
  const { setPluginHooksConfigs, loadClaudeHooksConfig, clearClaudeHooksConfigCache: _clearCache, resetPluginHooksState } = require("./config")
  const { resetAdditionalAllowedMcpEnvVars } = require("../../features/claude-code-mcp-loader/configure-allowed-env-vars")
  let originalWorkingDirectory = ""

  beforeEach(() => {
    originalWorkingDirectory = process.cwd()
    _clearCache()
  })

  afterEach(() => {
    _clearCache()
    resetAdditionalAllowedMcpEnvVars()
    resetPluginHooksState()
    process.chdir(originalWorkingDirectory)
  })

  test("#given configs set for directory A #when loading config from directory A #then plugin hooks are included", async () => {
    // given
    const dirA = process.cwd()
    setPluginHooksConfigs(dirA, [
      {
        hooks: {
          Stop: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "echo plugin-stop" }],
            },
          ],
        },
      },
    ])

    // when
    const config = await loadClaudeHooksConfig()

    // then
    const stopCommands = (config?.Stop ?? []).flatMap((m) =>
      m.hooks.flatMap((h) => (h.type === "command" && typeof h.command === "string" ? [h.command] : [])),
    )
    expect(stopCommands).toContain("echo plugin-stop")
  })

  test("#given configs set for directory A #when loading config from directory B #then plugin hooks are NOT included", async () => {
    // given
    const dirA = "/tmp/omo-test-dir-a"
    const dirB = process.cwd()
    setPluginHooksConfigs(dirA, [
      {
        hooks: {
          Stop: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "echo plugin-stop-a" }],
            },
          ],
        },
      },
    ])

    // when — cwd is dirB, not dirA
    const config = await loadClaudeHooksConfig()

    // then — plugin hooks from dirA should NOT appear
    const stopCommands = (config?.Stop ?? []).flatMap((m) =>
      m.hooks.flatMap((h) => (h.type === "command" && typeof h.command === "string" ? [h.command] : [])),
    )
    expect(stopCommands).not.toContain("echo plugin-stop-a")
  })
})

describe("loadClaudeHooksConfig project trust gating", () => {
  const { clearClaudeHooksConfigCache: clearTrustCache, loadClaudeHooksConfig: loadTrustConfig } = require("./config")
  let originalWorkingDirectory = ""
  let originalClaudeConfigDir: string | undefined
  let originalTrustEnv: string | undefined
  let tempHome = ""
  let projectDirectory = ""
  let claudeConfigDirectory = ""

  beforeEach(() => {
    //#given
    originalWorkingDirectory = process.cwd()
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalTrustEnv = process.env.OMO_CLAUDE_SETTINGS_TRUST
    tempHome = mkdtempSync(join(tmpdir(), "omo-claude-hooks-trust-"))
    projectDirectory = join(tempHome, "project")
    claudeConfigDirectory = join(tempHome, "claude-config")
    mkdirSync(join(projectDirectory, ".claude"), { recursive: true })
    mkdirSync(claudeConfigDirectory, { recursive: true })
    writeFileSync(
      join(projectDirectory, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "*", hooks: [{ command: "project-stop-command" }] }],
        },
      }),
    )
    process.chdir(projectDirectory)
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDirectory
    delete process.env.OMO_CLAUDE_SETTINGS_TRUST
    clearTrustCache()
  })

  afterEach(() => {
    clearTrustCache()
    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }
    if (originalTrustEnv === undefined) {
      delete process.env.OMO_CLAUDE_SETTINGS_TRUST
    } else {
      process.env.OMO_CLAUDE_SETTINGS_TRUST = originalTrustEnv
    }
    process.chdir(originalWorkingDirectory)
    rmSync(tempHome, { recursive: true, force: true })
  })

  test("#given an untrusted project #when hooks config loads #then project-level hooks are not loaded", async () => {
    //#given
    writeClaudeGlobalConfig({})

    //#when
    const result = await loadTrustConfig()

    //#then
    expect(getStopCommands(result)).not.toContain("project-stop-command")
  })

  test("#given a project trusted by Claude Code #when hooks config loads #then project-level hooks are loaded", async () => {
    //#given
    writeClaudeGlobalConfig({
      projects: { [resolve(projectDirectory)]: { hasTrustDialogAccepted: true } },
    })

    //#when
    const result = await loadTrustConfig()

    //#then
    expect(getStopCommands(result)).toContain("project-stop-command")
  })

  test("#given an explicitly denied project with env opt-in #when hooks config loads #then project-level hooks stay excluded", async () => {
    //#given
    process.env.OMO_CLAUDE_SETTINGS_TRUST = "1"
    writeClaudeGlobalConfig({
      projects: { [resolve(projectDirectory)]: { hasTrustDialogAccepted: false } },
    })

    //#when
    const result = await loadTrustConfig()

    //#then
    expect(getStopCommands(result)).not.toContain("project-stop-command")
  })

  test("#given an unknown project with env opt-in #when hooks config loads #then project-level hooks are loaded", async () => {
    //#given
    process.env.OMO_CLAUDE_SETTINGS_TRUST = "1"

    //#when
    const result = await loadTrustConfig()

    //#then
    expect(getStopCommands(result)).toContain("project-stop-command")
  })

  test("#given an untrusted project with user-level settings #when hooks config loads #then user-level hooks still load", async () => {
    //#given
    writeClaudeGlobalConfig({})
    writeFileSync(
      join(claudeConfigDirectory, "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "*", hooks: [{ command: "user-stop-command" }] }],
        },
      }),
    )

    //#when
    const result = await loadTrustConfig()

    //#then
    expect(getStopCommands(result)).toContain("user-stop-command")
    expect(getStopCommands(result)).not.toContain("project-stop-command")
  })

  function writeClaudeGlobalConfig(config: unknown): void {
    writeFileSync(join(claudeConfigDirectory, ".claude.json"), JSON.stringify(config))
  }
})

export {}
