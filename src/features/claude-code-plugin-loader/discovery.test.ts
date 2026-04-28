import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// NOTE: Do NOT import discoverInstalledPlugins at top level.
// loader.test.ts in the same directory mocks "./discovery" with name: "demo",
// and when run-ci-tests.ts groups this directory together, that mock leaks.
// Dynamic import inside each test avoids the contamination.

const originalClaudePluginsHome = process.env.CLAUDE_PLUGINS_HOME
const temporaryDirectories: string[] = []
const originalCwd = process.cwd()

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeDatabase(pluginsHome: string, database: unknown): void {
  writeFileSync(join(pluginsHome, "installed_plugins.json"), JSON.stringify(database), "utf-8")
}

function createInstallPath(prefix: string): string {
  return createTemporaryDirectory(prefix)
}

describe("discoverInstalledPlugins", () => {
  beforeEach(() => {
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))

    const pluginsHome = createTemporaryDirectory("omo-claude-plugins-")
    process.env.CLAUDE_PLUGINS_HOME = pluginsHome
  })

  afterEach(() => {
    mock.restore()

    if (originalClaudePluginsHome === undefined) {
      delete process.env.CLAUDE_PLUGINS_HOME
    } else {
      process.env.CLAUDE_PLUGINS_HOME = originalClaudePluginsHome
    }

    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd)
    }

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("preserves scoped package name from npm plugin keys", async () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPathBase = createTemporaryDirectory("omo-scoped-plugin-")
    const installPath = join(installPathBase, "@myorg", "my-plugin")
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
    const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-1`)
    const discovered = discoverInstalledPlugins({
      pluginsHomeOverride: pluginsHome,
      loadPluginManifestOverride: () => null,
    })

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(1)
    expect(discovered.plugins[0]?.name).toBe("@myorg/my-plugin")
  })

  it("derives package name from file URL plugin keys", async () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = createTemporaryDirectory("omo-fileurl-plugin-")

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
    const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-2`)
    const discovered = discoverInstalledPlugins({
      pluginsHomeOverride: pluginsHome,
      loadPluginManifestOverride: () => null,
    })

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(1)
    expect(discovered.plugins[0]?.name).toBe("oh-my-opencode")
  })

  it("derives canonical package name from npm plugin keys", async () => {
    //#given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
    const installPath = createTemporaryDirectory("omo-npm-plugin-")

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
    const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-3`)
    const discovered = discoverInstalledPlugins({
      pluginsHomeOverride: pluginsHome,
      loadPluginManifestOverride: () => null,
    })

    //#then
    expect(discovered.errors).toHaveLength(0)
    expect(discovered.plugins).toHaveLength(1)
    expect(discovered.plugins[0]?.name).toBe("oh-my-openagent")
  })

  describe("#given project-scoped entries in v1 format", () => {
    it("#when cwd matches projectPath #then the plugin loads", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v1-project-match-")
      const installPath = createInstallPath("omo-v1-install-")
      writeDatabase(pluginsHome, {
        version: 1,
        plugins: {
          "project-plugin@market": {
            scope: "project",
            projectPath: projectDirectory,
            installPath,
            version: "1.0.0",
            installedAt: "2026-03-25T00:00:00Z",
            lastUpdated: "2026-03-25T00:00:00Z",
          },
        },
      })
      process.chdir(projectDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v1-match`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.name).toBe("project-plugin")
    })

    it("#when cwd is a subdirectory of projectPath #then the plugin loads", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v1-project-sub-")
      const subdirectory = join(projectDirectory, "packages", "app")
      mkdirSync(subdirectory, { recursive: true })
      const installPath = createInstallPath("omo-v1-install-")
      writeDatabase(pluginsHome, {
        version: 1,
        plugins: {
          "sub-plugin@market": {
            scope: "project",
            projectPath: projectDirectory,
            installPath,
            version: "1.0.0",
            installedAt: "2026-03-25T00:00:00Z",
            lastUpdated: "2026-03-25T00:00:00Z",
          },
        },
      })
      process.chdir(subdirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v1-sub`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.name).toBe("sub-plugin")
    })

    it("#when cwd does not match projectPath #then the plugin is skipped", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v1-project-miss-")
      const otherDirectory = createTemporaryDirectory("omo-v1-other-")
      const installPath = createInstallPath("omo-v1-install-")
      writeDatabase(pluginsHome, {
        version: 1,
        plugins: {
          "outside-plugin@market": {
            scope: "project",
            projectPath: projectDirectory,
            installPath,
            version: "1.0.0",
            installedAt: "2026-03-25T00:00:00Z",
            lastUpdated: "2026-03-25T00:00:00Z",
          },
        },
      })
      process.chdir(otherDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v1-miss`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(0)
    })

    it("#when projectPath is missing #then the plugin is skipped", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const installPath = createInstallPath("omo-v1-install-")
      writeDatabase(pluginsHome, {
        version: 1,
        plugins: {
          "no-path-plugin@market": {
            scope: "project",
            installPath,
            version: "1.0.0",
            installedAt: "2026-03-25T00:00:00Z",
            lastUpdated: "2026-03-25T00:00:00Z",
          },
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v1-noproj`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(0)
    })

    it("#when scope is user #then it always loads regardless of cwd", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const unrelatedDirectory = createTemporaryDirectory("omo-v1-unrelated-")
      const installPath = createInstallPath("omo-v1-install-")
      writeDatabase(pluginsHome, {
        version: 1,
        plugins: {
          "user-plugin@market": {
            scope: "user",
            installPath,
            version: "1.0.0",
            installedAt: "2026-03-25T00:00:00Z",
            lastUpdated: "2026-03-25T00:00:00Z",
          },
        },
      })
      process.chdir(unrelatedDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v1-user`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.name).toBe("user-plugin")
    })
  })

  describe("#given project and local scoped entries in v2 format", () => {
    it("#when cwd matches project-scoped projectPath #then it loads while non-matching entries are dropped", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v2-project-")
      const otherDirectory = createTemporaryDirectory("omo-v2-other-")
      const matchingInstall = createInstallPath("omo-v2-match-install-")
      const missingInstall = createInstallPath("omo-v2-miss-install-")
      const userInstall = createInstallPath("omo-v2-user-install-")
      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "matching-project@market": [
            {
              scope: "project",
              projectPath: projectDirectory,
              installPath: matchingInstall,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
          "other-project@market": [
            {
              scope: "project",
              projectPath: otherDirectory,
              installPath: missingInstall,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
          "global-user@market": [
            {
              scope: "user",
              installPath: userInstall,
              version: "2.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
        },
      })
      process.chdir(projectDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v2-mix`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      const names = discovered.plugins.map((plugin) => plugin.name).sort()
      expect(names).toEqual(["global-user", "matching-project"])
    })

    it("#when scope is local and cwd matches projectPath #then it loads", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v2-local-match-")
      const installPath = createInstallPath("omo-v2-local-install-")
      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "local-plugin@market": [
            {
              scope: "local",
              projectPath: projectDirectory,
              installPath,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
        },
      })
      process.chdir(projectDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v2-local-match`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.name).toBe("local-plugin")
    })

    it("#when scope is local and cwd does not match projectPath #then it is skipped", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v2-local-miss-")
      const otherDirectory = createTemporaryDirectory("omo-v2-local-other-")
      const installPath = createInstallPath("omo-v2-local-install-")
      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "local-plugin@market": [
            {
              scope: "local",
              projectPath: projectDirectory,
              installPath,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
        },
      })
      process.chdir(otherDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v2-local-miss`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(0)
    })

    it("#when multiple installations are present #then only the first is considered and scope filtering still applies", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v2-multi-")
      const otherDirectory = createTemporaryDirectory("omo-v2-multi-other-")
      const primaryInstall = createInstallPath("omo-v2-multi-primary-")
      const secondaryInstall = createInstallPath("omo-v2-multi-secondary-")
      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "multi-plugin@market": [
            {
              scope: "project",
              projectPath: otherDirectory,
              installPath: primaryInstall,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
            {
              scope: "project",
              projectPath: projectDirectory,
              installPath: secondaryInstall,
              version: "2.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
        },
      })
      process.chdir(projectDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v2-multi`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then — existing behavior keeps only the first entry; with scope filter it is
      // (correctly) skipped because the first entry points at a different project.
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(0)
    })
  })

  describe("#given project and local scoped entries in v3 flat-array format", () => {
    it("#when cwd matches projectPath #then projectPath flows through and the plugin loads", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v3-match-")
      const installPath = createInstallPath("omo-v3-install-")
      writeDatabase(pluginsHome, [
        {
          name: "v3-project-plugin",
          marketplace: "market",
          scope: "project",
          projectPath: projectDirectory,
          installPath,
          version: "1.0.0",
          lastUpdated: "2026-03-25T00:00:00Z",
        },
      ])
      process.chdir(projectDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v3-match`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.name).toBe("v3-project-plugin")
    })

    it("#when cwd does not match projectPath #then the plugin is skipped", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-v3-miss-")
      const otherDirectory = createTemporaryDirectory("omo-v3-miss-other-")
      const installPath = createInstallPath("omo-v3-install-")
      writeDatabase(pluginsHome, [
        {
          name: "v3-skipped-plugin",
          marketplace: "market",
          scope: "project",
          projectPath: projectDirectory,
          installPath,
          version: "1.0.0",
          lastUpdated: "2026-03-25T00:00:00Z",
        },
        {
          name: "v3-user-plugin",
          marketplace: "market",
          scope: "user",
          installPath: createInstallPath("omo-v3-user-install-"),
          version: "2.0.0",
          lastUpdated: "2026-03-25T00:00:00Z",
        },
      ])
      process.chdir(otherDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-v3-miss`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.name).toBe("v3-user-plugin")
    })
  })

  describe("#given enabledPluginsOverride combined with scope filtering", () => {
    it("#when a project-scoped plugin is disabled via override #then it is still skipped even if cwd would match", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-enabled-proj-")
      const installPath = createInstallPath("omo-enabled-install-")
      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "gated-plugin@market": [
            {
              scope: "project",
              projectPath: projectDirectory,
              installPath,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
        },
      })
      process.chdir(projectDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-enabled-off`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
        enabledPluginsOverride: { "gated-plugin@market": false },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(0)
    })

    it("#when a project-scoped plugin is enabled and cwd matches #then it loads", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const projectDirectory = createTemporaryDirectory("omo-enabled-match-")
      const installPath = createInstallPath("omo-enabled-match-install-")
      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "enabled-plugin@market": [
            {
              scope: "project",
              projectPath: projectDirectory,
              installPath,
              version: "1.0.0",
              installedAt: "2026-03-25T00:00:00Z",
              lastUpdated: "2026-03-25T00:00:00Z",
            },
          ],
        },
      })
      process.chdir(projectDirectory)

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-enabled-on`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        loadPluginManifestOverride: () => null,
        enabledPluginsOverride: { "enabled-plugin@market": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.name).toBe("enabled-plugin")
    })
  })

  describe("#given installed_plugins.json points to a stale version directory", () => {
    function writePluginManifest(installPath: string, manifest: Record<string, unknown>): void {
      const manifestDir = join(installPath, ".claude-plugin")
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(join(manifestDir, "plugin.json"), JSON.stringify(manifest), "utf-8")
    }

    it("#when configured installPath ends in 'unknown' but a sibling version dir has a plugin manifest #then it is recovered without an error", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-cc-plus-cache-")
      const pluginRoot = join(cacheRoot, "cc-plus-marketplace", "cc-plus")
      const realInstallPath = join(pluginRoot, "0.1.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      mkdirSync(realInstallPath, { recursive: true })
      writePluginManifest(realInstallPath, { name: "cc-plus", version: "0.1.0" })

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "cc-plus@cc-plus-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-stale-unknown`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "cc-plus@cc-plus-marketplace": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.installPath).toBe(realInstallPath)
      expect(discovered.plugins[0]?.name).toBe("cc-plus")
    })

    it("#when configured installPath is missing AND no sibling has a plugin manifest #then the original 'path does not exist' error is preserved", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-no-manifest-cache-")
      const pluginRoot = join(cacheRoot, "broken-plugin-marketplace", "broken-plugin")
      const siblingDir = join(pluginRoot, "0.1.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      mkdirSync(siblingDir, { recursive: true })

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "broken-plugin@broken-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-no-manifest`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "broken-plugin@broken-plugin-marketplace": true },
      })

      //#then
      expect(discovered.plugins).toHaveLength(0)
      expect(discovered.errors).toHaveLength(1)
      expect(discovered.errors[0]?.installPath).toBe(configuredInstallPath)
      expect(discovered.errors[0]?.error).toContain("does not exist")
    })

    it("#when only an 'unknown' sibling exists with a manifest #then it is still picked rather than reporting an error", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-only-unknown-cache-")
      const pluginRoot = join(cacheRoot, "weird-plugin-marketplace", "weird-plugin")
      const onlySibling = join(pluginRoot, "unknown")
      const configuredInstallPath = join(pluginRoot, "ghost")
      mkdirSync(onlySibling, { recursive: true })
      writePluginManifest(onlySibling, { name: "weird-plugin", version: "unknown" })

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "weird-plugin@weird-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "ghost",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-only-unknown`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "weird-plugin@weird-plugin-marketplace": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.installPath).toBe(onlySibling)
    })

    it("#when the recovered version dir uses the legacy root-level plugin.json layout #then it is recognized and the manifest is loaded", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-legacy-manifest-cache-")
      const pluginRoot = join(cacheRoot, "legacy-plugin-marketplace", "legacy-plugin")
      const realInstallPath = join(pluginRoot, "0.1.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      mkdirSync(realInstallPath, { recursive: true })
      writeFileSync(
        join(realInstallPath, "plugin.json"),
        JSON.stringify({ name: "legacy-plugin", version: "0.1.0" }),
        "utf-8",
      )

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "legacy-plugin@legacy-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-legacy-manifest`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "legacy-plugin@legacy-plugin-marketplace": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.installPath).toBe(realInstallPath)
      expect(discovered.plugins[0]?.name).toBe("legacy-plugin")
      expect(discovered.plugins[0]?.version).toBe("0.1.0")
    })

    it("#when the configured installPath exists #then it is used as-is without scanning siblings", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-existing-path-cache-")
      const pluginRoot = join(cacheRoot, "ok-plugin-marketplace", "ok-plugin")
      const configuredInstallPath = join(pluginRoot, "1.2.3")
      const otherSibling = join(pluginRoot, "0.0.1")
      mkdirSync(configuredInstallPath, { recursive: true })
      writePluginManifest(configuredInstallPath, { name: "ok-plugin", version: "1.2.3" })
      mkdirSync(otherSibling, { recursive: true })
      writePluginManifest(otherSibling, { name: "ok-plugin", version: "0.0.1" })

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "ok-plugin@ok-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "1.2.3",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-existing-path`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "ok-plugin@ok-plugin-marketplace": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.installPath).toBe(configuredInstallPath)
    })

    it("#when multiple non-'unknown' semver siblings are present #then the highest version is picked deterministically", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-multi-version-cache-")
      const pluginRoot = join(cacheRoot, "multi-ver-marketplace", "multi-ver")
      const oldInstallPath = join(pluginRoot, "0.1.0")
      const middleInstallPath = join(pluginRoot, "0.5.3")
      const newInstallPath = join(pluginRoot, "1.2.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      for (const dir of [oldInstallPath, middleInstallPath, newInstallPath]) {
        mkdirSync(join(dir, ".claude-plugin"), { recursive: true })
        writeFileSync(
          join(dir, ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "multi-ver", version: dir.split("/").pop() }),
          "utf-8",
        )
      }

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "multi-ver@multi-ver-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-multi-version`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "multi-ver@multi-ver-marketplace": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.installPath).toBe(newInstallPath)
      expect(discovered.plugins[0]?.version).toBe("1.2.0")
    })

    it("#when a sibling directory exists with a manifest whose 'name' does NOT match the plugin key #then it is rejected and the error surfaces", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-wrong-name-cache-")
      const pluginRoot = join(cacheRoot, "target-plugin-marketplace", "target-plugin")
      const maliciousSibling = join(pluginRoot, "0.1.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      mkdirSync(join(maliciousSibling, ".claude-plugin"), { recursive: true })
      writeFileSync(
        join(maliciousSibling, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "different-plugin", version: "0.1.0" }),
        "utf-8",
      )

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "target-plugin@target-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-wrong-name`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "target-plugin@target-plugin-marketplace": true },
      })

      //#then
      expect(discovered.plugins).toHaveLength(0)
      expect(discovered.errors).toHaveLength(1)
      expect(discovered.errors[0]?.installPath).toBe(configuredInstallPath)
    })

    it("#when two siblings share the same X.Y.Z prefix but one is a prerelease #then the plain version wins deterministically", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-prerelease-cache-")
      const pluginRoot = join(cacheRoot, "tie-plugin-marketplace", "tie-plugin")
      const plainInstallPath = join(pluginRoot, "1.2.0")
      const prereleaseInstallPath = join(pluginRoot, "1.2.0-beta.1")
      const configuredInstallPath = join(pluginRoot, "unknown")
      for (const dir of [plainInstallPath, prereleaseInstallPath]) {
        mkdirSync(join(dir, ".claude-plugin"), { recursive: true })
        writeFileSync(
          join(dir, ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "tie-plugin", version: dir.split("/").pop() }),
          "utf-8",
        )
      }

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "tie-plugin@tie-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-prerelease`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "tie-plugin@tie-plugin-marketplace": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.installPath).toBe(plainInstallPath)
    })

    it("#when a sibling has a malformed manifest that cannot be parsed #then it is rejected under strict name-match", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-malformed-cache-")
      const pluginRoot = join(cacheRoot, "strict-plugin-marketplace", "strict-plugin")
      const malformedSibling = join(pluginRoot, "0.1.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      mkdirSync(join(malformedSibling, ".claude-plugin"), { recursive: true })
      writeFileSync(
        join(malformedSibling, ".claude-plugin", "plugin.json"),
        "{ this is not valid json",
        "utf-8",
      )

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "strict-plugin@strict-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-malformed`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "strict-plugin@strict-plugin-marketplace": true },
      })

      //#then
      expect(discovered.plugins).toHaveLength(0)
      expect(discovered.errors).toHaveLength(1)
      expect(discovered.errors[0]?.installPath).toBe(configuredInstallPath)
    })

    it("#when a sibling's manifest lacks a 'name' field #then it is rejected under strict name-match", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-noname-cache-")
      const pluginRoot = join(cacheRoot, "named-plugin-marketplace", "named-plugin")
      const nameMissingSibling = join(pluginRoot, "0.1.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      mkdirSync(join(nameMissingSibling, ".claude-plugin"), { recursive: true })
      writeFileSync(
        join(nameMissingSibling, ".claude-plugin", "plugin.json"),
        JSON.stringify({ version: "0.1.0" }),
        "utf-8",
      )

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "named-plugin@named-plugin-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "unknown",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-noname`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "named-plugin@named-plugin-marketplace": true },
      })

      //#then
      expect(discovered.plugins).toHaveLength(0)
      expect(discovered.errors).toHaveLength(1)
      expect(discovered.errors[0]?.installPath).toBe(configuredInstallPath)
    })

    it("#when installation.version is an empty string and manifest.version is also empty #then resolvedVersion falls back to 'unknown' not ''", async () => {
      //#given
      const pluginsHome = process.env.CLAUDE_PLUGINS_HOME as string
      const cacheRoot = createTemporaryDirectory("omo-empty-version-cache-")
      const pluginRoot = join(cacheRoot, "empty-ver-marketplace", "empty-ver")
      const realInstallPath = join(pluginRoot, "0.1.0")
      const configuredInstallPath = join(pluginRoot, "unknown")
      mkdirSync(join(realInstallPath, ".claude-plugin"), { recursive: true })
      writeFileSync(
        join(realInstallPath, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "empty-ver", version: "" }),
        "utf-8",
      )

      writeDatabase(pluginsHome, {
        version: 2,
        plugins: {
          "empty-ver@empty-ver-marketplace": [
            {
              scope: "user",
              installPath: configuredInstallPath,
              version: "",
              installedAt: "2025-11-01T13:05:32.029Z",
              lastUpdated: "2025-11-01T22:22:30.000Z",
            },
          ],
        },
      })

      //#when
      const { discoverInstalledPlugins } = await import(`./discovery?t=${Date.now()}-empty-version`)
      const discovered = discoverInstalledPlugins({
        pluginsHomeOverride: pluginsHome,
        enabledPluginsOverride: { "empty-ver@empty-ver-marketplace": true },
      })

      //#then
      expect(discovered.errors).toHaveLength(0)
      expect(discovered.plugins).toHaveLength(1)
      expect(discovered.plugins[0]?.version).toBe("unknown")
    })
  })
})
