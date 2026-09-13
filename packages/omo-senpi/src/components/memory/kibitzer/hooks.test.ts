import { describe, expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { createMemoryIdentityContext } from "../context"
import { beforeAgentStart } from "../recall-wiring.test-support"
import type { KibitzerDelivery } from "./delivery"
import { registerKibitzerHooks, type KibitzerHookSink, type KibitzerHooksOptions } from "./hooks"

const identity = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-kibitzer-hooks", "agent"),
  binding: { identity: "agent", repoPathHash: "hash", boundAt: 0 },
})

/** A host ctx that reports whether it is still alive; the host disposes it when the handler returns. */
function context(sessionId: string): { readonly ctx: Record<string, unknown>; dispose(): void } {
  let alive = true
  const ctx = {
    sessionManager: { getSessionId: () => sessionId, getBranch: () => [], getEntries: () => [] },
    hasPendingMessages: () => false,
    isIdle: () => false,
    alive: () => alive,
  }
  return { ctx, dispose: () => { alive = false } }
}

interface Recorder {
  readonly sink: KibitzerHookSink
  readonly delivery: Pick<KibitzerDelivery, "onToolResult" | "markRunning" | "markSettled">
  readonly log: string[]
}

function recorder(overrides: { readonly sink?: Partial<KibitzerHookSink>; readonly delivery?: Partial<Recorder["delivery"]> } = {}): Recorder {
  const log: string[] = []
  const alive = (eventCtx: unknown): string => {
    const probe = (eventCtx as { alive?: () => boolean } | undefined)?.alive
    return probe === undefined ? "?" : probe() ? "live" : "disposed"
  }
  return {
    log,
    sink: {
      onPrompt: (payload, eventCtx) => { log.push(`sink:prompt:${alive(eventCtx)}:${String((payload as { prompt?: string }).prompt)}`) },
      onToolCall: (payload, eventCtx) => { log.push(`sink:tool_call:${alive(eventCtx)}:${String((payload as { toolName?: string }).toolName)}`) },
      onToolResult: (payload, eventCtx) => { log.push(`sink:tool_result:${alive(eventCtx)}:${String((payload as { toolName?: string }).toolName)}`) },
      onSettled: (eventCtx) => { log.push(`sink:settled:${alive(eventCtx)}`) },
      ...overrides.sink,
    },
    delivery: {
      onToolResult: async (sessionId, _context, eventCtx) => { log.push(`delivery:tool_result:${alive(eventCtx)}:${sessionId}`) },
      markRunning: (sessionId) => { log.push(`delivery:running:${sessionId}`) },
      markSettled: (sessionId) => { log.push(`delivery:settled:${sessionId}`) },
      ...overrides.delivery,
    },
  }
}

