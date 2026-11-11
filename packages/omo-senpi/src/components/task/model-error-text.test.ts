import { describe, expect, test } from "bun:test"

import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

import {
  agentModelFailureText,
  categoryModelFailureText,
  chainUnavailableText,
  pinnedModelUnavailableText,
} from "./model-error-text"

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

  test("#given connected providers that simply do not list the rung models #when rendered #then it does not claim a provider is missing", () => {
    // when
    const text = chainUnavailableText({ category: "quick" }, CHAIN, [], undefined)

    // then
    expect(text).not.toContain("not connected")
    expect(text).toContain("none of them lists these model ids")
    expect(text).toContain("categories.quick.model")
  })

  test("#given a retired category alias #when the refusal names the fix #then it uses the canonical key", () => {
    // given
    const error = {
      code: "model_unavailable" as const,
      message: "resolver text",
      category: "old-alias",
      attempted_chain: CHAIN,
      missing_providers: ["openai"],
    }

    // when
    const text = categoryModelFailureText(error, {}, "quick")

    // then
    expect(text).toContain("categories.quick.model")
    expect(text).not.toContain("old-alias")
  })

  test("#given a category pinned through a models list #when rendered #then it names that pin instead of the dead chain", () => {
    // given: the schema accepts `models: [...]` with no scalar `model`, and this refusal carries no
    // chain, so nothing else names the model the user actually pinned
    const error = {
      code: "model_unavailable" as const,
      message: "resolver text",
      category: "quick",
    }
    const omoConfig = { categories: { quick: { models: ["custom-proxy/gpt-6-astra"] } } }

    // when
    const text = categoryModelFailureText(error, omoConfig as never, undefined)

    // then: the pin is the cause, so the reader is told which pin failed, not to set the key again
    expect(text).toContain("custom-proxy/gpt-6-astra")
    expect(text).toContain("is pinned to")
    expect(text).toContain("categories.quick.models")
    expect(text).not.toContain("its chain needs")
  })

  test("#given a pinned agent reached through a retired alias #when rendered #then the pin is named under the canonical agent", () => {
    // given: the resolver reports the canonical name, and the config key holds the pin
    const agents = { "omo-native-code-reviewer": { models: [{ model: "custom-proxy/gpt-6-astra" }] } }
    const resolution = {
      agent: "omo-native-code-reviewer",
      attemptedModel: undefined,
      attempted_chain: CHAIN,
      missing_providers: ["openai"],
    }

    // when
    const text = agentModelFailureText("omo-senpi-code-reviewer", resolution, agents as never)

    // then: the pin is the cause, so the reader is told which pin failed, and the fix names the
    // key the pin actually lives in (the models list), not a scalar one they never wrote
    expect(text).toContain("custom-proxy/gpt-6-astra")
    expect(text).toContain("agents.omo-native-code-reviewer.models")
    expect(text).not.toContain("omo-senpi-code-reviewer")
  })
})
