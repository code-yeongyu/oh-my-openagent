import { describe, expect, test } from "bun:test"
import { toolPromptSnippet } from "./native-tool-snippet"

describe("toolPromptSnippet", () => {
  test("keeps a one-sentence description whole, on one line", () => {
    expect(toolPromptSnippet("Reads a file\n  from disk.")).toBe("Reads a file from disk.")
  })

  test("stops after the first sentence once it says enough", () => {
    expect(toolPromptSnippet("Fast content search tool with safety limits (60s timeout). Searches file contents. Supports regex."))
      .toBe("Fast content search tool with safety limits (60s timeout).")
  })

  test("adds the next sentence when the first is too short to describe the tool", () => {
    expect(toolPromptSnippet("WARNING: This is TMUX ONLY. Pass tmux subcommands directly. Examples follow."))
      .toBe("WARNING: This is TMUX ONLY. Pass tmux subcommands directly.")
  })

  test("uses only the first paragraph", () => {
    expect(toolPromptSnippet("Runs a shell command in a persistent session.\n\nUsage notes:\n- quote paths"))
      .toBe("Runs a shell command in a persistent session.")
  })

  test("caps a long sentence at a word boundary", () => {
    const snippet = toolPromptSnippet(`Lists ${"many ".repeat(80)}things`)
    expect(snippet.length).toBeLessThanOrEqual(200)
    expect(snippet.endsWith("...")).toBe(true)
    expect(snippet).not.toContain("\n")
  })

  test("an empty description gives an empty snippet, which Native's tool section omits", () => {
    expect(toolPromptSnippet("  \n ")).toBe("")
  })
})