function options(r: Recorder, overrides: Partial<KibitzerHooksOptions> = {}): KibitzerHooksOptions {
  return {
    env: {},
    sink: r.sink,
    delivery: r.delivery,
    resolveContext: () => identity,
    resolveSessionId: (eventCtx) => {
      const manager = (eventCtx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager
      return manager?.getSessionId?.()
    },
    ...overrides,
  }
}

describe("registerKibitzerHooks", () => {
  test("#given the four Kibitzer hooks #when a turn's events dispatch #then every capture runs synchronously on the live ctx, before delivery and before the host disposes it", async () => {
    const pi = new FakeExtensionAPI()
    const r = recorder()
    registerKibitzerHooks(pi, options(r))
    const host = context("session-1")

    const results: unknown[][] = []
    results.push(await pi.dispatch("before_agent_start", beforeAgentStart("recall this"), host.ctx))
    results.push(await pi.dispatch("tool_call", { toolName: "read", input: { path: "README.md" } }, host.ctx))
    results.push(await pi.dispatch("tool_result", { toolName: "read", content: [{ type: "text", text: "# readme" }] }, host.ctx))
    results.push(await pi.dispatch("agent_settled", {}, host.ctx))
    host.dispose()

    expect(results).toEqual([[undefined], [undefined], [undefined], [undefined]])
    expect(r.log).toEqual([
      "delivery:running:session-1",
      "sink:prompt:live:recall this",
      "sink:tool_call:live:read",
      "sink:tool_result:live:read",
      "delivery:tool_result:live:session-1",
      "delivery:settled:session-1",
      "sink:settled:live",
    ])
  })

  test("#given a before_agent_start payload that is not a prompt #when dispatched #then nothing is captured or marked", async () => {
    const pi = new FakeExtensionAPI()
    const r = recorder()
    registerKibitzerHooks(pi, options(r))

    const result = await pi.dispatch("before_agent_start", { type: "before_agent_start" }, context("session-1").ctx)

    expect(result).toEqual([undefined])
    expect(r.log).toEqual([])
  })

  test.each(["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"])("#given a %s child process #when hooks dispatch #then no event reaches the sidecar", async (sentinel) => {
    const pi = new FakeExtensionAPI()
    const r = recorder()
    registerKibitzerHooks(pi, options(r, { env: { [sentinel]: "1" } }))
    const host = context("child")

    const results = [
      await pi.dispatch("before_agent_start", beforeAgentStart("recall this"), host.ctx),
      await pi.dispatch("tool_call", { toolName: "read", input: { path: "README.md" } }, host.ctx),
      await pi.dispatch("tool_result", { toolName: "read", content: [] }, host.ctx),
      await pi.dispatch("agent_settled", {}, host.ctx),
    ]

    expect(results).toEqual([[undefined], [undefined], [undefined], [undefined]])
    expect(r.log.filter((line) => line.startsWith("sink:"))).toEqual([])
  })

  test("#given a tool_result for an unbound session #when dispatched #then the event is still captured and delivery is skipped", async () => {
    const pi = new FakeExtensionAPI()
    const r = recorder()
    registerKibitzerHooks(pi, options(r, { resolveContext: () => undefined }))

    await pi.dispatch("tool_result", { toolName: "read", content: [] }, context("unbound").ctx)

    expect(r.log).toEqual(["sink:tool_result:live:read"])
  })

  test("#given a sink that throws on tool_call #when dispatched #then the handler resolves undefined and warns once", async () => {
    const pi = new FakeExtensionAPI()
    const warnings: unknown[][] = []
    const r = recorder({ sink: { onToolCall: () => { throw new Error("boom") } } })
    registerKibitzerHooks(pi, options(r, { logger: { warn: (...args) => { warnings.push(args) }, info: () => {}, error: () => {} } }))

    const result = await pi.dispatch("tool_call", { toolName: "read", input: {} }, context("session-warning").ctx)

    expect(result).toEqual([undefined])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.[0]).toBe("omo-senpi kibitzer tool_call capture failed")
  })

  test("#given a delivery whose onToolResult rejects #when tool_result dispatches #then the capture still happened, the handler resolves undefined and a warning is logged", async () => {
    const pi = new FakeExtensionAPI()
    const warnings: unknown[][] = []
    const r = recorder({ delivery: { onToolResult: async () => { throw new Error("boom") } } })
    registerKibitzerHooks(pi, options(r, { logger: { warn: (...args) => { warnings.push(args) }, info: () => {}, error: () => {} } }))

    const result = await pi.dispatch("tool_result", { toolName: "read", content: [] }, context("session-warning").ctx)

    expect(result).toEqual([undefined])
    expect(r.log).toEqual(["sink:tool_result:live:read"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.[0]).toBe("omo-senpi kibitzer tool_result delivery failed")
  })

  test("#given a stale session resolver #when before_agent_start dispatches #then it returns undefined and warns", async () => {
    const pi = new FakeExtensionAPI()
    const warnings: unknown[] = []
    const r = recorder()
    registerKibitzerHooks(pi, options(r, {
      resolveSessionId: () => { throw new Error("stale context") },
      logger: { warn: (_message, details) => { warnings.push(details) }, info: () => {}, error: () => {} },
    }))

    const result = await pi.dispatch("before_agent_start", beforeAgentStart("recall this"), context("stale").ctx)

    expect(result).toEqual([undefined])
    expect(warnings).toHaveLength(1)
    expect(r.log).toEqual([])
  })
})
