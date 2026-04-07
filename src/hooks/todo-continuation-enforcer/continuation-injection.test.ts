declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import { injectContinuation } from "./continuation-injection"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"

describe("injectContinuation", () => {
  test("normalizes built-in display names to config keys before promptAsync", async () => {
    // given
    let capturedAgent: string | undefined
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async (input: {
            body: {
              agent?: string
            }
          }) => {
            capturedAgent = input.body.agent
            return {}
          },
        },
      },
    }
    const sessionStateStore = {
      getExistingState: () => ({ inFlight: false, lastInjectedAt: 0, consecutiveFailures: 0 }),
    }

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID: "ses_display_name_agent",
      resolvedInfo: {
        agent: "Sisyphus - Ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(capturedAgent).toBe("sisyphus")
  })

  test("inherits tools from resolved message info when reinjecting", async () => {
    // given
    let capturedTools: Record<string, boolean> | undefined
    let capturedText: string | undefined
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async (input: {
            body: {
              tools?: Record<string, boolean>
              parts?: Array<{ type: string; text: string }>
            }
          }) => {
            capturedTools = input.body.tools
            capturedText = input.body.parts?.[0]?.text
            return {}
          },
        },
      },
    }
    const sessionStateStore = {
      getExistingState: () => ({ inFlight: false, lastInjectedAt: 0, consecutiveFailures: 0 }),
    }

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID: "ses_continuation_tools",
      resolvedInfo: {
        agent: "Hephaestus",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        tools: { question: "deny", bash: "allow" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(capturedTools).toEqual({ question: false, bash: true })
    expect(capturedText).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })

  test("skips injection when agent is plan (prevents Plan Mode infinite loop)", async () => {
    // given
    let injected = false
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async () => {
            injected = true
            return {}
          },
        },
      },
    }
    const sessionStateStore = {
      getExistingState: () => ({ inFlight: false, lastInjectedAt: 0, consecutiveFailures: 0 }),
    }

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID: "ses_plan_skip",
      resolvedInfo: {
        agent: "plan",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(injected).toBe(false)
  })

  test("#given resolved model info includes variant #when reinjecting continuation #then promptAsync receives variant as a top-level field", async () => {
    // given
    let capturedBody:
      | {
          model?: { providerID: string; modelID: string }
          variant?: string
        }
      | undefined
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async (input: {
            body: {
              model?: { providerID: string; modelID: string }
              variant?: string
            }
          }) => {
            capturedBody = input.body
            return {}
          },
        },
      },
    }
    const sessionStateStore = {
      getExistingState: () => ({ inFlight: false, lastInjectedAt: 0, consecutiveFailures: 0 }),
    }
    const model = {
      providerID: "openai",
      modelID: "gpt-5.3-codex",
      variant: "max",
    }

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID: "ses_continuation_variant",
      resolvedInfo: {
        agent: "Hephaestus",
        model,
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(capturedBody?.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.3-codex",
    })
    expect(capturedBody?.variant).toBe("max")
  })
})
