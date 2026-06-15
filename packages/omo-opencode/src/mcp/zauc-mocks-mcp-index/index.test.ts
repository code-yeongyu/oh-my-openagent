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
  mock.module("../codegraph", () => ({
    createCodegraphMcpConfig: () => ({ type: "local", command: ["codegraph", "serve", "--mcp"], enabled: true }),
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
    expect(result.codegraph).toBeDefined()
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
    expect(result.codegraph).toBeDefined()
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
    const disabledMcps = ["websearch", "context7", "grep_app", "lsp", "ast_grep", "codegraph"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    const remainingMcpNames = Object.keys(result)
    expect(remainingMcpNames).not.toContain("websearch")
    expect(remainingMcpNames).not.toContain("context7")
    expect(remainingMcpNames).not.toContain("grep_app")
    expect(remainingMcpNames).not.toContain("lsp")
    expect(remainingMcpNames).not.toContain("ast_grep")
    expect(remainingMcpNames).not.toContain("codegraph")
    expect(remainingMcpNames).toEqual([])
  })

  test("should omit codegraph when its config section is disabled", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps([], { codegraph: { enabled: false } })

    // then
    expect(result.codegraph).toBeUndefined()
  })

  test("should omit codegraph when it is listed in disabled_mcps", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps(["codegraph"], { codegraph: { enabled: true } })

    // then
    expect(result.codegraph).toBeUndefined()
  })

  test("should keep codegraph registered but disabled when its binary is absent", async () => {
    // given
    mock.restore()
    const { createBuiltinMcps } = await import(`../index?codegraph-missing=${Date.now()}-${Math.random()}`)

    // when
    const result = createBuiltinMcps([], { codegraph: { enabled: true } }, {
      codegraph: {
        fileExists: () => false,
        homeDir: "/tmp/omo-codegraph-missing-home",
      },
      cwd: process.cwd(),
      resolveExecutable: (commandName: string) => ({ command: commandName, available: false }),
    })

    // then
    expect(result.codegraph?.type).toBe("local")
    expect(result.codegraph?.enabled).toBe(false)
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
