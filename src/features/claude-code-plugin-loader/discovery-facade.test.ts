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

function writeDatabase(pluginsHome: string, installPath: string): void {
  writeFileSync(
    join(pluginsHome, "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "facade-plugin@market": [
          {
            scope: "user",
            installPath,
            version: "1.2.3",
            installedAt: "2026-03-26T00:00:00Z",
            lastUpdated: "2026-03-26T00:00:00Z",
          },
        ],
      },
    }),
    "utf-8",
  )
}

function getClaudePluginsHomeForTest(): string {
  const pluginsHome = process.env.CLAUDE_PLUGINS_HOME
  if (pluginsHome === undefined) {
    throw new TypeError("CLAUDE_PLUGINS_HOME must be set by test setup")
  }
  return pluginsHome
}

describe("discovery facade", () => {
  beforeEach(() => {
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))

    process.env.CLAUDE_PLUGINS_HOME = createTemporaryDirectory("omo-facade-plugins-")
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

  it("#given the public discovery module is imported #when plugin discovery runs #then it preserves legacy facade exports and behavior", async () => {
    //#given
    const pluginsHome = getClaudePluginsHomeForTest()
    const installPath = createTemporaryDirectory("omo-facade-install-")
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true })
    writeFileSync(
      join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "facade-plugin", version: "1.2.3" }),
      "utf-8",
    )
    writeDatabase(pluginsHome, installPath)

    //#when
    const discovery = await import(`./discovery?t=${Date.now()}-facade`)
    const discovered = discovery.discoverInstalledPlugins({
      pluginsHomeOverride: pluginsHome,
    })

    //#then
    expect(discovery.resolveActualInstallPath(installPath, "facade-plugin@market")).toBe(
      installPath,
    )
    expect(discovery.loadPluginManifest(installPath)?.name).toBe("facade-plugin")
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins.map((plugin) => plugin.pluginKey)).toEqual([
      "facade-plugin@market",
    ])
  })
})
