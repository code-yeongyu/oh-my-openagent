import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
})

function mockLocalMcps(): void {
  mock.module("../lsp", () => ({
    createLspMcpConfig: () => ({ type: "local", command: ["node", "dist/cli.js", "mcp"], enabled: true }),
  }))
  mock.module("../ast-grep", () => ({
    createAstGrepMcpConfig: () => ({ type: "local", command: ["node", "ast-grep-mcp", "mcp"], enabled: true }),
  }))
  mock.module("../server-sequential-thinking", () => ({
    createServerSequentialThinkingConfig: () => ({
      type: "local",
      command: ["node", "server-sequential-thinking", "mcp"],
      enabled: true,
    }),
  }))
}

describe("createBuiltinMcps", () => {
  test("should return all MCPs when disabled_mcps is empty", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")
    const disabledMcps: string[] = []

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(Object.keys(result).length).toBeGreaterThan(0)
    expect(result.websearch).toBeDefined()
    expect(result.context7).toBeDefined()
    expect(result.grep_app).toBeDefined()
    expect(result.lsp).toBeDefined()
    expect(result.ast_grep).toBeDefined()
    expect(result.sequential_thinking).toBeDefined()
  })

  test("should filter out disabled MCPs", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")
    const disabledMcps = ["websearch"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result.websearch).toBeUndefined()
    expect(result.context7).toBeDefined()
    expect(result.grep_app).toBeDefined()
    expect(result.lsp).toBeDefined()
    expect(result.ast_grep).toBeDefined()
    expect(result.sequential_thinking).toBeDefined()
  })

  test("should keep lsp when it uses a bootstrap command", () => {
    // given
    mock.module("../lsp", () => ({
      createLspMcpConfig: () => ({ type: "local", command: ["node", "-e", "bootstrap", "/repo"], enabled: true }),
    }))
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps([])

    // then
    expect(result.lsp).toBeDefined()
  })

  test("should return empty array when all MCPs are disabled", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")
    const disabledMcps = [
      "websearch",
      "context7",
      "grep_app",
      "lsp",
      "ast_grep",
      "sequential_thinking",
    ]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    const remainingMcpNames = Object.keys(result)
    expect(remainingMcpNames).not.toContain("websearch")
    expect(remainingMcpNames).not.toContain("context7")
    expect(remainingMcpNames).not.toContain("grep_app")
    expect(remainingMcpNames).not.toContain("lsp")
    expect(remainingMcpNames).not.toContain("ast_grep")
    expect(remainingMcpNames).not.toContain("sequential_thinking")
    expect(remainingMcpNames).toEqual([])
  })

  test("should resolve enabled local MCP runtime commands before registration", async () => {
    // given
    mock.restore()
    const nodePath = "/tmp/omo-runtime/node"
    const bunPath = "/tmp/omo-runtime/bun"
    const { createBuiltinMcps } = await import(`../index?runtime=${Date.now()}-${Math.random()}`)

    // when
    const result = createBuiltinMcps([], undefined, {
      cwd: process.cwd(),
      resolveExecutable: (commandName: string) => {
        if (commandName === "node") return { command: nodePath, available: true }
        if (commandName === "bun") return { command: bunPath, available: true }
        return { command: commandName, available: false }
      },
    })

    // then
    for (const entry of [result.lsp, result.ast_grep]) {
      expect(entry?.type).toBe("local")
      if (entry?.type !== "local") throw new Error("expected local MCP config")
      expect(["node", "bun"]).not.toContain(entry.command[0])
      expect([nodePath, bunPath]).toContain(entry.command[0])
    }
  })
})
