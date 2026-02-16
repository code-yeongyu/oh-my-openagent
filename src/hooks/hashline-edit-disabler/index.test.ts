import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createHashlineEditDisablerHook } from "./index"
import { setProvider, clearProvider } from "../../features/hashline-provider-state"

describe("hashline-edit-disabler hook", () => {
  const sessionID = "test-session-123"

  beforeEach(() => {
    clearProvider(sessionID)
  })

  afterEach(() => {
    clearProvider(sessionID)
  })

  it("blocks edit tool when hashline enabled + non-OpenAI provider", async () => {
    //#given
    setProvider(sessionID, "anthropic")
    const hook = createHashlineEditDisablerHook({
      experimental: { hashline_edit: true },
    })
    const input = { tool: "edit", sessionID }
    const output = { args: {} }

    //#when
    const executeBeforeHandler = hook["tool.execute.before"]
    if (!executeBeforeHandler) {
      throw new Error("tool.execute.before handler not found")
    }

    //#then
    await expect(executeBeforeHandler(input, output)).rejects.toThrow(
      /hashline_edit/,
    )
  })

  it("passes through edit tool when hashline disabled", async () => {
    //#given
    setProvider(sessionID, "anthropic")
    const hook = createHashlineEditDisablerHook({
      experimental: { hashline_edit: false },
    })
    const input = { tool: "edit", sessionID }
    const output = { args: {} }

    //#when
    const executeBeforeHandler = hook["tool.execute.before"]
    if (!executeBeforeHandler) {
      throw new Error("tool.execute.before handler not found")
    }

    //#then
    const result = await executeBeforeHandler(input, output)
    expect(result).toBeUndefined()
  })

  it("passes through edit tool when OpenAI provider (even if hashline enabled)", async () => {
    //#given
    setProvider(sessionID, "openai")
    const hook = createHashlineEditDisablerHook({
      experimental: { hashline_edit: true },
    })
    const input = { tool: "edit", sessionID }
    const output = { args: {} }

    //#when
    const executeBeforeHandler = hook["tool.execute.before"]
    if (!executeBeforeHandler) {
      throw new Error("tool.execute.before handler not found")
    }

    //#then
    const result = await executeBeforeHandler(input, output)
    expect(result).toBeUndefined()
  })

  it("passes through non-edit tools", async () => {
    //#given
    setProvider(sessionID, "anthropic")
    const hook = createHashlineEditDisablerHook({
      experimental: { hashline_edit: true },
    })
    const input = { tool: "write", sessionID }
    const output = { args: {} }

    //#when
    const executeBeforeHandler = hook["tool.execute.before"]
    if (!executeBeforeHandler) {
      throw new Error("tool.execute.before handler not found")
    }

    //#then
    const result = await executeBeforeHandler(input, output)
    expect(result).toBeUndefined()
  })

  it("blocks case-insensitive edit tool names", async () => {
    //#given
    setProvider(sessionID, "anthropic")
    const hook = createHashlineEditDisablerHook({
      experimental: { hashline_edit: true },
    })

    //#when
    const executeBeforeHandler = hook["tool.execute.before"]
    if (!executeBeforeHandler) {
      throw new Error("tool.execute.before handler not found")
    }

    //#then
    for (const toolName of ["Edit", "EDIT", "edit", "EdIt"]) {
      const input = { tool: toolName, sessionID }
      const output = { args: {} }
      await expect(executeBeforeHandler(input, output)).rejects.toThrow(
        /hashline_edit/,
      )
    }
  })

  it("passes through when hashline config is undefined", async () => {
    //#given
    setProvider(sessionID, "anthropic")
    const hook = createHashlineEditDisablerHook({
      experimental: {},
    })
    const input = { tool: "edit", sessionID }
    const output = { args: {} }

    //#when
    const executeBeforeHandler = hook["tool.execute.before"]
    if (!executeBeforeHandler) {
      throw new Error("tool.execute.before handler not found")
    }

    //#then
    const result = await executeBeforeHandler(input, output)
    expect(result).toBeUndefined()
  })

  it("error message includes hashline_edit tool guidance", async () => {
    //#given
    setProvider(sessionID, "anthropic")
    const hook = createHashlineEditDisablerHook({
      experimental: { hashline_edit: true },
    })
    const input = { tool: "edit", sessionID }
    const output = { args: {} }

    //#when
    const executeBeforeHandler = hook["tool.execute.before"]
    if (!executeBeforeHandler) {
      throw new Error("tool.execute.before handler not found")
    }

    //#then
    try {
      await executeBeforeHandler(input, output)
      throw new Error("Expected error to be thrown")
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).toContain("hashline_edit")
        expect(error.message).toContain("set_line")
        expect(error.message).toContain("replace_lines")
        expect(error.message).toContain("insert_after")
      }
    }
  })
})
