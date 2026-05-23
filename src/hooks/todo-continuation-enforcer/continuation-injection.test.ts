import { afterEach, describe, expect, test } from "bun:test"

import { injectContinuation } from "./continuation-injection"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"

describe("injectContinuation", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("preserves the registered built-in agent name before promptAsync", async () => {
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
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(capturedAgent).toBe("Sisyphus - ultraworker")
  })

  test("#given resolved agent name still carries a ZWSP sort prefix #when continuation is injected #then promptAsync receives the agent name without the ZWSP prefix", async () => {
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
      sessionID: "ses_zwsp_agent",
      resolvedInfo: {
        agent: "\u200B\u200BSisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(capturedAgent).toBe("Sisyphus - ultraworker")
    expect(capturedAgent).not.toContain("\u200B")
  })

  test("inherits tools from resolved message info when reinjecting", async () => {
    // given
    let capturedTools: Record<string, boolean> | undefined
    let capturedPart:
      | {
          text: string
          synthetic?: boolean
          metadata?: Record<string, unknown>
        }
      | undefined
    let capturedNoReply: boolean | undefined
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async (input: {
            body: {
              tools?: Record<string, boolean>
              noReply?: boolean
              parts?: Array<{
                type: string
                text: string
                synthetic?: boolean
                metadata?: Record<string, unknown>
              }>
            }
          }) => {
            capturedTools = input.body.tools
            capturedNoReply = input.body.noReply
            capturedPart = input.body.parts?.[0]
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
    expect(capturedNoReply).toBeUndefined()
    expect(capturedPart?.text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
    expect(capturedPart?.synthetic).toBe(true)
    expect(capturedPart?.metadata?.compaction_continue).toBe(true)
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

  test("#given a peer-message hold survives an unrelated release #when todo continuation injects #then it does not record a queued prompt as injected", async () => {
    // given
    const sessionID = "ses_todo_reserved_by_peer_message"
    let promptCalls = 0
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async () => {
            promptCalls += 1
            return {}
          },
        },
      },
    }
    const state = {
      inFlight: false,
      lastInjectedAt: 0,
      consecutiveFailures: 0,
      awaitingPostInjectionProgressCheck: false,
    }
    const sessionStateStore = {
      getExistingState: () => state,
    }

    // when
    const peerMessageResult = await dispatchInternalPrompt({
      mode: "async",
      client: ctx.client,
      sessionID,
      source: "team-live-delivery",
      settleMs: 0,
      input: {
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: '<peer_message from="teammate">hello</peer_message>' }] },
      },
    })
    releasePromptAsyncReservation(sessionID, "ralph-loop:activity")
    await injectContinuation({
      ctx: ctx as never,
      sessionID,
      resolvedInfo: {
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(peerMessageResult.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
    expect(state.inFlight).toBe(false)
    expect(state.lastInjectedAt).toBe(0)
    expect(state.awaitingPostInjectionProgressCheck).not.toBe(true)
  })

  test("#given promptAsync may have accepted before EOF #when continuation injection observes the failure #then it records an optimistic injection", async () => {
    // given
    const state = {
      inFlight: false,
      lastInjectedAt: 0,
      awaitingPostInjectionProgressCheck: false,
      consecutiveFailures: 2,
    }
    let promptCalls = 0
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async () => {
            promptCalls += 1
            throw new Error("JSON Parse error: Unexpected EOF")
          },
        },
      },
    }
    const sessionStateStore = {
      getExistingState: () => state,
    }

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID: "ses_continuation_eof",
      resolvedInfo: {
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(promptCalls).toBe(1)
    expect(state.inFlight).toBe(false)
    expect(state.awaitingPostInjectionProgressCheck).toBe(true)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.lastInjectedAt).toBeGreaterThan(0)
  })
})
