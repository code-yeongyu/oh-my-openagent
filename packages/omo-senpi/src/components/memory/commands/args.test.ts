import { describe, expect, test } from "bun:test"

import { parseCommandArgs } from "./args"

describe("parseCommandArgs", () => {
  test("#given empty input #when parsed #then positionals and flags are empty", () => {
    // given / when
    const parsed = parseCommandArgs("   ")

    // then
    expect(parsed.positionals).toEqual([])
    expect(parsed.flags.size).toBe(0)
  })

  test("#given positionals and a valued flag #when parsed #then flag captures the next token", () => {
    // given / when
    const parsed = parseCommandArgs("status --recent 3 extra")

    // then
    expect(parsed.positionals).toEqual(["status", "extra"])
    expect(parsed.flags.get("recent")).toBe("3")
  })

  test("#given an equals-style flag #when parsed #then the inline value is used", () => {
    // given / when
    const parsed = parseCommandArgs("--conversation=abc123 focus")

    // then
    expect(parsed.flags.get("conversation")).toBe("abc123")
    expect(parsed.positionals).toEqual(["focus"])
  })

  test("#given a declared boolean flag before a positional #when parsed #then the positional is not swallowed", () => {
    // given / when
    const parsed = parseCommandArgs("--include-hidden cats", { booleans: ["include-hidden"] })

    // then
    expect(parsed.flags.get("include-hidden")).toBe(true)
    expect(parsed.positionals).toEqual(["cats"])
  })

  test("#given a flag at the end of input #when parsed #then it degrades to a boolean", () => {
    // given / when
    const parsed = parseCommandArgs("reset --force")

    // then
    expect(parsed.flags.get("force")).toBe(true)
    expect(parsed.positionals).toEqual(["reset"])
  })
})
