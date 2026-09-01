import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { shouldLoadMcpServer } from "./scope-filter"

// mkdtempSync, never a Date.now()-derived name: consecutive Date.now() calls in one
// process return the same millisecond, so sibling suites collided on one directory and
// each afterEach removed the other's live fixture. On Windows, removing an in-use tree
// blocks until the hook budget expires ("a beforeEach/afterEach hook timed out").
let testDir = ""
let testHome = ""

function loaderOptions(cwd = testDir) {
  return { cwd, homeDir: testHome, claudeConfigDir: join(testHome, ".claude") }
}

describe("loadMcpConfigs", () => {
  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), "mcp-scope-filtering-test-")))
    testHome = join(testDir, "home")
    mkdirSync(testHome, { recursive: true })
    mock.module("../../shared/logger", () => ({
      log: () => {},
    }))
  })

  afterEach(() => {
    mock.restore()
    rmSync(testDir, { recursive: true, force: true })
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
        join(testHome, ".claude.json"),
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
              projectPath: testDir,
            },
            nonMatchingLocal: {
              command: "npx",
              args: ["non-matching-local"],
              scope: "local",
              projectPath: join(testDir, "other-project"),
            },
            missingProjectPath: {
              command: "npx",
              args: ["missing-project-path"],
              scope: "local",
            },
          },
        })
      )

      const { loadMcpConfigs } = await import("./loader")
      const result = await loadMcpConfigs([], loaderOptions())

        expect(result.servers).toHaveProperty("globalServer")
        expect(result.servers).toHaveProperty("matchingLocal")
        expect(result.servers).not.toHaveProperty("nonMatchingLocal")
        expect(result.servers).not.toHaveProperty("missingProjectPath")

        expect(result.loadedServers.map((server) => server.name)).toEqual([
          "globalServer",
          "matchingLocal",
        ])
    })
  })
})
