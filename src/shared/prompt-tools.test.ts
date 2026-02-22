declare const require: (name: string) => any
const { afterEach, describe, expect, test } = require("bun:test")
import { clearSessionTools, setSessionTools } from "./session-tools-store"
import { normalizePromptTools, resolveInheritedPromptTools } from "./prompt-tools"

describe("prompt-tools", () => {
  afterEach(() => {
    clearSessionTools()
  })

  test("normalizes allow/deny style permissions to boolean tools", () => {
    // given
    const tools = {
      question: "deny",
      bash: "allow",
      task: "ask",
      read: true,
      edit: false,
    } as const

    // when
    const normalized = normalizePromptTools(tools)

    // then
    expect(normalized).toEqual({
      question: false,
      bash: true,
      task: true,
      read: true,
      edit: false,
    })
  })

  test("prefers per-session stored tools over fallback tools", () => {
    // given
    const sessionID = "ses_prompt_tools"
    setSessionTools(sessionID, { question: false, bash: true })

    // when
    const resolved = resolveInheritedPromptTools(sessionID, { question: true, bash: false })

    // then
    expect(resolved).toEqual({ question: false, bash: true })
  })

  test("uses fallback tools when no per-session tools exist", () => {
    // given
    const sessionID = "ses_fallback_only"

    // when
    const resolved = resolveInheritedPromptTools(sessionID, { question: "deny", write: "allow" })

    // then
    expect(resolved).toEqual({ question: false, write: true })
  })
})
