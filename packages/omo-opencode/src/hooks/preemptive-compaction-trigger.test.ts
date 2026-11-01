/// <reference types="bun-types" />

import { afterAll, describe, expect, it, mock } from "bun:test"

import type { CachedCompactionState } from "./preemptive-compaction-types"

const logMock = mock(() => {})

mock.module("../shared/logger", () => ({
  log: logMock,
}))

afterAll(() => {
  mock.restore()
})

const { runPreemptiveCompactionIfNeeded } = await import("./preemptive-compaction-trigger")

function createMockCtx() {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => Promise.resolve({})),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    directory: "/tmp/test",
  }
}

function createUnknownLimitTokenCache(sessionID: string): Map<string, CachedCompactionState> {
  const tokenCache = new Map<string, CachedCompactionState>()
  tokenCache.set(sessionID, {
    providerID: "some-unregistered-provider",
    modelID: "some-unregistered-model",
    tokens: { input: 500000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  return tokenCache
}

function createDefaultArgs(sessionID: string) {
  return {
    ctx: createMockCtx() as never,
    pluginConfig: {} as never,
    sessionID,
    tokenCache: createUnknownLimitTokenCache(sessionID),
    compactionInProgress: new Set<string>(),
    compactedSessions: new Set<string>(),
    lastCompactionTime: new Map<string, number>(),
    contextLimitWarnedSessions: new Set<string>(),
  }
}

describe("runPreemptiveCompactionIfNeeded - unknown context limit toast", () => {
  // #given a session whose cached provider/model has no known context limit
  // #when runPreemptiveCompactionIfNeeded runs for the first time
  // #then it shows exactly one warning toast and records the session as warned
  it("shows a toast once when the context limit is unknown for the current model", async () => {
    const args = createDefaultArgs("ses_unknown_limit")

    await runPreemptiveCompactionIfNeeded(args)

    expect(args.ctx.client.tui.showToast).toHaveBeenCalledTimes(1)
    const [call] = (args.ctx.client.tui.showToast as ReturnType<typeof mock>).mock.calls
    expect(call[0].body.variant).toBe("warning")
    expect(call[0].body.message).toContain("some-unregistered-provider/some-unregistered-model")
    expect(args.contextLimitWarnedSessions.has("ses_unknown_limit")).toBe(true)
  })

  // #given a session that has already been warned about an unknown context limit
  // #when runPreemptiveCompactionIfNeeded runs again for the same session
  // #then no additional toast is shown
  it("does not show a second toast for the same session on a repeat call", async () => {
    const args = createDefaultArgs("ses_repeat_warned")

    await runPreemptiveCompactionIfNeeded(args)
    await runPreemptiveCompactionIfNeeded(args)

    expect(args.ctx.client.tui.showToast).toHaveBeenCalledTimes(1)
  })

  // #given two independent sessions that both hit the unknown-context-limit branch
  // #when runPreemptiveCompactionIfNeeded runs once per session
  // #then each session gets its own toast
  it("shows a separate toast for a different session under the same condition", async () => {
    const ctx = createMockCtx()
    const contextLimitWarnedSessions = new Set<string>()

    const argsA = {
      ctx: ctx as never,
      pluginConfig: {} as never,
      sessionID: "ses_a",
      tokenCache: createUnknownLimitTokenCache("ses_a"),
      compactionInProgress: new Set<string>(),
      compactedSessions: new Set<string>(),
      lastCompactionTime: new Map<string, number>(),
      contextLimitWarnedSessions,
    }
    const argsB = {
      ...argsA,
      sessionID: "ses_b",
      tokenCache: createUnknownLimitTokenCache("ses_b"),
    }

    await runPreemptiveCompactionIfNeeded(argsA)
    await runPreemptiveCompactionIfNeeded(argsB)

    expect(ctx.client.tui.showToast).toHaveBeenCalledTimes(2)
    expect(contextLimitWarnedSessions.has("ses_a")).toBe(true)
    expect(contextLimitWarnedSessions.has("ses_b")).toBe(true)
  })
})
