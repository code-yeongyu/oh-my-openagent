import { describe, expect, test } from "bun:test"

import { createSyncSession } from "./sync-session-creator"

describe("createSyncSession", () => {
  test("creates child session with question permission denied", async () => {
    // given
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_child" } }
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
    })

    // then
    expect(result).toEqual({ ok: true, sessionID: "ses_child", parentDirectory: "/parent" })
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.body).toEqual({
      parentID: "ses_parent",
      title: "test task (@explore subagent)",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
      ],
    })
  })

  test("advances to next model when first model throws ProviderModelNotFoundError", async () => {
    // given: first model fails with ProviderModelNotFoundError, second succeeds
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          const model = (input.body as Record<string, unknown>)?.model as Record<string, unknown> | undefined
          if (model?.id === "MiniMax-M3") {
            const error = new Error("ProviderModelNotFoundError: Model not found: minimax/MiniMax-M3")
            ;(error as unknown as Record<string, unknown>).name = "ProviderModelNotFoundError"
            throw error
          }
          return { data: { id: "ses_child" } }
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
      categoryModel: { providerID: "minimax", modelID: "MiniMax-M3" },
      fallbackChain: [
        { model: "opencode-omniroute/auto/coding:reliable", providers: ["omniroute"] },
      ],
    })

    // then: session created with fallback model
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.sessionID).toBe("ses_child")
      expect(result.effectiveCategoryModel).toEqual({
        providerID: "opencode-omniroute",
        modelID: "auto/coding:reliable",
      })
    }
    expect(createCalls).toHaveLength(2)
    // First call: primary model
    expect((createCalls[0]?.body as Record<string, unknown>)?.model).toEqual({
      id: "MiniMax-M3",
      providerID: "minimax",
    })
    // Second call: fallback model
    expect((createCalls[1]?.body as Record<string, unknown>)?.model).toEqual({
      id: "auto/coding:reliable",
      providerID: "opencode-omniroute",
    })
  })

  test("does not retry when error is not ProviderModelNotFoundError", async () => {
    // given: first model fails with a generic error (not model-not-found)
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          throw new Error("Network timeout")
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
      categoryModel: { providerID: "minimax", modelID: "MiniMax-M3" },
      fallbackChain: [
        { model: "opencode-omniroute/auto/coding:reliable", providers: ["omniroute"] },
      ],
    })

    // then: only one attempt, no fallback
    expect(result.ok).toBe(false)
    expect(createCalls).toHaveLength(1)
  })

  test("returns primary error when all fallback models also fail with ProviderModelNotFoundError", async () => {
    // given: all models fail with ProviderModelNotFoundError
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async () => {
          const error = new Error("ProviderModelNotFoundError")
          ;(error as unknown as Record<string, unknown>).name = "ProviderModelNotFoundError"
          throw error
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
      categoryModel: { providerID: "minimax", modelID: "MiniMax-M3" },
      fallbackChain: [
        { model: "openai/gpt-5.6", providers: ["openai"] },
      ],
    })

    // then: returns primary error (not fallback error)
    expect(result.ok).toBe(false)
  })

  test("returns primary error when no fallback chain provided", async () => {
    // given
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async () => {
          const error = new Error("ProviderModelNotFoundError")
          ;(error as unknown as Record<string, unknown>).name = "ProviderModelNotFoundError"
          throw error
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
      categoryModel: { providerID: "minimax", modelID: "MiniMax-M3" },
    })

    // then: returns primary error, no retry
    expect(result.ok).toBe(false)
  })

  test("skips fallback entry when it is the same as the primary model", async () => {
    // given: primary model fails, fallback chain has same model (should be skipped)
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          // Always fail to verify we skip the duplicate fallback
          const error = new Error("ProviderModelNotFoundError")
          ;(error as unknown as Record<string, unknown>).name = "ProviderModelNotFoundError"
          throw error
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
      categoryModel: { providerID: "minimax", modelID: "MiniMax-M3" },
      fallbackChain: [
        { model: "minimax/MiniMax-M3", providers: ["minimax"] },
      ],
    })

    // then: only one attempt (duplicate skipped), returns primary error
    expect(result.ok).toBe(false)
    expect(createCalls).toHaveLength(1)
  })

  test("returns effectiveCategoryModel in result when fallback succeeds", async () => {
    // given: primary fails, fallback succeeds
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          const model = (input.body as Record<string, unknown>)?.model as Record<string, unknown> | undefined
          if (model?.id === "nonexistent") {
            const error = new Error("ProviderModelNotFoundError")
            ;(error as unknown as Record<string, unknown>).name = "ProviderModelNotFoundError"
            throw error
          }
          return { data: { id: "ses_child" } }
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
      categoryModel: { providerID: "provider-a", modelID: "nonexistent" },
      fallbackChain: [
        { model: "provider-b/working-model", providers: ["provider-b"], variant: "high" },
      ],
    })

    // then: effectiveCategoryModel reflects the working fallback
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effectiveCategoryModel).toEqual({
        providerID: "provider-b",
        modelID: "working-model",
        variant: "high",
      })
    }
  })
})
