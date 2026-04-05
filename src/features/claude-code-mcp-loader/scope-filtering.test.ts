import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { shouldLoadMcpServer } from "./scope-filter"

const TEST_DIR = join(tmpdir(), `mcp-scope-filtering-test-${Date.now()}`)
const TEST_HOME = join(TEST_DIR, "home")

describe("loadMcpConfigs", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_HOME, { recursive: true })
    mock.module("os", () => ({
      homedir: () => TEST_HOME,
      tmpdir,
    }))
    mock.module("../../shared/claude-config-dir", () => ({
      getClaudeConfigDir: () => join(TEST_HOME, ".claude"),
    }))
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("#given local MCP scope checks", () => {
    it("#when cwd exactly matches project path #then the server is loaded", () => {
      const result = shouldLoadMcpServer(
        {
          scope: "local",
          projectPath: "/tmp/repo",
        },
        "/tmp/repo"
      )

      expect(result).toBe(true)
    })

    it("#when cwd is a subdirectory of project path #then the server is loaded", () => {
      const result = shouldLoadMcpServer(
        {
          scope: "local",
          projectPath: "/tmp/repo",
        },
        "/tmp/repo/packages/app"
      )

      expect(result).toBe(true)
    })

    it("#when cwd does not overlap project path #then the server is not loaded", () => {
      const result = shouldLoadMcpServer(
        {
          scope: "local",
          projectPath: "/tmp/repo",
        },
        "/tmp/other"
      )

      expect(result).toBe(false)
    })

    it("#when cwd is the parent of project path #then the server is not loaded", () => {
      const result = shouldLoadMcpServer(
        {
          scope: "local",
          projectPath: "/tmp/repo",
        },
        "/tmp"
      )

      expect(result).toBe(false)
    })
  })

  describe("#given user-scoped MCP entries with local scope metadata", () => {
    it("#when loading configs #then only servers matching the current project path are loaded", async () => {
      writeFileSync(
        join(TEST_HOME, ".claude.json"),
        JSON.stringify({
          mcpServers: {
            globalServer: {
              command: "npx",
              args: ["global-server"],
            },
            matchingLocal: {
              command: "npx",
              args: ["matching-local"],
              scope: "local",
              projectPath: TEST_DIR,
            },
            nonMatchingLocal: {
              command: "npx",
              args: ["non-matching-local"],
              scope: "local",
              projectPath: join(TEST_DIR, "other-project"),
            },
            missingProjectPath: {
              command: "npx",
              args: ["missing-project-path"],
              scope: "local",
            },
          },
        })
      )

      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const { loadMcpConfigs } = await import("./loader")
        const result = await loadMcpConfigs()

        expect(result.servers).toHaveProperty("globalServer")
        expect(result.servers).toHaveProperty("matchingLocal")
        expect(result.servers).not.toHaveProperty("nonMatchingLocal")
        expect(result.servers).not.toHaveProperty("missingProjectPath")

        expect(result.loadedServers.map((server) => server.name)).toEqual([
          "globalServer",
          "matchingLocal",
        ])
      } finally {
        process.chdir(originalCwd)
      }
    })
  })
})
