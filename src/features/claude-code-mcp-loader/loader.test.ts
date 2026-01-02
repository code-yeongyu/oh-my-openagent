import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_DIR = join(tmpdir(), "mcp-loader-test-" + Date.now())

describe("getSystemMcpServerNames", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("returns empty set when no .mcp.json files exist", async () => {
    // #given
    const originalCwd = process.cwd()
    process.chdir(TEST_DIR)

    try {
      // #when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // #then
      expect(names).toBeInstanceOf(Set)
      expect(names.size).toBe(0)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("returns server names from project .mcp.json", async () => {
    // #given
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
      // #when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // #then
      expect(names.has("playwright")).toBe(true)
      expect(names.has("sqlite")).toBe(true)
      expect(names.size).toBe(2)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("returns server names from .claude/.mcp.json", async () => {
    // #given
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
      // #when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // #then
      expect(names.has("memory")).toBe(true)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("excludes disabled MCP servers", async () => {
    // #given
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
      // #when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // #then
      expect(names.has("playwright")).toBe(false)
      expect(names.has("active")).toBe(true)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it("merges server names from multiple .mcp.json files", async () => {
    // #given
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
      // #when
      const { getSystemMcpServerNames } = await import("./loader")
      const names = getSystemMcpServerNames()

      // #then
      expect(names.has("playwright")).toBe(true)
      expect(names.has("memory")).toBe(true)
    } finally {
      process.chdir(originalCwd)
    }
  })
})
