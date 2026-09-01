import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const originalClaudePluginsHome = process.env.CLAUDE_PLUGINS_HOME
const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeDatabase(pluginsHome: string, database: unknown): void {
  writeFileSync(join(pluginsHome, "installed_plugins.json"), JSON.stringify(database), "utf-8")
}

describe("discoverInstalledPlugins components", () => {
  beforeEach(() => {
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))

    process.env.CLAUDE_PLUGINS_HOME = createTemporaryDirectory("omo-component-plugins-")
  })

  afterEach(() => {
    mock.restore()

    if (originalClaudePluginsHome === undefined) {
      delete process.env.CLAUDE_PLUGINS_HOME
    } else {
      process.env.CLAUDE_PLUGINS_HOME = originalClaudePluginsHome
    }

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("#given plugin component folders and files exist #when discovery loads the plugin #then component paths are populated", async () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = createTemporaryDirectory("omo-component-paths-")
    mkdirSync(join(installPath, "commands"), { recursive: true })
    mkdirSync(join(installPath, "agents"), { recursive: true })
    mkdirSync(join(installPath, "skills"), { recursive: true })
    mkdirSync(join(installPath, "hooks"), { recursive: true })
    writeFileSync(join(installPath, "hooks", "hooks.json"), "{}", "utf-8")
    writeFileSync(join(installPath, ".mcp.json"), "{}", "utf-8")
    writeDatabase(pluginsHome, {
      version: 2,
      plugins: {
        "component-plugin@market": [
          {
            scope: "user",
            installPath,
            version: "1.0.0",
            installedAt: "2026-03-26T00:00:00Z",
            lastUpdated: "2026-03-26T00:00:00Z",
          },
        ],
      },
    })

    //#when
    const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-component-paths`)
    const discovered = discoverInstalledPlugins({
      pluginsHomeOverride: pluginsHome,
      loadPluginManifestOverride: () => ({ name: "component-plugin", version: "1.0.0" }),
    })

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(1)
    expect(discovered.plugins[0]?.commandsDir).toBe(join(installPath, "commands"))
    expect(discovered.plugins[0]?.agentsDir).toBe(join(installPath, "agents"))
    expect(discovered.plugins[0]?.skillsDir).toBe(join(installPath, "skills"))
    expect(discovered.plugins[0]?.hooksPath).toBe(join(installPath, "hooks", "hooks.json"))
    expect(discovered.plugins[0]?.mcpPath).toBe(join(installPath, ".mcp.json"))
  })
})
