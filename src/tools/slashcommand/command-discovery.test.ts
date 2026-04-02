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

  it("discovers ancestor project opencode commands from plural commands directory", () => {
    const projectRoot = join(projectDir, "workspace")
    const childDir = join(projectRoot, "apps", "cli")
    const commandsDir = join(projectRoot, ".opencode", "commands")

    mkdirSync(childDir, { recursive: true })
    mkdirSync(commandsDir, { recursive: true })
    writeFileSync(
      join(commandsDir, "ancestor.md"),
      `---
description: Discover command from ancestor plural directory
---
Use ancestor command.
`,
    )

    const commands = discoverCommandsSync(childDir)
    const ancestorCommand = commands.find((command) => command.name === "ancestor")

    expect(ancestorCommand?.scope).toBe("opencode-project")
    expect(ancestorCommand?.content).toContain("Use ancestor command.")
  })

  it("deduplicates same-named opencode commands while keeping the higher-priority alias", () => {
    const commandsRoot = join(projectDir, ".opencode")
    const singularDir = join(commandsRoot, "command")
    const pluralDir = join(commandsRoot, "commands")

    mkdirSync(singularDir, { recursive: true })
    mkdirSync(pluralDir, { recursive: true })
    writeFileSync(
      join(singularDir, "duplicate.md"),
      `---
description: Singular duplicate command
---
Use singular command.
`,
    )
    writeFileSync(
      join(pluralDir, "duplicate.md"),
      `---
description: Plural duplicate command
---
Use plural command.
`,
    )

    const commands = discoverCommandsSync(projectDir)
    const duplicates = commands.filter((command) => command.name === "duplicate")

    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.content).toContain("Use plural command.")
  })

  it("discovers nested opencode project commands", () => {
    const commandsDir = join(projectDir, ".opencode", "commands", "refactor")

    mkdirSync(commandsDir, { recursive: true })
    writeFileSync(
      join(commandsDir, "code.md"),
      `---
description: Nested command
---
Use nested command.
`,
    )

    const commands = discoverCommandsSync(projectDir)
    const nestedCommand = commands.find((command) => command.name === "refactor/code")

    expect(nestedCommand?.content).toContain("Use nested command.")
    expect(nestedCommand?.scope).toBe("opencode-project")
  })

  it("keeps builtin start-work routed to Atlas during static discovery", () => {
    // given

    // when
    const commands = discoverCommandsSync(projectDir)
    const startWorkCommand = commands.find((command) => command.name === "start-work")

    // then
    expect(startWorkCommand?.metadata.agent).toBe("atlas")
  })
})

describe("non-directory commands path", () => {
  let testDir: string
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "omo-cmd-file-"))
    savedEnv = {
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    }
    process.env.CLAUDE_CONFIG_DIR = join(testDir, "claude-config")
    process.env.OPENCODE_CONFIG_DIR = join(testDir, "opencode-config")
    mkdirSync(join(testDir, "claude-config"), { recursive: true })
    mkdirSync(join(testDir, "opencode-config"), { recursive: true })
  })

  afterEach(() => {
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    })
    rmSync(testDir, { recursive: true, force: true })
  })

  it("#given .claude/commands is a file #when discoverCommandsSync runs #then returns without crashing", () => {
    const projectDir = join(testDir, "project")
    mkdirSync(join(projectDir, ".claude"), { recursive: true })
    writeFileSync(join(projectDir, ".claude", "commands"), "")  // file, not directory

    // Should not throw
    const commands = discoverCommandsSync(projectDir)
    expect(commands).toBeInstanceOf(Array)
  })

  it("#given .claude/commands is a directory #when discoverCommandsSync runs #then discovers commands normally", () => {
    const projectDir = join(testDir, "project")
    mkdirSync(join(projectDir, ".claude", "commands"), { recursive: true })
    writeFileSync(
      join(projectDir, ".claude", "commands", "test-cmd.md"),
      "---\ndescription: Test\n---\nTest command content.\n",
    )

    const commands = discoverCommandsSync(projectDir)
    const testCmd = commands.find((c) => c.name === "test-cmd")
    expect(testCmd).toBeDefined()
    expect(testCmd?.content).toContain("Test command content.")
  })
})
