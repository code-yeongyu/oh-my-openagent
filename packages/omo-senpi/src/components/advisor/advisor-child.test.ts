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
  category: "ultrabrain",
  config: {} as OmoConfig,
  registry: undefined,
  state: "TASK:\nfix it",
  timeoutMs: 1000,
}

function fakeRunner(behaviour: { readonly text?: string; readonly hang?: boolean }) {
  const specs: ChildSpec[] = []
  let aborted = false
  let disposed = false
  const runner = {
    start: async (spec: ChildSpec) => {
      specs.push(spec)
      return {
        waitForIdle: () => (behaviour.hang === true ? new Promise<never>(() => {}) : Promise.resolve()),
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
    expect(outcome).toEqual({ kind: "advice", text: "Read the first error.", model: "anthropic/claude-opus-5-5" })
    expect(fake.specs[0]).toMatchObject({ selectedModel: "anthropic/claude-opus-5-5", toolAllowlist: [], completion: "turn", parentSessionId: "s-1" })
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
    expect(await runAdvisorChild(REQUEST, { createRunner: () => fake.runner })).toMatchObject({ kind: "failed", reason: "empty" })
  })

  it("#given no pin and no registry #when the category is resolved #then the child is not started", async () => {
    const fake = fakeRunner({ text: "x" })
    const outcome = await runAdvisorChild({ ...REQUEST, model: undefined }, { createRunner: () => fake.runner })
    expect(outcome.kind).toBe("unavailable")
    expect(fake.specs).toHaveLength(0)
  })
})
