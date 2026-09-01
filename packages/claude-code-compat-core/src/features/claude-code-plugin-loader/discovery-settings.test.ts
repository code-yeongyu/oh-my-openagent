import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LoadedPlugin } from "./types"

const originalClaudePluginsHome = process.env.CLAUDE_PLUGINS_HOME
const originalClaudeSettingsPath = process.env.CLAUDE_SETTINGS_PATH
const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeDatabase(pluginsHome: string, database: unknown): void {
  writeFileSync(join(pluginsHome, "installed_plugins.json"), JSON.stringify(database), "utf-8")
}

describe("discoverInstalledPlugins settings", () => {
  beforeEach(() => {
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))

    process.env.CLAUDE_PLUGINS_HOME = createTemporaryDirectory("omo-settings-plugins-")
  })

  afterEach(() => {
    mock.restore()

    if (originalClaudePluginsHome === undefined) {
      delete process.env.CLAUDE_PLUGINS_HOME
    } else {
      process.env.CLAUDE_PLUGINS_HOME = originalClaudePluginsHome
    }
    if (originalClaudeSettingsPath === undefined) {
      delete process.env.CLAUDE_SETTINGS_PATH
    } else {
      process.env.CLAUDE_SETTINGS_PATH = originalClaudeSettingsPath
    }

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("#given Claude settings disables a plugin #when no override is passed #then the plugin is skipped", async () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = createTemporaryDirectory("omo-settings-disabled-install-")
    const settingsPath = join(createTemporaryDirectory("omo-claude-settings-"), "settings.json")
    process.env.CLAUDE_SETTINGS_PATH = settingsPath
    writeFileSync(
      settingsPath,
      JSON.stringify({ enabledPlugins: { "settings-plugin@market": false } }),
      "utf-8",
    )
    writeDatabase(pluginsHome, {
      version: 2,
      plugins: {
        "settings-plugin@market": [
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
    const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-settings-disabled`)
    const discovered = discoverInstalledPlugins({
      pluginsHomeOverride: pluginsHome,
      loadPluginManifestOverride: () => null,
    })

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(0)
  })

  it("#given malformed enabledPlugins settings #when discovery runs #then the plugin still loads", async () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = createTemporaryDirectory("omo-settings-malformed-install-")
    const settingsPath = join(createTemporaryDirectory("omo-claude-settings-"), "settings.json")
    process.env.CLAUDE_SETTINGS_PATH = settingsPath
    writeFileSync(
      settingsPath,
      JSON.stringify({ enabledPlugins: "not-an-object" }),
      "utf-8",
    )
    writeDatabase(pluginsHome, {
      version: 2,
      plugins: {
        "malformed-settings-plugin@market": [
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
    const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-settings-malformed`)
    const discovered = discoverInstalledPlugins({
      pluginsHomeOverride: pluginsHome,
      loadPluginManifestOverride: () => null,
    })

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins.map((plugin: LoadedPlugin) => plugin.pluginKey)).toEqual([
      "malformed-settings-plugin@market",
    ])
  })
})
