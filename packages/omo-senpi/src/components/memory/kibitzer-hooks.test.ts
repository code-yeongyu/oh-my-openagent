import { describe, expect, test } from "bun:test"

import { buildIdentityPaths, PendingNudges, RecallLedger } from "@oh-my-opencode/memory-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext } from "./context"
import { registerKibitzerHooks } from "./kibitzer-hooks"
import { createKibitzerTrigger, type KibitzerTriggerOptions } from "./kibitzer-trigger"
import { createKibitzerDelivery } from "./kibitzer-delivery"
import { ToolArgWindow } from "./recall-query-planner-tools"
import { beforeAgentStart } from "./recall-wiring.test-support"

const identity = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-kibitzer-hooks", "agent"),
  binding: { identity: "agent", repoPathHash: "hash", boundAt: 0 },
})

function context(sessionId: string, entries: readonly unknown[] = []): Record<string, unknown> {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => entries,
    },
    hasPendingMessages: () => false,
    isIdle: () => false,
  }
}

function ports(overrides: Partial<KibitzerTriggerOptions> = {}) {
  return {
    env: {},
    trigger: createKibitzerTrigger({
      snapshotSession: () => undefined, resolveModelRegistry: () => undefined,
      collectCandidatesFromSnapshot: async () => undefined,
      runnerFor: () => ({ launch: async () => ({ status: "empty" }) }),
      resolveContext: () => identity, onAccepted: async () => {}, report: () => {},
      currentCompactionEpoch: () => 0, argWindow: new ToolArgWindow(), ...overrides,
    }),
    delivery: createKibitzerDelivery({
      ledgerFor: () => new RecallLedger(identity.identityPaths.recallLedger),
      pendingFor: () => new PendingNudges(identity.identityPaths.recallPending),
      sendMessage: () => {}, appendEntry: () => {},
    }),
  }
}

describe("registerKibitzerHooks", () => {
  test("#given a tool call #when dispatched #then the trigger receives it synchronously", async () => {
    const pi = new FakeExtensionAPI()
    const calls: unknown[][] = []
    const eventCtx = context("session-tool-call")
    const f = ports()
    registerKibitzerHooks(pi, {
      ...f,
      trigger: {
        ...f.trigger,
        onToolCall: (payload, ctx) => { calls.push([payload, ctx]) },
        onSettled: () => {},
      },
      delivery: {
        ...f.delivery,
        onToolResult: async () => {},
      },
      resolveContext: () => undefined,
      resolveSessionId: () => "session-tool-call",
    })

    const payload = { toolName: "read", input: { path: "README.md" } }
    const result = await pi.dispatch("tool_call", payload, eventCtx)

    expect(calls).toEqual([[payload, eventCtx]])
    expect(result).toEqual([undefined])
  })

  test("#given a tool result #when dispatched #then delivery receives the session id and event context", async () => {
    const pi = new FakeExtensionAPI()
    const calls: unknown[][] = []
    const eventCtx = context("session-tool-result")
    const f = ports()
    registerKibitzerHooks(pi, {
      ...f,
      trigger: {
        ...f.trigger,
        onToolCall: () => {},
        onSettled: () => {},
      },
      delivery: {
        ...f.delivery,
        onToolResult: async (...args) => { calls.push(args) },
      },
      resolveContext: () => identity,
      resolveSessionId: () => "session-tool-result",
    })

    const result = await pi.dispatch("tool_result", { toolName: "read" }, eventCtx)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe("session-tool-result")
    expect(calls[0]?.[1]).toBe(identity)
    expect(calls[0]?.[2]).toBe(eventCtx)
    expect(result).toEqual([undefined])
  })

  test("#given text-only and empty sessions #when agent_settled dispatches #then only the non-empty branch settles", async () => {
    const pi = new FakeExtensionAPI()
    const settled: unknown[] = []
    const f = ports()
    registerKibitzerHooks(pi, {
      ...f,
      trigger: { ...f.trigger, onToolCall: () => {}, onSettled: (eventCtx) => { settled.push(eventCtx) } },
      delivery: { ...f.delivery, onToolResult: async () => {} },
      resolveContext: () => undefined,
      resolveSessionId: () => undefined,
    })

    await pi.dispatch("agent_settled", {}, context("text-only", [
      { type: "message", message: { role: "user", content: "hello" } },
      { type: "message", message: { role: "assistant", content: "hi" } },
    ]))
    await pi.dispatch("agent_settled", {}, context("empty"))

    expect(settled).toHaveLength(1)
  })

  test("#given a delivery whose onToolResult rejects #when tool_result dispatches #then the handler resolves undefined and a warning is logged", async () => {
    const pi = new FakeExtensionAPI()
    const warnings: unknown[][] = []
    const f = ports()
    registerKibitzerHooks(pi, {
      ...f,
      trigger: { ...f.trigger, onToolCall: () => {}, onSettled: () => {} },
      delivery: { ...f.delivery, onToolResult: async () => { throw new Error("boom") } },
      resolveContext: () => identity,
      resolveSessionId: () => "session-warning",
      logger: { warn: (...args) => { warnings.push(args) }, info: () => {}, error: () => {} },
    })

    const result = await pi.dispatch("tool_result", {}, context("session-warning"))

    expect(result).toEqual([undefined])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.[0]).toBe("omo-senpi kibitzer tool_result delivery failed")
  })

  test.each(["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"])("#given a %s child #when before_agent_start dispatches #then the judge is never triggered", async (sentinel) => {
    // given
    const pi = new FakeExtensionAPI()
    let snapshots = 0
    const f = ports({ snapshotSession: () => { snapshots += 1; return undefined } })
    const options = { ...f, env: { [sentinel]: "1" }, resolveContext: () => identity, resolveSessionId: () => "child" }
    registerKibitzerHooks(pi, options)
    // when
    const result = await pi.dispatch("before_agent_start", beforeAgentStart("recall this"), context("child"))
    await f.trigger.whenIdle()
    // then
    expect(result).toEqual([undefined])
    expect(snapshots).toBe(0)
  })

  test("#given a stale session resolver #when before_agent_start dispatches #then it returns undefined and warns", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const warnings: unknown[] = []
    const f = ports()
    registerKibitzerHooks(pi, {
      ...f, resolveContext: () => identity, resolveSessionId: () => { throw new Error("stale context") },
      logger: { warn: (_message, details) => { warnings.push(details) }, info: () => {}, error: () => {} },
    })
    // when
    const result = await pi.dispatch("before_agent_start", beforeAgentStart("recall this"), context("stale"))
    // then
    expect(result).toEqual([undefined])
    expect(warnings).toHaveLength(1)
  })

  test("#given a trigger that throws #when tool_call dispatches #then it returns undefined and warns", async () => {
    const pi = new FakeExtensionAPI()
    const warnings: unknown[][] = []
    const f = ports()
    registerKibitzerHooks(pi, {
      ...f,
      trigger: {
        ...f.trigger,
        onToolCall: () => { throw new Error("boom") },
        onSettled: () => {},
      },
      delivery: { ...f.delivery, onToolResult: async () => {} },
      resolveContext: () => undefined,
      resolveSessionId: () => undefined,
      logger: { warn: (...args) => { warnings.push(args) }, info: () => {}, error: () => {} },
    })

    const result = await pi.dispatch("tool_call", {}, context("session-warning"))

    expect(result).toEqual([undefined])
    expect(warnings).toHaveLength(1)
  })
})
