import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MCP_BACKED_TOOL_NAMES, registerMcpBackedTools, type McpToolBackend } from "./mcp-backed-tools"
import type { TargetToolDefinition } from "./tool-registration"

let tempDirectory: string

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "omo-mcp-backed-tools-"))
})

afterEach(() => {
  rmSync(tempDirectory, { recursive: true, force: true })
})

function getText(result: { content: readonly Array<{ type: string; text?: string }> }): string {
  const first = result.content[0]
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("expected text tool result")
  }
  return first.text
}

function collectTools(backend?: McpToolBackend): Map<string, TargetToolDefinition> {
  const tools = new Map<string, TargetToolDefinition>()
  registerMcpBackedTools({
    host: "oh-my-pi",
    cwd: tempDirectory,
    backend,
    registry: {
      registerTool: (tool) => {
        tools.set(tool.name, tool)
      },
    },
  })
  return tools
}

describe("registerMcpBackedTools", () => {
  test("#given target registry #when registering MCP-backed tools #then public OMO names are present", () => {
    // given
    const tools = new Map<string, TargetToolDefinition>()

    // when
    registerMcpBackedTools({
      host: "pi",
      cwd: tempDirectory,
      registry: {
        registerTool: (tool) => {
          tools.set(tool.name, tool)
        },
      },
    })

    // then
    expect([...tools.keys()].sort()).toEqual([...MCP_BACKED_TOOL_NAMES].sort())
  })

  test("#given fake backend #when executing public LSP tool #then call maps to LSP MCP tool name", async () => {
    // given
    const calls: string[] = []
    const backend: McpToolBackend = {
      callTool: async (serverName, toolName) => {
        calls.push(`${serverName}:${toolName}`)
        return { content: [{ type: "text", text: "mapped" }] }
      },
    }
    const tools = collectTools(backend)

    // when
    const result = await tools.get("lsp_diagnostics")?.execute("call-1", { filePath: "src/index.ts" })

    // then
    expect(calls).toEqual(["lsp:diagnostics"])
    expect(result ? getText(result) : "").toBe("mapped")
    expect(tools.get("lsp_diagnostics")?.mcpServerName).toBe("lsp")
    expect(tools.get("lsp_diagnostics")?.mcpToolName).toBe("diagnostics")
  })

  test("#given fake backend #when executing public AST tool #then call maps to ast_grep MCP tool name", async () => {
    // given
    const calls: string[] = []
    const backend: McpToolBackend = {
      callTool: async (serverName, toolName) => {
        calls.push(`${serverName}:${toolName}`)
        return { content: [{ type: "text", text: "ast mapped" }] }
      },
    }
    const tools = collectTools(backend)

    // when
    const result = await tools.get("ast_grep_search")?.execute("call-1", { pattern: "const $A = $B", lang: "typescript" })

    // then
    expect(calls).toEqual(["ast_grep:search"])
    expect(result ? getText(result) : "").toBe("ast mapped")
    expect(tools.get("ast_grep_search")?.mcpServerName).toBe("ast_grep")
    expect(tools.get("ast_grep_search")?.mcpToolName).toBe("search")
  })

  test("#given vendored LSP MCP backend #when executing diagnostics #then target-shaped result returns", async () => {
    // given
    const filePath = join(tempDirectory, "sample.ts")
    writeFileSync(filePath, "const value: number = 1\n", "utf-8")
    const tools = collectTools()

    // when
    const result = await tools.get("lsp_diagnostics")?.execute("call-1", { filePath, severity: "all" })

    // then
    expect(result?.content[0]?.type).toBe("text")
    expect(result ? getText(result).length : 0).toBeGreaterThan(0)
  })

  test("#given vendored ast-grep MCP backend #when executing structural search #then target result includes match", async () => {
    // given
    const filePath = join(tempDirectory, "sample.ts")
    writeFileSync(filePath, "const target = 1\n", "utf-8")
    const tools = collectTools()

    // when
    const result = await tools
      .get("ast_grep_search")
      ?.execute("call-1", { pattern: "const $A = $B", lang: "typescript", paths: [filePath] })

    // then
    expect(result?.isError).toBe(false)
    expect(result ? getText(result) : "").toContain("target")
  })
})
