import { describe, expect, test, afterEach } from "bun:test"
import { LspConfigSchema } from "./lsp-config"
import { createBuiltinMcps } from "../../mcp"
import { LSP_TOOLS_MCP_DISABLED_TOOLS_ENV, LSP_EXPERIMENTAL_DISABLED_TOOLS } from "../../mcp/lsp"

describe("LspConfigSchema", () => {
  test("defaults useOpenCodeExperimental to false", () => {
    //#given
    const input = {}

    //#when
    const result = LspConfigSchema.parse(input)

    //#then
    expect(result.useOpenCodeExperimental).toBe(false)
  })

  test("accepts useOpenCodeExperimental: true", () => {
    //#given
    const input = { useOpenCodeExperimental: true }

    //#when
    const result = LspConfigSchema.parse(input)

    //#then
    expect(result.useOpenCodeExperimental).toBe(true)
  })

  test("accepts useOpenCodeExperimental: false explicitly", () => {
    //#given
    const input = { useOpenCodeExperimental: false }

    //#when
    const result = LspConfigSchema.parse(input)

    //#then
    expect(result.useOpenCodeExperimental).toBe(false)
  })
})

describe("createBuiltinMcps lsp experimental flag", () => {
  afterEach(() => {
    delete process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL
    delete process.env.OPENCODE_EXPERIMENTAL
  })

  test("does not set disabled tools env when flag is false", () => {
    //#given
    process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"
    const config = { lsp: { useOpenCodeExperimental: false } }

    //#when
    const mcps = createBuiltinMcps([], config as never)
    const lspMcp = mcps.lsp as { environment?: Record<string, string> }

    //#then
    expect(lspMcp.environment?.[LSP_TOOLS_MCP_DISABLED_TOOLS_ENV]).toBeUndefined()
  })

  test("does not set disabled tools env when env gate is missing", () => {
    //#given
    const config = { lsp: { useOpenCodeExperimental: true } }

    //#when
    const mcps = createBuiltinMcps([], config as never)
    const lspMcp = mcps.lsp as { environment?: Record<string, string> }

    //#then
    expect(lspMcp.environment?.[LSP_TOOLS_MCP_DISABLED_TOOLS_ENV]).toBeUndefined()
  })

  test("sets disabled tools env when flag is true and env gate is set", () => {
    //#given
    process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"
    const config = { lsp: { useOpenCodeExperimental: true } }

    //#when
    const mcps = createBuiltinMcps([], config as never)
    const lspMcp = mcps.lsp as { environment?: Record<string, string> }

    //#then
    const disabledTools = lspMcp.environment?.[LSP_TOOLS_MCP_DISABLED_TOOLS_ENV]
    expect(disabledTools).toBeDefined()
    for (const tool of LSP_EXPERIMENTAL_DISABLED_TOOLS) {
      expect(disabledTools).toContain(tool)
    }
  })

  test("sets disabled tools env when OPENCODE_EXPERIMENTAL is set", () => {
    //#given
    process.env.OPENCODE_EXPERIMENTAL = "true"
    const config = { lsp: { useOpenCodeExperimental: true } }

    //#when
    const mcps = createBuiltinMcps([], config as never)
    const lspMcp = mcps.lsp as { environment?: Record<string, string> }

    //#then
    expect(lspMcp.environment?.[LSP_TOOLS_MCP_DISABLED_TOOLS_ENV]).toBeDefined()
  })

  test("lsp mcp is absent when lsp is in disabled_mcps", () => {
    //#given
    process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"
    const config = { lsp: { useOpenCodeExperimental: true } }

    //#when
    const mcps = createBuiltinMcps(["lsp"], config as never)

    //#then
    expect(mcps.lsp).toBeUndefined()
  })
})
