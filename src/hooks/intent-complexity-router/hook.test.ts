import { describe, it, expect, beforeEach } from "bun:test"

import { createIntentComplexityRouterHook } from "./hook"
import { HAIKU_MODEL } from "./constants"

function makeChatMessageArgs(opts: {
  sessionID?: string
  parentSessionId?: string
  agent?: string
  parts: string
}) {
  const input = {
    sessionID: opts.sessionID ?? "ses_test",
    parentSessionId: opts.parentSessionId,
    agent: opts.agent,
  }
  const output = {
    message: {} as Record<string, unknown>,
    parts: [{ type: "text", text: opts.parts }],
  }
  return { input, output }
}

function makeChatParamsArgs(opts: {
  sessionID?: string
  agentName?: string
  budgetTokens?: number
}) {
  const input = {
    sessionID: opts.sessionID ?? "ses_test",
    agent: opts.agentName ? { name: opts.agentName } : undefined,
  }
  const output = {
    options: {
      thinking: {
        type: "enabled",
        budgetTokens: opts.budgetTokens ?? 32_000,
      } as Record<string, unknown>,
    } as Record<string, unknown>,
  }
  return { input, output }
}

describe("createIntentComplexityRouterHook", () => {
  describe("#given hook is disabled", () => {
    it("does nothing regardless of input", async () => {
      // given
      const hooks = createIntentComplexityRouterHook(false)
      const { input, output } = makeChatMessageArgs({
        agent: "Sisyphus",
        parts: "fix the type error on line 42 of oracle.ts",
      })

      // when
      await hooks["chat.message"](input, output)

      // then
      expect(output.message["model"]).toBeUndefined()
    })
  })

  describe("#given hook is enabled", () => {
    describe("chat.message — Sisyphus exclusion", () => {
      it("does NOT downgrade Sisyphus on MODERATE intent", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "Sisyphus",
          parts: "fix the type error on line 42 of oracle.ts",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toBeUndefined()
      })

      it("does NOT downgrade Sisyphus on TRIVIAL intent", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "Sisyphus",
          parts: "what model does oracle use?",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toBeUndefined()
      })

      it("is case-insensitive for Sisyphus name check", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "SISYPHUS",
          parts: "rename getAgentCost to getAgentPriceTier",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toBeUndefined()
      })

      it("is case-insensitive for Sisyphus-Junior name check", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "Sisyphus-Junior",
          parts: "rename getAgentCost to getAgentPriceTier",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toBeUndefined()
      })
    })

    describe("chat.message — non-Sisyphus downgrade", () => {
      it("downgrades non-Sisyphus agent on MODERATE intent", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "Librarian",
          parts: "fix the type error on line 42 of oracle.ts",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toEqual(HAIKU_MODEL)
      })

      it("downgrades non-Sisyphus agent on TRIVIAL intent", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "Explore",
          parts: "what model does oracle use?",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toEqual(HAIKU_MODEL)
      })

      it("does NOT downgrade any agent on COMPLEX intent", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "Explore",
          parts: "implement a new caching layer for the session manager",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toBeUndefined()
      })
    })

    describe("chat.message — subagent sessions", () => {
      it("skips processing when parentSessionId is set", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const { input, output } = makeChatMessageArgs({
          agent: "Explore",
          parentSessionId: "ses_parent",
          parts: "fix the type error on line 42 of oracle.ts",
        })

        // when
        await hooks["chat.message"](input, output)

        // then
        expect(output.message["model"]).toBeUndefined()
      })
    })

    describe("chat.params — Sisyphus thinking budget adjustment", () => {
      it("adjusts thinking budget to 8000 for MODERATE intent", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const sessionID = "ses_thinking_test"

        // prime the session tier via chat.message
        const { input: msgInput, output: msgOutput } = makeChatMessageArgs({
          sessionID,
          agent: "Sisyphus",
          parts: "fix the type error on line 42 of oracle.ts",
        })
        await hooks["chat.message"](msgInput, msgOutput)

        // when
        const { input: paramsInput, output: paramsOutput } = makeChatParamsArgs({
          sessionID,
          agentName: "Sisyphus",
          budgetTokens: 32_000,
        })
        await hooks["chat.params"](paramsInput, paramsOutput)

        // then
        const thinking = paramsOutput.options.thinking as { budgetTokens: number }
        expect(thinking.budgetTokens).toBe(8_000)
      })

      it("adjusts thinking budget to 32000 for COMPLEX intent", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const sessionID = "ses_complex_thinking"

        const { input: msgInput, output: msgOutput } = makeChatMessageArgs({
          sessionID,
          agent: "Sisyphus",
          parts: "implement a new caching layer for the session manager",
        })
        await hooks["chat.message"](msgInput, msgOutput)

        // when
        const { input: paramsInput, output: paramsOutput } = makeChatParamsArgs({
          sessionID,
          agentName: "Sisyphus",
          budgetTokens: 8_000,
        })
        await hooks["chat.params"](paramsInput, paramsOutput)

        // then
        const thinking = paramsOutput.options.thinking as { budgetTokens: number }
        expect(thinking.budgetTokens).toBe(32_000)
      })

      it("does NOT adjust thinking budget for TRIVIAL intent (no tier set)", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const sessionID = "ses_trivial_thinking"

        const { input: msgInput, output: msgOutput } = makeChatMessageArgs({
          sessionID,
          agent: "Sisyphus",
          parts: "what model does oracle use?",
        })
        await hooks["chat.message"](msgInput, msgOutput)

        // when
        const { input: paramsInput, output: paramsOutput } = makeChatParamsArgs({
          sessionID,
          agentName: "Sisyphus",
          budgetTokens: 32_000,
        })
        await hooks["chat.params"](paramsInput, paramsOutput)

        // then — budget untouched because TRIVIAL early-returns
        const thinking = paramsOutput.options.thinking as { budgetTokens: number }
        expect(thinking.budgetTokens).toBe(32_000)
      })

      it("does NOT adjust budget when agent is not Sisyphus", async () => {
        // given
        const hooks = createIntentComplexityRouterHook(true)
        const sessionID = "ses_non_sisyphus_params"

        const { input: msgInput, output: msgOutput } = makeChatMessageArgs({
          sessionID,
          agent: "Librarian",
          parts: "fix the type error on line 42 of oracle.ts",
        })
        await hooks["chat.message"](msgInput, msgOutput)

        // when
        const { input: paramsInput, output: paramsOutput } = makeChatParamsArgs({
          sessionID,
          agentName: "Librarian",
          budgetTokens: 32_000,
        })
        await hooks["chat.params"](paramsInput, paramsOutput)

        // then
        const thinking = paramsOutput.options.thinking as { budgetTokens: number }
        expect(thinking.budgetTokens).toBe(32_000)
      })
    })
  })
})
