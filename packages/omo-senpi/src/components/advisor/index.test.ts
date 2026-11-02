/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"

import { setup, SESSION, toolResults } from "./advisor.test-support"
import { ADVISOR_ADVICE_TYPE } from "./index"

describe("advisor component", () => {
  it("#given the default config #when the component registers #then it registers no hook at all", () => {
    expect(setup({ key: "k" }).pi.handlers).toHaveLength(0)
  })

  it("#given the default config #when tool results pile up #then the gate is never called", async () => {
    const h = setup({ key: "k" })
    await h.pi.dispatch("before_agent_start", { type: "before_agent_start", prompt: "fix the build" }, SESSION)
    await toolResults(h.pi, 12)
    expect(h.fetchBodies).toHaveLength(0)
    expect(h.pi.messages).toHaveLength(0)
  })

  it("#given enabled and a low score #when min_calls results arrive #then the gate is asked once and nothing is sent", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 3 }, probability: 0.2, key: "secret-key" })
    await h.pi.dispatch("before_agent_start", { type: "before_agent_start", prompt: "fix the build" }, SESSION)
    const entry = h.nextEntry()
    await toolResults(h.pi, 3)
    expect(await entry).toMatchObject({ triggered: false, gate: { kind: "judged", stuck: 0.2, trouble: "error_streak" } })
    expect(h.fetchBodies).toHaveLength(1)
    const body = h.fetchBodies[0]
    expect(body?.["model"]).toBe("sionic-ai/jev-omni")
    expect(body?.["questions"]).toMatchObject({ stuck: { type: "noul" }, kind: { type: "choice" } })
    expect(body?.["state"]).toMatchObject({ task: "fix the build", counts: { error_run: 3, identical_run: 3 } })
    expect(h.fetchHeaders[0]?.["authorization"]).toBe("Bearer secret-key")
    expect(h.childRequests).toHaveLength(0)
    expect(h.pi.messages).toHaveLength(0)
  })

  it("#given a high score #when the gate fires #then the pinned advisor model's hint is steered in, capped per session", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 2, cooldown: 0, max_per_session: 1, model: "openai/gpt-x" }, probability: 0.95, key: "k" })
    const entry = h.nextEntry()
    await toolResults(h.pi, 2)
    expect(await entry).toMatchObject({ triggered: true, advice: { kind: "advice" } })
    expect(h.childRequests[0]).toMatchObject({ model: "openai/gpt-x", thinking: "medium" })
    expect(h.childRequests[0]?.prompt).toContain("label=error_streak")
    expect(h.pi.messages).toHaveLength(0)
    await toolResults(h.pi, 1)
    expect(h.pi.messages).toHaveLength(1)
    expect(h.pi.messages[0]?.message).toMatchObject({ customType: ADVISOR_ADVICE_TYPE, display: false })
    expect(String(h.pi.messages[0]?.message["content"])).toContain("ROOT CAUSE: the header path is wrong")
    expect(h.pi.messages[0]?.options).toEqual({ deliverAs: "steer" })
    await toolResults(h.pi, 6)
    expect(h.fetchBodies).toHaveLength(1)
  })

  it("#given no advisor model pin #when the gate fires #then the newest Claude Opus is asked", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 }, key: "k" })
    const entry = h.nextEntry()
    await toolResults(h.pi, 1)
    await entry
    expect(h.childRequests[0]?.model).toBe(`anthropic/${LATEST_MODEL_BY_FAMILY.claudeOpus}`)
  })

  it("#given no key in the environment #when the gate is due #then no request is made and the miss is recorded", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 } })
    const entry = h.nextEntry()
    await toolResults(h.pi, 1)
    expect(await entry).toMatchObject({ gate: { kind: "no_key" } })
    expect(h.fetchBodies).toHaveLength(0)
  })

  it("#given the advisor child fails #when the gate fires #then the session gets no message", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 }, key: "k", child: { kind: "failed", reason: "timeout" } })
    const entry = h.nextEntry()
    await toolResults(h.pi, 1)
    expect(await entry).toMatchObject({ triggered: true, advice: { kind: "failed", reason: "timeout" } })
    expect(h.pi.messages).toHaveLength(0)
  })


  it("#given a secret in a tool result #when the gate is asked #then the state carries it redacted", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 }, probability: 0.1, key: "k" })
    const entry = h.nextEntry()
    await h.pi.dispatch("tool_result", { type: "tool_result", toolName: "bash", input: { command: "cat .env" }, content: [{ type: "text", text: "OPENAI_API_KEY=sk-live-abc123" }], isError: false }, SESSION)
    await entry
    const state = JSON.stringify(h.fetchBodies[0]?.["state"])
    expect(state).not.toContain("sk-live-abc123")
    expect(state).toContain("OPENAI_API_KEY=[REDACTED]")
  })





})
