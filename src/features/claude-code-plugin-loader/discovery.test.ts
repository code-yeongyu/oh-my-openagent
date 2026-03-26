import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { discoverInstalledPlugins } from "./discovery"

const originalClaudePluginsHome = process.env.CLAUDE_PLUGINS_HOME
const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

describe("discoverInstalledPlugins", () => {
  beforeEach(() => {
    const pluginsHome = createTemporaryDirectory("omo-claude-plugins-")
    process.env.CLAUDE_PLUGINS_HOME = pluginsHome
  })

  afterEach(() => {
    if (originalClaudePluginsHome === undefined) {
      delete process.env.CLAUDE_PLUGINS_HOME
    } else {
      process.env.CLAUDE_PLUGINS_HOME = originalClaudePluginsHome
    }

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("preserves scoped package name from npm plugin keys", () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = join(createTemporaryDirectory("omo-plugin-install-"), "@myorg", "my-plugin")
    mkdirSync(installPath, { recursive: true })

    const databasePath = join(pluginsHome, "installed_plugins.json")
    writeFileSync(
      databasePath,
      JSON.stringify({
        version: 2,
        plugins: {
          "@myorg/my-plugin@1.0.0": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
        },
      }),
      "utf-8",
    )

    //#when
    const discovered = discoverInstalledPlugins()

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(1)
    expect(discovered.plugins[0]?.name).toBe("@myorg/my-plugin")
  })

  it("derives package name from file URL plugin keys", () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = join(createTemporaryDirectory("omo-plugin-install-"), "oh-my-opencode")
    mkdirSync(installPath, { recursive: true })

    const databasePath = join(pluginsHome, "installed_plugins.json")
    writeFileSync(
      databasePath,
      JSON.stringify({
        version: 2,
        plugins: {
          "file:///D:/configs/user-configs/.config/opencode/node_modules/oh-my-opencode@latest": [
            {
              scope: "user",
              installPath,
              version: "3.10.0",
              installedAt: "2026-03-20T00:00:00Z",
              lastUpdated: "2026-03-20T00:00:00Z",
            },
          ],
        },
      }),
      "utf-8",
    )

    //#when
    const discovered = discoverInstalledPlugins()

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(1)
    expect(discovered.plugins[0]?.name).toBe("oh-my-opencode")
  })

  it("derives canonical package name from npm plugin keys", () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = join(createTemporaryDirectory("omo-plugin-install-"), "oh-my-openagent")
    mkdirSync(installPath, { recursive: true })

    const databasePath = join(pluginsHome, "installed_plugins.json")
    writeFileSync(
      databasePath,
      JSON.stringify({
        version: 2,
        plugins: {
          "oh-my-openagent@3.13.1": [
            {
              scope: "user",
              installPath,
              version: "3.13.1",
              installedAt: "2026-03-26T00:00:00Z",
              lastUpdated: "2026-03-26T00:00:00Z",
            },
          ],
        },
      }),
      "utf-8",
    )

    //#when
    const discovered = discoverInstalledPlugins()

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(1)
    expect(discovered.plugins[0]?.name).toBe("oh-my-openagent")
  })
})
