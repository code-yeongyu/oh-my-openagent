import { afterEach, describe, expect, it } from "bun:test"
import { setCompactionAgentConfigCheckpoint, clearCompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createRecoveryLogic } from "./recovery"
import { createCompactionContextInjector } from "./hook"
import type { TailMonitorState } from "./tail-monitor"
import { toV1Event } from "../../v2/event-shape"
import { resolveLatestSessionPromptConfig } from "./session-prompt-config-resolver"

const sessionID = "ses_compaction_loop_regression"
afterEach(() => {
  clearCompactionAgentConfigCheckpoint(sessionID)
  releaseAllPromptAsyncReservationsForTesting()
})

describe("post-compaction recovery is a one-shot control operation", () => {
  it("does not reinject a successful checkpoint after cooldown or a later empty tail", async () => {
    setCompactionAgentConfigCheckpoint(sessionID, { agent: "atlas" })
    const state: TailMonitorState = { currentHasOutput: false, consecutiveNoTextMessages: 5 }
    let restored = false
    let sends = 0
    const ctx = {
      directory: "/isolated",
      client: { session: {
        messages: async () => ({ data: [{ info: { agent: restored ? "atlas" : "compaction" } }] }),
        promptAsync: async () => { sends++; restored = true; return {} },
      } },
    }
    const recovery = createRecoveryLogic(ctx, () => state)
    expect(await recovery.recoverCheckpointedAgentConfig(sessionID, "no-text-tail")).toBe(true)
    releaseAllPromptAsyncReservationsForTesting()
    state.lastRecoveryAt = undefined
    restored = false // the latest transcript row need not repeat persistent config
    expect(await recovery.recoverCheckpointedAgentConfig(sessionID, "no-text-tail")).toBe(false)
    expect(sends).toBe(1)
  })

  it("does not send recovery when current config is already correct, including no-text-tail", async () => {
    setCompactionAgentConfigCheckpoint(sessionID, { agent: "atlas" })
    let sends = 0
    const recovery = createRecoveryLogic({ directory: "/isolated", client: { session: {
      messages: async () => ({ data: [{ info: { agent: "atlas" } }] }),
      promptAsync: async () => { sends++; return {} },
    } } }, () => ({ currentHasOutput: false, consecutiveNoTextMessages: 5 }))
    expect(await recovery.recoverCheckpointedAgentConfig(sessionID, "no-text-tail")).toBe(false)
    expect(sends).toBe(0)
  })

  it("does not repeat an accepted restore when transcript projection is incomplete", async () => {
    setCompactionAgentConfigCheckpoint(sessionID, { agent: "atlas" })
    const state: TailMonitorState = { currentHasOutput: false, consecutiveNoTextMessages: 5 }
    let sends = 0
    const recovery = createRecoveryLogic({ directory: "/isolated", client: { session: {
      messages: async () => ({ data: [] }),
      promptAsync: async () => { sends++; return {} },
    } } }, () => state)
    expect(await recovery.recoverCheckpointedAgentConfig(sessionID, "session.compacted")).toBe(false)
    releaseAllPromptAsyncReservationsForTesting()
    state.lastRecoveryAt = undefined
    expect(await recovery.recoverCheckpointedAgentConfig(sessionID, "no-text-tail")).toBe(false)
    expect(sends).toBe(1)
  })

  it("reads persistent v2 config rather than treating a checkpoint row as missing config", async () => {
    const config = await resolveLatestSessionPromptConfig({ directory: "/isolated", client: { session: {
      get: async () => ({ data: { agent: "atlas", model: { providerID: "claude-code", id: "claude-opus-5-5", variant: "xhigh" } } }),
      messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "compaction" }] }] }),
    } } }, sessionID)
    expect(config).toEqual({ agent: "atlas", model: { providerID: "claude-code", modelID: "claude-opus-5-5", variant: "xhigh" } })
  })

  it("allows one legitimate restore for each newly captured checkpoint", async () => {
    let agent = "atlas"
    let sends = 0
    const hook = createCompactionContextInjector({ ctx: { directory: "/isolated", client: { session: {
      messages: async () => ({ data: [{ info: { agent } }] }),
      promptAsync: async () => { sends++; agent = "atlas"; return {} },
    } } } })
    for (let i = 0; i < 2; i++) {
      await hook.capture(sessionID)
      agent = "compaction"
      await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })
      releaseAllPromptAsyncReservationsForTesting()
      await hook.restore(sessionID)
      expect(sends).toBe(i + 1)
    }
  })

  it("coalesces concurrent completion/autocontinue callbacks before reading or dispatching", async () => {
    setCompactionAgentConfigCheckpoint(sessionID, { agent: "atlas" })
    const state: TailMonitorState = { currentHasOutput: false, consecutiveNoTextMessages: 0 }
    let restored = false
    let reads = 0
    let sends = 0
    const recovery = createRecoveryLogic({ directory: "/isolated", client: { session: {
      messages: async () => { reads++; return { data: [{ info: { agent: restored ? "atlas" : "compaction" } }] } },
      promptAsync: async () => { sends++; restored = true; return {} },
    } } }, () => state)
    const result = await Promise.all([
      recovery.recoverCheckpointedAgentConfig(sessionID, "session.compacted"),
      recovery.recoverCheckpointedAgentConfig(sessionID, "compaction.autocontinue"),
    ])
    expect(result).toEqual([true, false])
    expect(sends).toBe(1)
    expect(reads).toBe(4) // current, latest, gate admission and post-dispatch read
  })

  it("does not restore a failed compaction using the previous successful compaction window", async () => {
    let agent = "atlas"
    let sends = 0
    const hook = createCompactionContextInjector({ ctx: { directory: "/isolated", client: { session: {
      messages: async () => ({ data: [{ info: { agent } }] }),
      promptAsync: async () => { sends++; agent = "atlas"; return {} },
    } } } })
    await hook.capture(sessionID)
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })
    await hook.capture(sessionID)
    agent = "compaction"
    await hook.event({ event: toV1Event({ type: "session.compaction.failed", data: { sessionID, error: { message: "interrupted" } } }) })
    await hook.restore(sessionID)
    expect(sends).toBe(0)
  })

  it("recognizes productive v2 text, reasoning and tool steps instead of counting an empty tail", async () => {
    let reads = 0
    const hook = createCompactionContextInjector({ ctx: { directory: "/isolated", client: { session: {
      messages: async () => { reads++; return { data: [] } },
      promptAsync: async () => ({}),
    } } } })
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } })
    setCompactionAgentConfigCheckpoint(sessionID, { agent: "atlas" })
    reads = 0
    for (let i = 0; i < 8; i++) {
      const assistantMessageID = `msg_${i}`
      for (const raw of [
        { type: "session.step.started", data: { sessionID, assistantMessageID } },
        { type: ["session.text.ended", "session.reasoning.ended", "session.tool.called"][i % 3], data: { sessionID, assistantMessageID, id: `call_${i}`, text: "work" } },
        { type: "session.step.ended", data: { sessionID, assistantMessageID, finish: "tool-calls" } },
      ]) await hook.event({ event: toV1Event(raw) })
    }
    expect(reads).toBe(0)
  })
})
