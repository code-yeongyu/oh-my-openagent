import { describe, expect, it } from "bun:test"
import { stripDisabledMcpPromptReferences } from "./disabled-mcp-prompt-sanitizer"

describe("disabled MCP prompt sanitizer", () => {
  it("#given lsp is enabled #when sanitizing #then preserves lsp guidance", () => {
    // given
    const prompt = "After every file edit, run `lsp_diagnostics` on every changed file.\nUse `lsp_*` tools.\n"

    // when
    const sanitized = stripDisabledMcpPromptReferences(prompt, [])

    // then
    expect(sanitized).toContain("lsp_diagnostics")
    expect(sanitized).toContain("lsp_*")
  })

  it("#given lsp is disabled #when sanitizing #then removes lsp tool instructions", () => {
    // given
    const prompt = [
      "Before edits, inspect the code.",
      "After every file edit, run `lsp_diagnostics` on every changed file.",
      "Semantic search (definitions, references): LSP tools",
      "Use `lsp_*` for diagnostics.",
      "Build after tests.",
    ].join("\n")

    // when
    const sanitized = stripDisabledMcpPromptReferences(prompt, ["lsp"])

    // then
    expect(sanitized).toContain("Before edits")
    expect(sanitized).toContain("Build after tests")
    expect(sanitized).not.toContain("lsp_diagnostics")
    expect(sanitized).not.toContain("lsp_*")
    expect(sanitized).not.toContain("LSP tools")
  })
})
