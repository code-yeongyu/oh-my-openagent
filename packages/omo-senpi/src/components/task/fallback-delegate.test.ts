import { describe, expect, it } from "bun:test"

import type { ManagerStartSpec, StartResult } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { wireFallbackDelegate } from "./fallback-delegate"

const ULTRAFAST = "opengateway/moonshotai/kimi-k3-ultrafast"

type CapturedManager = {
  readonly specs: ManagerStartSpec[]
  readonly start: (spec: ManagerStartSpec) => Promise<StartResult>
}

function manager(): CapturedManager {
  const specs: ManagerStartSpec[] = []
  return {
    specs,
    start: async (spec) => {
      specs.push(spec)
      return {
        kind: "started",
        task_id: "st_00000001",
        status: "running",
        name: "st_00000001",
      }
    },
  }
}

function logger(): ComponentLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function event(selector = ULTRAFAST): Record<string, unknown> {
  return {
    type: "retry_fallback_exhausted",
    sessionId: "parent-session",
    chainKey: "opengateway/moonshotai/kimi-k3-ultrafast",
    from: "opengateway/moonshotai/kimi-k3-ultrafast",
    lastError: "provider request failed",
    exhaustionReason: "no-context-compatible-candidate",
    rejectedCandidates: [
      {
        selector,
        reason: "context-unusable",
        projection: {
          model: selector,
          usable: false,
        },
      },
    ],
    responseModel: "moonshotai/kimi-k3",
  }
}

function entries(options: {
  readonly partialOutput?: boolean
  readonly includeRequest?: boolean
  readonly assistantContent?: readonly unknown[]
  readonly errorMessage?: string
} = {}): unknown[] {
  const includeRequest = options.includeRequest ?? true
  return [
    {
      type: "message",
      id: "user-old",
      message: { role: "user", content: [{ type: "text", text: "earlier request" }] },
    },
    {
      type: "message",
      id: "assistant-old",
      message: { role: "assistant", content: [{ type: "text", text: "earlier response" }] },
    },
    {
      type: "compaction",
      id: "compact-1",
      summary: "current compacted context",
    },
    {
      type: "custom",
      id: "todo-1",
      customType: "senpi.todo-state",
      data: {
        schema: "v2",
        phases: [{ name: "Delivery", tasks: [{ content: "finish fallback", status: "in_progress" }] }],
      },
    },
    ...(includeRequest
      ? [{
          type: "message",
          id: "user-current",
          message: { role: "user", content: [{ type: "text", text: "continue the active task" }] },
        }]
      : []),
    {
      type: "message",
      id: "assistant-failed",
      message: {
        role: "assistant",
        content: options.assistantContent
          ?? (options.partialOutput ? [{ type: "text", text: "visible partial answer" }] : []),
        stopReason: "error",
        errorMessage: options.errorMessage ?? "provider request failed",
      },
    },
  ]
}

function context(sessionEntries: readonly unknown[]): Record<string, unknown> {
  return {
    sessionManager: {
      getSessionId: () => "parent-session",
      getEntries: () => sessionEntries,
    },
  }
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    max_handoff_bytes: 32768,
    recent_tail_messages: 8,
    ...overrides,
  }
}

