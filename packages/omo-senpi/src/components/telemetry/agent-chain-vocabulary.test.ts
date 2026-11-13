import { describe, expect, test } from "bun:test"

import { AGENT_FALLBACK_CHAINS } from "../../../../senpi-task/src/agents/builtin/fallback-chains"
import { maskProviderAndModel } from "./product-identity"

describe("telemetry vocabulary covers the builtin agent chains", () => {
  test("#given every provider and model rung in AGENT_FALLBACK_CHAINS #when masked #then no shipped rung collapses to custom", () => {
    // given: every (provider, model) pair a curated agent can actually execute
    const shippedRungs = Object.entries(AGENT_FALLBACK_CHAINS).flatMap(([agent, chain]) =>
      chain.flatMap((rung) => rung.providers.map((provider) => ({ agent, provider, model: rung.model }))),
    )
    expect(shippedRungs.length).toBeGreaterThan(0)

    // when: each rung is masked for export
    const collapsed = shippedRungs.filter(({ provider, model }) => {
      const masked = maskProviderAndModel(provider, model)
      return masked.provider === "custom" || masked.model_id === "custom"
    })

    // then: the agent-model insight names the routed model instead of `custom`
    expect(collapsed).toEqual([])
  })
})
