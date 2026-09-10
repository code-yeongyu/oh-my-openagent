import { describe, expect, test } from "bun:test"

import { panelFactsFrom } from "./facts"

describe("panelFactsFrom", () => {
  test("#given a provider-qualified model id #when read #then only the model part is kept", () => {
    // given
    const ctx = { model: { id: "anthropic/claude-opus-5" } }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts.model).toBe("claude-opus-5")
  })

  test("#given a plain string model #when read #then it is used directly", () => {
    // given
    const ctx = { model: "gpt-6" }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts.model).toBe("gpt-6")
  })

  test("#given context usage #when read #then tokens, window and percent come through", () => {
    // given
    const ctx = { getContextUsage: () => ({ tokens: 29_000, contextWindow: 1_000_000, percent: 2.9 }) }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts.usage).toEqual({ tokens: 29_000, contextWindow: 1_000_000, percent: 2.9 })
  })

  test("#given usage without a window #when read #then it is treated as unavailable", () => {
    // given
    const ctx = { getContextUsage: () => ({ tokens: 10 }) }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts.usage).toBeUndefined()
  })

  test("#given a host whose usage call throws #when read #then the failure does not escape", () => {
    // given
    const ctx = {
      getContextUsage: () => {
        throw new Error("no active model")
      },
    }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts.usage).toBeUndefined()
  })

  test("#given a session manager #when read #then totals and the session id come through", () => {
    // given
    const ctx = {
      sessionManager: {
        getSessionId: () => "session-1",
        getUsageTotals: () => ({ input: 100, output: 20, cacheRead: 5, cacheWrite: 1, cost: 0.5, latestCacheHitRate: 90 }),
      },
    }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts.sessionId).toBe("session-1")
    expect(facts.totals?.cost).toBe(0.5)
    expect(facts.totals?.latestCacheHitRate).toBe(90)
  })

  test("#given totals missing the token fields #when read #then totals are dropped", () => {
    // given
    const ctx = { sessionManager: { getUsageTotals: () => ({ cost: 1 }) } }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts.totals).toBeUndefined()
  })

  test("#given a context that offers nothing #when read #then the facts are empty", () => {
    // given
    const ctx = { unrelated: true }

    // when
    const facts = panelFactsFrom(ctx)

    // then
    expect(facts).toEqual({})
  })
})
