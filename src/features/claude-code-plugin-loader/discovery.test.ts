const { afterEach, beforeEach, describe, expect, it } = require("bun:test")
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("fs")
const { join } = require("path")
const { tmpdir } = require("os")
const { discoverInstalledPlugins } = require("./discovery")

describe("discoverInstalledPlugins", () => {
  let pluginsHome = ""
  const originalPluginsHome = process.env.CLAUDE_PLUGINS_HOME
  const originalSettingsPath = process.env.CLAUDE_SETTINGS_PATH

  beforeEach(() => {
    pluginsHome = mkdtempSync(join(tmpdir(), "omo-plugin-loader-"))
    process.env.CLAUDE_PLUGINS_HOME = pluginsHome
    process.env.CLAUDE_SETTINGS_PATH = join(pluginsHome, "settings.json")
  })

  afterEach(() => {
    if (originalPluginsHome === undefined) {
      delete process.env.CLAUDE_PLUGINS_HOME
    } else {
      process.env.CLAUDE_PLUGINS_HOME = originalPluginsHome
    }

    if (originalSettingsPath === undefined) {
      delete process.env.CLAUDE_SETTINGS_PATH
    } else {
      process.env.CLAUDE_SETTINGS_PATH = originalSettingsPath
    }

    if (pluginsHome) {
      rmSync(pluginsHome, { recursive: true, force: true })
    }
  })

  describe("#given installed_plugins.json is missing", () => {
    it("#then injects a managed default plugin entry", () => {
      const result = discoverInstalledPlugins()

      expect(result.errors).toHaveLength(0)
      expect(result.plugins).toHaveLength(1)

      const plugin = result.plugins[0]
      expect(plugin?.name).toBe("OpenCodeBuiltinDefault")
      expect(plugin?.scope).toBe("managed")
      expect(plugin?.installPath).toBe(join(pluginsHome, "builtin-default-plugin"))
      expect(plugin?.pluginKey).toBe("opencode-builtin-default@managed")
    })
  })

  describe("#given installed_plugins.json exists", () => {
    it("#then returns discovered installed plugins instead of default injection", () => {
      const installPath = join(pluginsHome, "example-plugin")
      mkdirSync(installPath, { recursive: true })

      const db = {
        version: 1,
        plugins: {
          "example-plugin@market": {
            scope: "project",
            installPath,
            version: "1.0.0",
            installedAt: "2026-01-01T00:00:00.000Z",
            lastUpdated: "2026-01-01T00:00:00.000Z",
          },
        },
      }
      writeFileSync(join(pluginsHome, "installed_plugins.json"), JSON.stringify(db))

      const result = discoverInstalledPlugins()

      expect(result.errors).toHaveLength(0)
      expect(result.plugins).toHaveLength(1)
      expect(result.plugins[0]?.pluginKey).toBe("example-plugin@market")
      expect(result.plugins[0]?.scope).toBe("project")
    })
  })
})

export {}
