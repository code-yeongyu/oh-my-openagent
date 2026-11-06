import { describe, expect, test } from "bun:test"

import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

import { chainUnavailableText, pinnedModelUnavailableText } from "./model-error-text"

const CHAIN: readonly DelegateFallbackEntry[] = [
  { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed" },
  { providers: ["openai"], model: "gpt-6-luna-fast" },
]

describe("model refusals", () => {
  test("#given a dead category chain #when rendered #then every model, every provider, the fix key and the no-spawn fact are named", () => {
    // given
    const missing = ["kimi-coding", "kimi-for-coding", "openai"]

    // when
    const text = chainUnavailableText({ category: "quick" }, CHAIN, missing, undefined)

    // then
    for (const rung of CHAIN) {
      expect(text).toContain(rung.model)
      for (const provider of rung.providers) expect(text).toContain(provider)
    }
    expect(text).toContain("categories.quick.model")
    expect(text).toContain("No child was spawned")
  })

  test("#given a dead agent chain #when rendered #then it reads as the agent and names agents.<name>.model", () => {
    // given
    const target = { agent: "explore" }

    // when
    const text = chainUnavailableText(target, CHAIN, ["kimi-coding"], undefined)

    // then
    expect(text.startsWith('Agent "explore"')).toBe(true)
    expect(text).toContain("agents.explore.model")
    expect(text).toContain("No child was spawned")
  })

  test("#given only an unlisted provider serves a rung model #when rendered #then the opt-in pin is offered", () => {
    // given
    const unlisted = "openrouter/moonshotai/kimi-k3"

    // when
    const text = chainUnavailableText({ category: "quick" }, CHAIN, ["kimi-coding"], unlisted)

    // then
    expect(text).toContain(`categories.quick.model = "${unlisted}"`)
    expect(text).toContain("openrouter")
  })

  test("#given a model the registry does not serve #when a pin is refused #then the pin and the Settings key are named", () => {
    // given
    const pinned = "custom-proxy/gpt-6-astra"

    // when
    const text = pinnedModelUnavailableText({ category: "quick" }, pinned)

    // then
    expect(text).toContain(pinned)
    expect(text).toContain("categories.quick.model")
    expect(text).toContain("No child was spawned")
  })
})
