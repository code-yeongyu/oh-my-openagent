import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_DIR = join(tmpdir(), "mcp-loader-test-" + Date.now())

describe("getSystemMcpServerNames", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })

    // Isolate tests from real user environment (e.g., ~/.claude.json).
    // loader.ts reads user-level config via os.homedir() + getClaudeConfigDir().
    mock.module("os", () => ({
      homedir: () => TEST_DIR,
      tmpdir,
    }))

    mock.module("../../shared", () => ({
      getClaudeConfigDir: () => join(TEST_DIR, ".claude"),
    }))
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("returns empty set when no .mcp.json files exist", async () => {
    // given
    const originalCwd = process.cwd()
    process.chdir(TEST_DIR)

    try {
      // when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // then
      expect(names).toBeInstanceOf(Set)
      expect(names.size).toBe(0)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("returns server names from project .mcp.json", async () => {
    // given
    const mcpConfig = {
      mcpServers: {
        playwright: {
          command: "npx",
          args: ["@playwright/mcp@latest"],
        },
        sqlite: {
          command: "uvx",
          args: ["mcp-server-sqlite"],
        },
      },
    }
    writeFileSync(join(TEST_DIR, ".mcp.json"), JSON.stringify(mcpConfig))

    const originalCwd = process.cwd()
    process.chdir(TEST_DIR)

    try {
      // when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // then
      expect(names.has("playwright")).toBe(true)
      expect(names.has("sqlite")).toBe(true)
      expect(names.size).toBe(2)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("returns server names from .claude/.mcp.json", async () => {
    // given
    mkdirSync(join(TEST_DIR, ".claude"), { recursive: true })
    const mcpConfig = {
      mcpServers: {
        memory: {
          command: "npx",
          args: ["-y", "@anthropic-ai/mcp-server-memory"],
        },
      },
    }
    writeFileSync(join(TEST_DIR, ".claude", ".mcp.json"), JSON.stringify(mcpConfig))

    const originalCwd = process.cwd()
    process.chdir(TEST_DIR)

    try {
      // when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // then
      expect(names.has("memory")).toBe(true)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("excludes disabled MCP servers", async () => {
    // given
    const mcpConfig = {
      mcpServers: {
        playwright: {
          command: "npx",
          args: ["@playwright/mcp@latest"],
          disabled: true,
        },
        active: {
          command: "npx",
          args: ["some-mcp"],
        },
      },
    }
    writeFileSync(join(TEST_DIR, ".mcp.json"), JSON.stringify(mcpConfig))

    const originalCwd = process.cwd()
    process.chdir(TEST_DIR)

    try {
      // when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // then
      expect(names.has("playwright")).toBe(false)
      expect(names.has("active")).toBe(true)
    } finally {
      process.chdir(originalCwd)
    }
  })

   it("merges server names from multiple .mcp.json files", async () => {
     // given
     mkdirSync(join(TEST_DIR, ".claude"), { recursive: true })
     
     const projectMcp = {
       mcpServers: {
         playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
       },
     }
     const localMcp = {
       mcpServers: {
         memory: { command: "npx", args: ["-y", "@anthropic-ai/mcp-server-memory"] },
       },
     }
     
     writeFileSync(join(TEST_DIR, ".mcp.json"), JSON.stringify(projectMcp))
     writeFileSync(join(TEST_DIR, ".claude", ".mcp.json"), JSON.stringify(localMcp))

     const originalCwd = process.cwd()
     process.chdir(TEST_DIR)

     try {
       // when
       const { getSystemMcpServerNames } = await import("./loader")
       const names = getSystemMcpServerNames()

       // then
       expect(names.has("playwright")).toBe(true)
       expect(names.has("memory")).toBe(true)
     } finally {
       process.chdir(originalCwd)
     }
   })

    it("reads user-level MCP config from ~/.claude.json", async () => {
      // given
      const userConfigPath = join(TEST_DIR, ".claude.json")
      const userMcpConfig = {
        mcpServers: {
          "user-server": {
            command: "npx",
            args: ["user-mcp-server"],
          },
        },
      }

      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        mock.module("os", () => ({
          homedir: () => TEST_DIR,
          tmpdir,
        }))

        writeFileSync(userConfigPath, JSON.stringify(userMcpConfig))

        const { getSystemMcpServerNames } = await import("./loader")
        const names = getSystemMcpServerNames()

        expect(names.has("user-server")).toBe(true)
      } finally {
        process.chdir(originalCwd)
        rmSync(userConfigPath, { force: true })
      }
    })

    it("reads both ~/.claude.json and ~/.claude/.mcp.json for user scope", async () => {
      // given: simulate both user-level config files
      const userClaudeJson = join(TEST_DIR, ".claude.json")
      const claudeDir = join(TEST_DIR, ".claude")
      const claudeDirMcpJson = join(claudeDir, ".mcp.json")

      mkdirSync(claudeDir, { recursive: true })

      // ~/.claude.json has server-a
      writeFileSync(userClaudeJson, JSON.stringify({
        mcpServers: {
          "server-from-claude-json": {
            command: "npx",
            args: ["server-a"],
          },
        },
      }))

      // ~/.claude/.mcp.json has server-b (CLI-managed)
      writeFileSync(claudeDirMcpJson, JSON.stringify({
        mcpServers: {
          "server-from-mcp-json": {
            command: "npx",
            args: ["server-b"],
          },
        },
      }))

      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        mock.module("os", () => ({
          homedir: () => TEST_DIR,
          tmpdir,
        }))

        // Also mock getClaudeConfigDir to point to our test .claude dir
        mock.module("../../shared", () => ({
          getClaudeConfigDir: () => claudeDir,
        }))

        const { getSystemMcpServerNames } = await import("./loader")
        const names = getSystemMcpServerNames()

        // Both sources should be merged
        expect(names.has("server-from-claude-json")).toBe(true)
        expect(names.has("server-from-mcp-json")).toBe(true)
      } finally {
        process.chdir(originalCwd)
      }
    })
})
