import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { LoadedPlugin } from "./types"

// mkdtempSync, never a Date.now()-derived name: consecutive Date.now() calls in one
// process return the same millisecond, so sibling suites collided on one directory and
// each afterEach removed the other's live fixture. On Windows, removing an in-use tree
// blocks until the hook budget expires ("a beforeEach/afterEach hook timed out").
let testDir = ""
let projectDir = ""
let projectSubdirectory = ""
let pluginDir = ""
let mcpConfigPath = ""

describe("loadPluginMcpServers", () => {
  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), "plugin-mcp-loader-test-")))
    projectDir = join(testDir, "project")
    projectSubdirectory = join(projectDir, "packages", "app")
    pluginDir = join(testDir, "plugin")
    mcpConfigPath = join(pluginDir, "mcp.json")
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(projectSubdirectory, { recursive: true })
    mkdirSync(pluginDir, { recursive: true })
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))
  })

  afterEach(() => {
    mock.restore()
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("#given plugin MCP entries with local scope metadata", () => {
    it("#when loading plugin MCP servers from a project subdirectory #then only entries within the same project are included", async () => {
      writeFileSync(
        mcpConfigPath,
        JSON.stringify({
          mcpServers: {
            globalServer: {
              command: "npx",
              args: ["global-plugin-server"],
            },
            matchingLocal: {
              command: "npx",
              args: ["matching-plugin-local"],
              scope: "local",
              projectPath: projectDir,
            },
            nonMatchingLocal: {
              command: "npx",
              args: ["non-matching-plugin-local"],
              scope: "local",
              projectPath: join(projectDir, "other-project"),
            },
            parentLocal: {
              command: "npx",
              args: ["parent-plugin-local"],
              scope: "local",
              projectPath: join(projectSubdirectory, "nested-project"),
            },
          },
        })
      )

      const plugin: LoadedPlugin = {
        name: "demo-plugin",
        version: "1.0.0",
        scope: "project",
        installPath: pluginDir,
        pluginKey: "demo-plugin@test",
        mcpPath: mcpConfigPath,
      }

      const originalCwd = process.cwd()
      process.chdir(projectSubdirectory)

      try {
        const { loadPluginMcpServers } = await import(`./mcp-server-loader?t=${Date.now()}`)
        const servers = await loadPluginMcpServers([plugin])

        expect(servers).toHaveProperty("demo-plugin:globalServer")
        expect(servers).toHaveProperty("demo-plugin:matchingLocal")
        expect(servers).not.toHaveProperty("demo-plugin:nonMatchingLocal")
        expect(servers).not.toHaveProperty("demo-plugin:parentLocal")
      } finally {
        process.chdir(originalCwd)
      }
    })
  })
})