describe("context fallback delegate", () => {
  it("#given duplicate incompatible exhaustion #when both events dispatch #then exactly one fresh child keeps the ultrafast selector", async () => {
    const pi = new FakeExtensionAPI()
    const childManager = manager()
    wireFallbackDelegate(pi, {
      manager: childManager,
      settings: settings(),
      logger: logger(),
      isRpcChild: () => false,
    })

    const first = await pi.dispatch("retry_fallback_exhausted", event(), context(entries()))
    const second = await pi.dispatch("retry_fallback_exhausted", event(), context(entries()))
    await Promise.resolve()

    expect(first).toEqual([undefined])
    expect(second).toEqual([undefined])
    expect(childManager.specs).toHaveLength(1)
    expect(childManager.specs[0]?.model).toBe(ULTRAFAST)
    expect(childManager.specs[0]?.run_in_background).toBe(true)
    expect(childManager.specs[0]?.parent_session_id).toBe("parent-session")
    expect(childManager.specs[0]?.depth).toBe(1)

    const nextTurn = entries().map((entry) => {
      if (typeof entry !== "object" || entry === null) return entry
      return Reflect.get(entry, "id") === "assistant-failed"
        ? { ...entry, id: "assistant-failed-next" }
        : entry
    })
    await pi.dispatch("retry_fallback_exhausted", event(), context(nextTurn))
    await Promise.resolve()
    expect(childManager.specs).toHaveLength(2)
  })

  it("#given a nonsettling child start #when exhaustion dispatches #then the parent event handler returns immediately", async () => {
    const pi = new FakeExtensionAPI()
    const specs: ManagerStartSpec[] = []
    wireFallbackDelegate(pi, {
      manager: {
        start: (spec) => {
          specs.push(spec)
          return new Promise<StartResult>(() => {})
        },
      },
      settings: settings(),
      logger: logger(),
      isRpcChild: () => false,
    })

    const results = await pi.dispatch("retry_fallback_exhausted", event(), context(entries()))

    expect(results).toEqual([undefined])
    expect(specs).toHaveLength(1)
  })

  it("#given a configured override #when exhaustion dispatches #then the override wins verbatim", async () => {
    const pi = new FakeExtensionAPI()
    const childManager = manager()
    wireFallbackDelegate(pi, {
      manager: childManager,
      settings: settings({ model: "opengateway/openai/gpt-5.6-sol" }),
      logger: logger(),
      isRpcChild: () => false,
    })

    await pi.dispatch("retry_fallback_exhausted", event(), context(entries()))
    await Promise.resolve()

    expect(childManager.specs[0]?.model).toBe("opengateway/openai/gpt-5.6-sol")
  })

  it("#given parent session history #when delegation builds the handoff #then every bounded section is carried", async () => {
    const pi = new FakeExtensionAPI()
    const childManager = manager()
    const large = "문맥".repeat(3_000)
    const source = entries().map((entry) => {
      if (typeof entry !== "object" || entry === null) return entry
      if (Reflect.get(entry, "type") === "compaction") return { ...entry, summary: large }
      if (Reflect.get(entry, "customType") === "senpi.todo-state") {
        return {
          ...entry,
          data: {
            schema: "v2",
            phases: [{ name: "Delivery", tasks: [{ content: large, status: "in_progress" }] }],
          },
        }
      }
      return entry
    })
    wireFallbackDelegate(pi, {
      manager: childManager,
      settings: settings({ max_handoff_bytes: 8192, recent_tail_messages: 4 }),
      logger: logger(),
      isRpcChild: () => false,
    })

    await pi.dispatch("retry_fallback_exhausted", event(), context(source))
    await Promise.resolve()
    const prompt = childManager.specs[0]?.prompt
    if (prompt === undefined) throw new Error("missing child prompt")
    const handoff = JSON.parse(prompt)

    expect(handoff.schema).toBe("omo.fallback-delegate.v1")
    expect(handoff.request_id).toBe("assistant-failed")
    expect(handoff.latest_user).toContain("continue the active task")
    expect(handoff.compaction.length).toBeGreaterThan(0)
    expect(handoff.todo.length).toBeGreaterThan(0)
    expect(handoff.recent_tail.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(8192)
  })

  it("#given the minimum valid handoff cap and oversized source diagnostics #when exhaustion dispatches #then one bounded child still starts", async () => {
    const pi = new FakeExtensionAPI()
    const childManager = manager()
    const oversized = {
      ...event(),
      chainKey: "체인".repeat(2_000),
      from: "모델".repeat(2_000),
      lastError: "오류".repeat(10_000),
    }
    wireFallbackDelegate(pi, {
      manager: childManager,
      settings: settings({ max_handoff_bytes: 1024 }),
      logger: logger(),
      isRpcChild: () => false,
    })

    await pi.dispatch(
      "retry_fallback_exhausted",
      oversized,
      context(entries({ errorMessage: oversized.lastError })),
    )
    await Promise.resolve()

    expect(childManager.specs).toHaveLength(1)
    expect(Buffer.byteLength(childManager.specs[0]?.prompt ?? "")).toBeLessThanOrEqual(1024)
  })

  it("#given a huge old history #when a one-message tail is requested #then old message bodies are never materialized", async () => {
    const pi = new FakeExtensionAPI()
    const childManager = manager()
    const inaccessible = {
      type: "message",
      id: "assistant-too-old",
      message: {
        role: "assistant",
        get content(): never {
          throw new Error("old history content was materialized")
        },
      },
    }
    const source = entries()
    source.splice(1, 0, inaccessible, ...Array.from({ length: 100_000 }, (_, index) => ({
      type: "custom",
      id: `old-${index}`,
      customType: "old-state",
      data: index,
    })))
    wireFallbackDelegate(pi, {
      manager: childManager,
      settings: settings({ recent_tail_messages: 1 }),
      logger: logger(),
      isRpcChild: () => false,
    })

    await pi.dispatch("retry_fallback_exhausted", event(), context(source))
    await Promise.resolve()

    expect(childManager.specs).toHaveLength(1)
  })

  it("#given guarded contexts #when exhaustion dispatches #then no child starts", async () => {
    const cases = [
      {
        name: "disabled",
        settings: settings({ enabled: false }),
        event: event(),
        entries: entries(),
        isRpcChild: false,
      },
      {
        name: "rpc child",
        settings: settings(),
        event: event(),
        entries: entries(),
        isRpcChild: true,
      },
      {
        name: "partial output",
        settings: settings(),
        event: event(),
        entries: entries({ partialOutput: true }),
        isRpcChild: false,
      },
      {
        name: "provider-native partial output",
        settings: settings(),
        event: event(),
        entries: entries({ assistantContent: [{ type: "providerNative", value: { id: "response-1" } }] }),
        isRpcChild: false,
      },
      {
        name: "tool-call partial output",
        settings: settings(),
        event: event(),
        entries: entries({ assistantContent: [{ type: "toolCall", id: "call-1", name: "write", arguments: {} }] }),
        isRpcChild: false,
      },
      {
        name: "missing request",
        settings: settings(),
        event: event(),
        entries: entries({ includeRequest: false }),
        isRpcChild: false,
      },
      {
        name: "ordinary exhaustion",
        settings: settings(),
        event: { ...event(), exhaustionReason: "candidates-exhausted" },
        entries: entries(),
        isRpcChild: false,
      },
      {
        name: "missing candidate",
        settings: settings(),
        event: { ...event(), rejectedCandidates: [] },
        entries: entries(),
        isRpcChild: false,
      },
    ]

    for (const testCase of cases) {
      const pi = new FakeExtensionAPI()
      const childManager = manager()
      wireFallbackDelegate(pi, {
        manager: childManager,
        settings: testCase.settings,
        logger: logger(),
        isRpcChild: () => testCase.isRpcChild,
      })

      await pi.dispatch("retry_fallback_exhausted", testCase.event, context(testCase.entries))
      await Promise.resolve()

      expect(childManager.specs, testCase.name).toEqual([])
    }
  })

  it("#given malformed runtime context or a synchronous start failure #when exhaustion dispatches #then it fails closed without duplicate attempts", async () => {
    const pi = new FakeExtensionAPI()
    let attempts = 0
    wireFallbackDelegate(pi, {
      manager: {
        start: () => {
          attempts += 1
          throw new Error("start failed synchronously")
        },
      },
      settings: settings(),
      logger: logger(),
      isRpcChild: () => false,
    })

    await expect(pi.dispatch("retry_fallback_exhausted", event(), {
      sessionManager: {
        getSessionId: () => "parent-session",
        getEntries: () => {
          throw new Error("entries unavailable")
        },
      },
    })).resolves.toEqual([undefined])
    await expect(pi.dispatch("retry_fallback_exhausted", event(), context(entries()))).resolves.toEqual([undefined])
    await expect(pi.dispatch("retry_fallback_exhausted", event(), context(entries()))).resolves.toEqual([undefined])

    expect(attempts).toBe(1)
  })
})
