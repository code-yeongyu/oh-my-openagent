import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { LoadedPlugin } from "./types"

const TEST_DIR = join(tmpdir(), `plugin-mcp-loader-test-${Date.now()}`)
const PROJECT_DIR = join(TEST_DIR, "project")
const PROJECT_SUBDIRECTORY = join(PROJECT_DIR, "packages", "app")
const PLUGIN_DIR = join(TEST_DIR, "plugin")
const MCP_CONFIG_PATH = join(PLUGIN_DIR, "mcp.json")

describe("loadPluginMcpServers", () => {
  beforeEach(() => {
    mkdirSync(PROJECT_DIR, { recursive: true })
    mkdirSync(PROJECT_SUBDIRECTORY, { recursive: true })
    mkdirSync(PLUGIN_DIR, { recursive: true })
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("#given plugin MCP entries with local scope metadata", () => {
    it("#when loading plugin MCP servers from a project subdirectory #then only entries within the same project are included", async () => {
      writeFileSync(
        MCP_CONFIG_PATH,
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
              projectPath: PROJECT_DIR,
            },
            nonMatchingLocal: {
              command: "npx",
              args: ["non-matching-plugin-local"],
              scope: "local",
              projectPath: join(PROJECT_DIR, "other-project"),
            },
            parentLocal: {
              command: "npx",
              args: ["parent-plugin-local"],
              scope: "local",
              projectPath: join(PROJECT_SUBDIRECTORY, "nested-project"),
            },
          },
        })
      )

      const plugin: LoadedPlugin = {
        name: "demo-plugin",
        version: "1.0.0",
        scope: "project",
        installPath: PLUGIN_DIR,
        pluginKey: "demo-plugin@test",
        mcpPath: MCP_CONFIG_PATH,
      }

      const originalCwd = process.cwd()
      process.chdir(PROJECT_SUBDIRECTORY)

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
