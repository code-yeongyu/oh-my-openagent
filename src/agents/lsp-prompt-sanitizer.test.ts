import type { AgentConfig } from "@opencode-ai/sdk"
import { describe, expect, test } from "bun:test"
import { sanitizeLspInAgentConfig, sanitizeLspPromptIfDisabled } from "./lsp-prompt-sanitizer"
import { createMetisAgent } from "./metis"

const LSP_TOKEN_INVARIANT = /\blsp_[a-z_]+\b/

describe("sanitizeLspPromptIfDisabled", () => {
  test("removes every lsp_* token when lsp is disabled", () => {
    // given
    const prompt = [
      "Run `lsp_diagnostics` on changed files.",
      "`lsp_find_references`: Map all usages",
      "`lsp_rename` / `lsp_prepare_rename`: Safe symbol renames",
      "Use lsp_goto_definition and `lsp_symbols` to navigate.",
    ].join("\n")

    // when
    const sanitized = sanitizeLspPromptIfDisabled(prompt, true)

    // then
    expect(LSP_TOKEN_INVARIANT.test(sanitized)).toBe(false)
  })

  test("returns prompt byte-identical when lsp is enabled", () => {
    // given
    const prompt = "Run `lsp_diagnostics` on changed files."

    // when
    const sanitized = sanitizeLspPromptIfDisabled(prompt, false)

    // then
    expect(sanitized).toBe(prompt)
  })

  test("leaves surrounding non-lsp text intact", () => {
    // given
    const prompt = "Before `lsp_diagnostics` after"

    // when
    const sanitized = sanitizeLspPromptIfDisabled(prompt, true)

    // then
    expect(sanitized.startsWith("Before ")).toBe(true)
    expect(sanitized.endsWith(" after")).toBe(true)
    expect(sanitized).not.toContain("`lsp_diagnostics`")
  })

  test("leaves an unmapped lsp_* token verbatim", () => {
    // given
    const prompt = "Call `lsp_future_tool` here"

    // when
    const sanitized = sanitizeLspPromptIfDisabled(prompt, true)

    // then
    expect(sanitized).toContain("lsp_future_tool")
  })
})

describe("sanitizeLspInAgentConfig", () => {
  test("sanitizes only the prompt field, leaving tools untouched", () => {
    // given
    const config = {
      prompt: "Run `lsp_diagnostics` to verify.",
      tools: { lsp_symbols: true },
    } as unknown as AgentConfig

    // when
    const sanitized = sanitizeLspInAgentConfig(config, true)

    // then
    expect(LSP_TOKEN_INVARIANT.test(sanitized.prompt ?? "")).toBe(false)
    expect(sanitized.tools).toEqual({ lsp_symbols: true })
  })

  test("returns the same reference when lsp is enabled", () => {
    // given
    const config = { prompt: "Run `lsp_diagnostics`." } as unknown as AgentConfig

    // when
    const sanitized = sanitizeLspInAgentConfig(config, false)

    // then
    expect(sanitized).toBe(config)
  })

  test("returns the same reference when there is no prompt", () => {
    // given
    const config = { tools: { lsp_symbols: true } } as unknown as AgentConfig

    // when
    const sanitized = sanitizeLspInAgentConfig(config, true)

    // then
    expect(sanitized).toBe(config)
  })
})

describe("sanitizeLspInAgentConfig with real agent prompts", () => {
  test("Metis prompt has no lsp_* tokens after sanitization", () => {
    // given
    const agent = createMetisAgent("anthropic/claude-sonnet-4-6")

    // when
    const sanitized = sanitizeLspInAgentConfig(agent, true)

    // then
    expect(LSP_TOKEN_INVARIANT.test(sanitized.prompt ?? "")).toBe(false)
  })

  test("Metis prompt is unchanged when lsp is enabled", () => {
    // given
    const agent = createMetisAgent("anthropic/claude-sonnet-4-6")

    // when
    const sanitized = sanitizeLspInAgentConfig(agent, false)

    // then
    expect(sanitized.prompt).toBe(agent.prompt)
  })
})
