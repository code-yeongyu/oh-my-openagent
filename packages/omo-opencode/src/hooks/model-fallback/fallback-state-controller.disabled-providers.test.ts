import { describe, expect, test } from "bun:test"
import { createModelFallbackStateController } from "./fallback-state-controller"

type ControllerInput = Parameters<typeof createModelFallbackStateController>[0] & {
  readonly disabledProviders: readonly string[]
}

function createController() {
  const input: ControllerInput = {
    pendingModelFallbacks: new Map(),
    lastToastKey: new Map(),
    sessionFallbackChains: new Map(),
    disabledProviders: ["openai-codex"],
  }
  return createModelFallbackStateController(input)
}

describe("createModelFallbackStateController disabled providers", () => {
  test("filters mirrored entries from a session fallback chain", () => {
    // given
    const controller = createController()

    // when
    controller.setSessionFallbackChain("session-explicit", [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast" },
      { providers: ["deepseek"], model: "deepseek-v4-flash" },
    ])

    // then
    expect(controller.getSessionFallbackChain("session-explicit")).toEqual([
      { providers: ["deepseek"], model: "deepseek-v4-flash" },
    ])
  })

  test("filters mirrored entries from the static agent fallback chain", () => {
    // given
    const controller = createController()

    // when
    const armed = controller.setPendingModelFallback(
      "session-static",
      "Explore",
      "openai",
      "gpt-5.6-luna-fast",
    )

    // then
    expect(armed).toBe(true)
    expect(controller.getFallbackState("session-static")?.fallbackChain[0]).toMatchObject({
      providers: ["deepseek"],
      model: "deepseek-v4-flash",
    })
  })
})
