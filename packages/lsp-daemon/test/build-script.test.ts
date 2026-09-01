import { describe, expect, it } from "vitest"

import { shouldUseShellForCommand } from "../scripts/build-command.mjs"

describe("LSP daemon build command invocation", () => {
  it("does not shell an absolute Windows runtime path containing spaces", () => {
    expect(shouldUseShellForCommand("C:\\Program Files\\nodejs\\node.exe", "win32")).toBe(false)
  })

  it("keeps shell resolution for bare Windows package commands", () => {
    expect(shouldUseShellForCommand("bun", "win32")).toBe(true)
    expect(shouldUseShellForCommand("tsc", "win32")).toBe(true)
  })

  it("does not use a shell for POSIX commands", () => {
    expect(shouldUseShellForCommand("bun", "darwin")).toBe(false)
  })
})
