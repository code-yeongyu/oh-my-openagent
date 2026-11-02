/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import type { AdvisorChildOutcome, AdvisorChildRequest } from "./advisor-child"
import { ADVISOR_ADVICE_TYPE, ADVISOR_GATE_ENTRY_TYPE, createAdvisorComponent } from "./index"

const KEY_ENV = "TEST_ADVISOR_KEY"

interface Harness {
  readonly pi: FakeExtensionAPI
  readonly fetchBodies: Record<string, unknown>[]
  readonly fetchHeaders: Record<string, string>[]
  readonly childRequests: AdvisorChildRequest[]
  readonly entries: unknown[]
  nextEntry(): Promise<unknown>
}

function setup(input: {
  readonly advisor?: Record<string, unknown>
  readonly probability?: number
  readonly key?: string
  readonly child?: AdvisorChildOutcome
}): Harness {
  const pi = new FakeExtensionAPI()
  const fetchBodies: Record<string, unknown>[] = []
  const fetchHeaders: Record<string, string>[] = []
  const childRequests: AdvisorChildRequest[] = []
  const entries: unknown[] = []
  const waiters: Array<(entry: unknown) => void> = []
  Object.assign(pi, {
    appendEntry: (customType: string, data: unknown) => {
      if (customType !== ADVISOR_GATE_ENTRY_TYPE) return
      entries.push(data)
      waiters.shift()?.(data)
    },
  })
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    fetchBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    fetchHeaders.push(init?.headers as Record<string, string>)
    return new Response(JSON.stringify({ answers: { stuck: { type: "noul", noul: input.probability ?? 0.9 }, kind: { type: "choice", choice: "error_streak", confidence: 0.9 } }, usage: { input_tokens: 42 } }))
  }) as typeof fetch
  const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: (name) => pi.getFlag(name) } }
  createAdvisorComponent({
    env: input.key === undefined ? {} : { [KEY_ENV]: input.key },
    loadConfig: () => ({ advisor: { api_key_env: KEY_ENV, ...input.advisor } }) as unknown as OmoConfig,
    fetch: fakeFetch,
    runChild: async (request) => {
      childRequests.push(request)
      return input.child ?? { kind: "advice", text: "ROOT CAUSE: the header path is wrong. DO THIS: 1. read the first error.", model: "anthropic/claude-opus-5-5", ms: 5 }
    },
  }).register(pi, ctx)
  const nextEntry = (): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const entry = new Promise<unknown>((resolve) => waiters.push(resolve))
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("waited 5s for an advisor gate entry, none was appended")), 5000)
    })
    return Promise.race([entry, timeout]).finally(() => clearTimeout(timer))
  }
  return { pi, fetchBodies, fetchHeaders, childRequests, entries, nextEntry }
}

const SESSION = { cwd: "/repo", sessionManager: { getSessionId: () => "s-1" } }

async function toolResults(pi: FakeExtensionAPI, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await pi.dispatch("tool_result", { type: "tool_result", toolName: "bash", input: { command: "make" }, content: [{ type: "text", text: "error: x" }], isError: true }, SESSION)
  }
}

describe("advisor component", () => {
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
    expect(h.pi.messages).toHaveLength(1)
    expect(h.pi.messages[0]?.message).toMatchObject({ customType: ADVISOR_ADVICE_TYPE, display: false })
    expect(String(h.pi.messages[0]?.message["content"])).toContain("ROOT CAUSE: the header path is wrong")
    expect(h.pi.messages[0]?.options).toEqual({ deliverAs: "steer" })
    await toolResults(h.pi, 6)
    expect(h.fetchBodies).toHaveLength(1)
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
})
