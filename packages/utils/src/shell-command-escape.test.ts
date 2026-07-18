import { describe, expect, test } from "bun:test"

import { shellEscapeForDoubleQuotedCommand } from "./shell-command-escape"

describe("shellEscapeForDoubleQuotedCommand", () => {
  test("#given plain command text #when escaping #then leaves it unchanged", () => {
    expect(shellEscapeForDoubleQuotedCommand("echo hello-world_123")).toBe("echo hello-world_123")
  })

  test("#given double quote shell interpolation characters #when escaping #then prefixes them with backslashes", () => {
    expect(shellEscapeForDoubleQuotedCommand("\\")).toBe("\\\\")
    expect(shellEscapeForDoubleQuotedCommand("$HOME")).toBe("\\$HOME")
    expect(shellEscapeForDoubleQuotedCommand("`cmd`")).toBe("\\`cmd\\`")
    expect(shellEscapeForDoubleQuotedCommand('"quoted"')).toBe('\\"quoted\\"')
  })

  test("#given shell control characters #when escaping #then neutralizes separators and grouping", () => {
    expect(shellEscapeForDoubleQuotedCommand("run; next | alt & tail # comment (group)")).toBe(
      String.raw`run\; next \| alt \& tail \# comment \(group\)`
    )
  })
})
