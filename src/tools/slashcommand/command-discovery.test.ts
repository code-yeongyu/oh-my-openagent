import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverCommandsSync } from "./command-discovery"

const ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_PLUGINS_HOME",
  "CLAUDE_SETTINGS_PATH",
  "OPENCODE_CONFIG_DIR",
] as const

type EnvKey = (typeof ENV_KEYS)[number]
type EnvSnapshot = Record<EnvKey, string | undefined>

function writePluginFixture(baseDir: string): { projectDir: string } {
  const projectDir = join(baseDir, "project")
  const claudeConfigDir = join(baseDir, "claude-config")
  const pluginsHome = join(claudeConfigDir, "plugins")
  const settingsPath = join(claudeConfigDir, "settings.json")
  const opencodeConfigDir = join(baseDir, "opencode-config")
  const pluginInstallPath = join(baseDir, "installed-plugins", "daplug")
  const pluginKey = "daplug@1.0.0"

  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(pluginInstallPath, ".claude-plugin"), { recursive: true })
  mkdirSync(join(pluginInstallPath, "commands"), { recursive: true })
  mkdirSync(join(pluginInstallPath, "skills", "plugin-plan"), { recursive: true })

  writeFileSync(
    join(pluginInstallPath, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "daplug", version: "1.0.0" }, null, 2),
  )
  writeFileSync(
    join(pluginInstallPath, "commands", "run-prompt.md"),
    `---
description: Run prompt from daplug
---
Execute daplug prompt flow.
`,
  )
  writeFileSync(
    join(pluginInstallPath, "skills", "plugin-plan", "SKILL.md"),
    `---
name: plugin-plan
description: Plan work from daplug skill
---
Build a plan from plugin skill context.
`,
  )

  mkdirSync(pluginsHome, { recursive: true })
  writeFileSync(
    join(pluginsHome, "installed_plugins.json"),
    JSON.stringify(
      {
        version: 2,
        plugins: {
          [pluginKey]: [
            {
              scope: "user",
              installPath: pluginInstallPath,
              version: "1.0.0",
              installedAt: "2026-01-01T00:00:00.000Z",
              lastUpdated: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
      null,
      2,
    ),
  )

  mkdirSync(claudeConfigDir, { recursive: true })
  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        enabledPlugins: {
          [pluginKey]: true,
        },
      },
      null,
      2,
    ),
  )
  mkdirSync(opencodeConfigDir, { recursive: true })

  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir
  process.env.CLAUDE_PLUGINS_HOME = pluginsHome
  process.env.CLAUDE_SETTINGS_PATH = settingsPath
  process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir

  return { projectDir }
}

describe("slashcommand command discovery plugin integration", () => {
  let tempDir = ""
  let projectDir = ""
  let envSnapshot: EnvSnapshot

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-command-discovery-test-"))
    envSnapshot = {
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      CLAUDE_PLUGINS_HOME: process.env.CLAUDE_PLUGINS_HOME,
      CLAUDE_SETTINGS_PATH: process.env.CLAUDE_SETTINGS_PATH,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    }
    const setup = writePluginFixture(tempDir)
    projectDir = setup.projectDir
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const previousValue = envSnapshot[key]
      if (previousValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previousValue
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("discovers marketplace plugin commands and skills as command items", () => {
    const commands = discoverCommandsSync(projectDir, { pluginsEnabled: true })
    const names = commands.map(command => command.name)

    expect(names).toContain("daplug:run-prompt")
    expect(names).toContain("daplug:plugin-plan")

    const pluginCommand = commands.find(command => command.name === "daplug:run-prompt")
    const pluginSkill = commands.find(command => command.name === "daplug:plugin-plan")

    expect(pluginCommand?.scope).toBe("plugin")
    expect(pluginSkill?.scope).toBe("plugin")
  })

  it("omits marketplace plugin commands when plugins are disabled", () => {
    const commands = discoverCommandsSync(projectDir, { pluginsEnabled: false })
    const names = commands.map(command => command.name)

    expect(names).not.toContain("daplug:run-prompt")
    expect(names).not.toContain("daplug:plugin-plan")
  })

  it("honors plugins_override by disabling overridden plugin keys", () => {
    const commands = discoverCommandsSync(projectDir, {
      pluginsEnabled: true,
      enabledPluginsOverride: { "daplug@1.0.0": false },
    })
    const names = commands.map(command => command.name)

    expect(names).not.toContain("daplug:run-prompt")
    expect(names).not.toContain("daplug:plugin-plan")
  })

  it("discovers parent opencode commands when profile config dir is active", () => {
    const opencodeRootDir = join(tempDir, "opencode-root")
    const profileConfigDir = join(opencodeRootDir, "profiles", "codex")
    const globalCommandDir = join(opencodeRootDir, "command")

    mkdirSync(profileConfigDir, { recursive: true })
    mkdirSync(globalCommandDir, { recursive: true })
    writeFileSync(
      join(globalCommandDir, "commit.md"),
      `---
description: Commit through parent opencode config
---
Use parent opencode commit command.
`
    )
    process.env.OPENCODE_CONFIG_DIR = profileConfigDir

    const commands = discoverCommandsSync(projectDir)
    const commitCommand = commands.find(command => command.name === "commit")

    expect(commitCommand?.scope).toBe("opencode")
    expect(commitCommand?.content).toContain("Use parent opencode commit command.")
  })
})
