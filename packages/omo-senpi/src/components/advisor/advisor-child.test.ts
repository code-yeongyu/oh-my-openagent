/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildSpec, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

import { runAdvisorChild, type AdvisorChildRequest } from "./advisor-child"

const REQUEST: AdvisorChildRequest = {
  sessionId: "s-1",
  sequence: 1,
  cwd: "/repo",
  sessionDir: "/tmp/advisor/s-1",
  agentDir: "/tmp/agent",
  model: "anthropic/claude-opus-5-5",
  thinking: "medium",
  category: "ultrabrain",
  config: {} as OmoConfig,
  registry: undefined,
  prompt: "<task>\nfix it\n</task>",
  timeoutMs: 1000,
}

function fakeRunner(behaviour: { readonly text?: string; readonly hang?: boolean; readonly error?: string }) {
  const specs: ChildSpec[] = []
  let aborted = false
  let disposed = false
  const runner = {
    start: async (spec: ChildSpec) => {
      specs.push(spec)
      return {
        waitForIdle: () => {
          if (behaviour.hang === true) return new Promise<never>(() => {})
          if (behaviour.error !== undefined) return Promise.resolve({ status: "error", failure: { kind: "session_create_failed", message: behaviour.error } })
          return Promise.resolve({ status: "completed", finalResponse: behaviour.text ?? "" })
        },
        lastAssistantText: () => behaviour.text,
        abort: async () => {
          aborted = true
        },
        dispose: async () => {
          disposed = true
        },
      }
    },
  } as unknown as InProcessRunnerLike
  return { runner, specs, aborted: () => aborted, disposed: () => disposed }
}

describe("runAdvisorChild", () => {
  it("#given a pinned model #when the child answers #then the advice comes back from a tool-less child on that model", async () => {
    const fake = fakeRunner({ text: "  Read the first error.  " })
    const outcome = await runAdvisorChild(REQUEST, { createRunner: () => fake.runner })
    expect(outcome).toMatchObject({ kind: "advice", text: "Read the first error.", model: "anthropic/claude-opus-5-5" })
    expect(fake.specs[0]).toMatchObject({ selectedModel: "anthropic/claude-opus-5-5", thinkingLevel: "medium", toolAllowlist: [], completion: "turn", parentSessionId: "s-1", prompt: "<task>\nfix it\n</task>" })
    expect(fake.disposed()).toBe(true)
  })

  it("#given a child that never settles #when the timeout passes #then it is aborted and reported", async () => {
    const fake = fakeRunner({ hang: true })
    const outcome = await runAdvisorChild({ ...REQUEST, timeoutMs: 10 }, { createRunner: () => fake.runner })
    expect(outcome).toEqual({ kind: "failed", reason: "timeout", model: "anthropic/claude-opus-5-5" })
    expect(fake.aborted()).toBe(true)
    expect(fake.disposed()).toBe(true)
  })

  it("#given an empty reply #when the child settles #then no advice is produced", async () => {
    const fake = fakeRunner({ text: "   " })
    expect(await runAdvisorChild(REQUEST, { createRunner: () => fake.runner })).toMatchObject({ kind: "failed", reason: "empty at medium, then empty at low" })
    expect(fake.specs).toHaveLength(2)
  })

  it("#given an empty reply at a high thinking level #when the child settles #then it retries once at low and returns that plan", async () => {
    const specs: ChildSpec[] = []
    const runner = {
      start: async (spec: ChildSpec) => {
        specs.push(spec)
        const text = spec.thinkingLevel === "low" ? "ROOT CAUSE: x" : ""
        return {
          waitForIdle: () => Promise.resolve({ status: "completed", finalResponse: text }),
          lastAssistantText: () => text,
          abort: async () => {},
          dispose: async () => {},
        }
      },
    } as unknown as InProcessRunnerLike
    const outcome = await runAdvisorChild({ ...REQUEST, thinking: "max" }, { createRunner: () => runner })
    expect(outcome).toMatchObject({ kind: "advice", text: "ROOT CAUSE: x" })
    expect(specs.map((spec) => spec.thinkingLevel)).toEqual(["max", "low"])
  })

  it("#given an empty reply already at low thinking #when the child settles #then it does not retry", async () => {
    const fake = fakeRunner({ text: "" })
    expect(await runAdvisorChild({ ...REQUEST, thinking: "low" }, { createRunner: () => fake.runner })).toMatchObject({ kind: "failed", reason: "empty" })
    expect(fake.specs).toHaveLength(1)
  })

  it("#given the provider rejects the advisor model #when the turn ends in error #then the provider message is the reason, not an empty reply", async () => {
    const fake = fakeRunner({ error: "400: model_not_found" })
    const outcome = await runAdvisorChild(REQUEST, { createRunner: () => fake.runner })
    expect(outcome).toEqual({ kind: "failed", reason: "session_create_failed: 400: model_not_found", model: "anthropic/claude-opus-5-5" })
    expect(fake.disposed()).toBe(true)
  })

  it("#given the pinned model cannot start and no category resolves #when asked #then it fails without advice", async () => {
    const specs: ChildSpec[] = []
    const runner = { start: async (spec: ChildSpec) => { specs.push(spec); throw new Error("model unavailable") } } as unknown as InProcessRunnerLike
    const outcome = await runAdvisorChild(REQUEST, { createRunner: () => runner })
    expect(outcome).toMatchObject({ kind: "failed" })
    expect(String(outcome.kind === "failed" ? outcome.reason : "")).toContain("anthropic/claude-opus-5-5: model unavailable")
    expect(specs).toHaveLength(1)
  })
})
