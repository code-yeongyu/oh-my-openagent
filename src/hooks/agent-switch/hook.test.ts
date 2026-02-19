/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import { createAgentSwitchHook } from "./hook"
import {
  _resetForTesting,
  getPendingSwitch,
  setPendingSwitch,
} from "../../features/agent-switch"
import { _resetApplierForTesting, clearPendingSwitchRuntime } from "../../features/agent-switch/applier"

describe("agent-switch hook", () => {
  beforeEach(() => {
    _resetForTesting()
    _resetApplierForTesting()
  })

  test("consumes pending switch only after successful promptAsync", async () => {
    const promptAsyncCalls: Array<Record<string, unknown>> = []
    let switched = false
    const ctx = {
      client: {
        session: {
          promptAsync: async (args: Record<string, unknown>) => {
            promptAsyncCalls.push(args)
            switched = true
          },
          messages: async () => switched
            ? ({ data: [{ info: { role: "user", agent: "Prometheus (Plan Builder)" } }] })
            : ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-1", "prometheus", "plan this")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "ses-1" },
      },
    })

    expect(promptAsyncCalls).toHaveLength(1)
    expect(getPendingSwitch("ses-1")).toBeUndefined()
  })

  test("keeps pending switch when promptAsync fails", async () => {
    const ctx = {
      client: {
        session: {
          promptAsync: async () => {
            throw new Error("temporary failure")
          },
          messages: async () => ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-2", "atlas", "fix this")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "ses-2" },
      },
    })

    expect(getPendingSwitch("ses-2")).toEqual({
      agent: "atlas",
      context: "fix this",
    })

    clearPendingSwitchRuntime("ses-2")
  })

  test("retries after transient failure and eventually clears pending switch", async () => {
    let attempts = 0
    let switched = false
    const ctx = {
      client: {
        session: {
          promptAsync: async () => {
            attempts += 1
            if (attempts === 1) {
              throw new Error("temporary failure")
            }
            switched = true
          },
          messages: async () => switched
            ? ({ data: [{ info: { role: "user", agent: "Prometheus (Plan Builder)" } }] })
            : ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-3", "prometheus", "plan this")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "ses-3" },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(attempts).toBe(2)
    expect(getPendingSwitch("ses-3")).toBeUndefined()
  })

  test("clears pending switch on session.deleted", async () => {
    const ctx = {
      client: {
        session: {
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-4", "atlas", "fix this")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: "ses-4" } },
      },
    })

    expect(getPendingSwitch("ses-4")).toBeUndefined()
  })

  test("clears pending switch on session.error with info.id", async () => {
    const ctx = {
      client: {
        session: {
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-10", "atlas", "fix this")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "session.error",
        properties: { info: { id: "ses-10" } },
      },
    })

    expect(getPendingSwitch("ses-10")).toBeUndefined()
  })

  test("clears pending switch on session.error with sessionID property", async () => {
    const ctx = {
      client: {
        session: {
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-11", "atlas", "fix this")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses-11" },
      },
    })

    expect(getPendingSwitch("ses-11")).toBeUndefined()
  })

  test("recovers missing switch_agent tool call from Athena handoff text", async () => {
    const promptAsyncCalls: Array<Record<string, unknown>> = []
    let switched = false
    const ctx = {
      client: {
        session: {
          promptAsync: async (args: Record<string, unknown>) => {
            promptAsyncCalls.push(args)
            switched = true
          },
          messages: async () => switched
            ? ({ data: [{ info: { role: "user", agent: "Prometheus (Plan Builder)" } }] })
            : ({ data: [] }),
          message: async () => ({
            data: {
              parts: [
                {
                  type: "text",
                  text: "Switching to **Prometheus** now — they'll take it from here and craft a plan for you!",
                },
              ],
            },
          }),
        },
      },
    } as any

    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-athena-1",
            sessionID: "ses-5",
            role: "assistant",
            agent: "Athena (Council)",
            finish: "stop",
          },
        },
      },
    })

    expect(promptAsyncCalls).toHaveLength(1)
    const body = promptAsyncCalls[0]?.body as { agent?: string } | undefined
    expect(body?.agent).toBe("Prometheus (Plan Builder)")
    expect(getPendingSwitch("ses-5")).toBeUndefined()
  })

  test("applies queued pending switch on terminal message.updated", async () => {
    const promptAsyncCalls: Array<Record<string, unknown>> = []
    let switched = false
    const ctx = {
      client: {
        session: {
          promptAsync: async (args: Record<string, unknown>) => {
            promptAsyncCalls.push(args)
            switched = true
          },
          messages: async () => switched
            ? ({ data: [{ info: { role: "user", agent: "Atlas (Plan Executor)" } }] })
            : ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-6", "atlas", "fix now")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-6",
            sessionID: "ses-6",
            role: "assistant",
            agent: "Athena (Council)",
            finish: "stop",
          },
        },
      },
    })

    expect(promptAsyncCalls).toHaveLength(1)
    const body = promptAsyncCalls[0]?.body as { agent?: string } | undefined
    expect(body?.agent).toBe("Atlas (Plan Executor)")
    expect(getPendingSwitch("ses-6")).toBeUndefined()
  })

  test("applies queued pending switch on terminal message.updated even when role is missing", async () => {
    const promptAsyncCalls: Array<Record<string, unknown>> = []
    let switched = false
    const ctx = {
      client: {
        session: {
          promptAsync: async (args: Record<string, unknown>) => {
            promptAsyncCalls.push(args)
            switched = true
          },
          messages: async () => switched
            ? ({ data: [{ info: { role: "user", agent: "Atlas (Plan Executor)" } }] })
            : ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-8", "atlas", "fix now")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-8",
            sessionID: "ses-8",
            agent: "Athena (Council)",
            finish: true,
          },
        },
      },
    })

    expect(promptAsyncCalls).toHaveLength(1)
    const body = promptAsyncCalls[0]?.body as { agent?: string } | undefined
    expect(body?.agent).toBe("Atlas (Plan Executor)")
    expect(getPendingSwitch("ses-8")).toBeUndefined()
  })

  test("applies queued pending switch on terminal message.part.updated step-finish", async () => {
    const promptAsyncCalls: Array<Record<string, unknown>> = []
    let switched = false
    const ctx = {
      client: {
        session: {
          promptAsync: async (args: Record<string, unknown>) => {
            promptAsyncCalls.push(args)
            switched = true
          },
          messages: async () => switched
            ? ({ data: [{ info: { role: "user", agent: "Atlas (Plan Executor)" } }] })
            : ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-7", "atlas", "fix now")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: {
            sessionID: "ses-7",
            role: "assistant",
          },
          part: {
            id: "part-finish-1",
            sessionID: "ses-7",
            type: "step-finish",
            reason: "stop",
          },
        },
      },
    })

    expect(promptAsyncCalls).toHaveLength(1)
    const body = promptAsyncCalls[0]?.body as { agent?: string } | undefined
    expect(body?.agent).toBe("Atlas (Plan Executor)")
    expect(getPendingSwitch("ses-7")).toBeUndefined()
  })

  test("applies queued pending switch on session.status idle", async () => {
    const promptAsyncCalls: Array<Record<string, unknown>> = []
    let switched = false
    const ctx = {
      client: {
        session: {
          promptAsync: async (args: Record<string, unknown>) => {
            promptAsyncCalls.push(args)
            switched = true
          },
          messages: async () => switched
            ? ({ data: [{ info: { role: "user", agent: "Atlas (Plan Executor)" } }] })
            : ({ data: [] }),
          message: async () => ({ data: { parts: [] } }),
        },
      },
    } as any

    setPendingSwitch("ses-9", "atlas", "fix now")
    const hook = createAgentSwitchHook(ctx)

    await hook.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: "ses-9",
          status: {
            type: "idle",
          },
        },
      },
    })

    expect(promptAsyncCalls).toHaveLength(1)
    const body = promptAsyncCalls[0]?.body as { agent?: string } | undefined
    expect(body?.agent).toBe("Atlas (Plan Executor)")
    expect(getPendingSwitch("ses-9")).toBeUndefined()
  })
})
