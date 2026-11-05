import { describe, expect, test } from "bun:test"

import { resolveOmoComputerSettings } from "./settings"

describe("computer settings bridge", () => {
  test("#given the four reserved v2 keys in omo.json #when resolved #then each reaches the tool settings", () => {
    // given: the snake_case omo.json spelling of the keys reserved for computer use v2.
    const block = { run_sandbox: "quickjs", intervention: "continue", macos_key_priming: "on", trace: true } as const

    // when
    const { runSandbox, intervention, macosKeyPriming, trace } = resolveOmoComputerSettings(block, "darwin")

    // then
    expect({ runSandbox, intervention, macosKeyPriming, trace }).toEqual({
      runSandbox: "quickjs",
      intervention: "continue",
      macosKeyPriming: "on",
      trace: true,
    })
  })

  test("#given no computer block #when resolved #then intervention continues and the other reserved keys keep today's behavior", () => {
    // when
    const { runSandbox, intervention, macosKeyPriming, trace } = resolveOmoComputerSettings(undefined, "darwin")

    // then
    expect({ runSandbox, intervention, macosKeyPriming, trace }).toEqual({
      runSandbox: "vm",
      intervention: "continue",
      macosKeyPriming: "off",
      trace: false,
    })
  })
})
