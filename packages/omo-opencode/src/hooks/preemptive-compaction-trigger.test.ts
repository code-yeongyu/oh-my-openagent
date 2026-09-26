import { describe, expect, it, mock, afterAll } from "bun:test"

import { applyProviderConfig } from "../plugin-handlers/provider-config-handler"
import { createModelCacheState } from "../plugin-state"
import type { OhMyOpenCodeConfig } from "../config"

import type { CachedCompactionState } from "./preemptive-compaction-types"

const logMock = mock(() => {})

mock.module("../shared/logger", () => ({
  log: logMock,
}))

afterAll(() => { mock.restore() })

const { runPreemptiveCompactionIfNeeded } = await import("./preemptive-compaction-trigger")

const PROVIDER_ID = "opencode"
const MODEL_ID = "kimi-k2.5-free"
const CONTEXT_LIMIT = 200_000

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

function createModelCacheWithLimit() {
  const modelCacheState = createModelCacheState()
  applyProviderConfig({
    config: {
      provider: {
        [PROVIDER_ID]: {
          models: {
            [MODEL_ID]: { limit: { context: CONTEXT_LIMIT } },
          },
        },
      },
    },
    modelCacheState,
  })
  return modelCacheState
}

function cachedStateWithRatio(ratio: number): CachedCompactionState {
  return {
    providerID: PROVIDER_ID,
    modelID: MODEL_ID,
    tokens: {
      input: Math.round(CONTEXT_LIMIT * ratio),
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function createRunArgs(options: {
  sessionID: string
  ratio: number
  pluginConfig: OhMyOpenCodeConfig
  toolName?: string
}) {
  return {
    ctx: createMockCtx(),
    pluginConfig: options.pluginConfig,
    modelCacheState: createModelCacheWithLimit(),
    sessionID: options.sessionID,
    tokenCache: new Map<string, CachedCompactionState>([
      [options.sessionID, cachedStateWithRatio(options.ratio)],
    ]),
    compactionInProgress: new Set<string>(),
    compactedSessions: new Set<string>(),
    lastCompactionTime: new Map<string, number>(),
    toolName: options.toolName,
  }
}

describe("runPreemptiveCompactionIfNeeded config-driven trip point", () => {
  it("compacts at the configured threshold (0.6) when usage reaches it", async () => {
    // given
    const args = createRunArgs({
      sessionID: "ses_threshold_hit",
      ratio: 0.6,
      pluginConfig: { compaction: { preemptive_threshold: 0.6 } } as OhMyOpenCodeConfig,
    })

    // when
    await runPreemptiveCompactionIfNeeded(args)

    // then
    expect(args.ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })

  it("does NOT compact below the configured threshold (0.6) at 0.5 usage", async () => {
    // given
    const args = createRunArgs({
      sessionID: "ses_threshold_miss",
      ratio: 0.5,
      pluginConfig: { compaction: { preemptive_threshold: 0.6 } } as OhMyOpenCodeConfig,
    })

    // when
    await runPreemptiveCompactionIfNeeded(args)

    // then
    expect(args.ctx.client.session.summarize).not.toHaveBeenCalled()
  })
})

describe("runPreemptiveCompactionIfNeeded enabled gate", () => {
  it("does NOT compact when compaction.enabled is false even above threshold", async () => {
    // given
    const args = createRunArgs({
      sessionID: "ses_disabled",
      ratio: 0.99,
      pluginConfig: { compaction: { enabled: false } } as OhMyOpenCodeConfig,
    })

    // when
    await runPreemptiveCompactionIfNeeded(args)

    // then
    expect(args.ctx.client.session.summarize).not.toHaveBeenCalled()
  })
})

describe("runPreemptiveCompactionIfNeeded mid-collection guard", () => {
  it("does NOT compact when the finished tool is background_output even above threshold", async () => {
    // given
    const args = createRunArgs({
      sessionID: "ses_bg_output",
      ratio: 0.99,
      pluginConfig: {} as OhMyOpenCodeConfig,
      toolName: "background_output",
    })

    // when
    await runPreemptiveCompactionIfNeeded(args)

    // then
    expect(args.ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("compacts above threshold for an ordinary tool with default config", async () => {
    // given
    const args = createRunArgs({
      sessionID: "ses_ordinary_tool",
      ratio: 0.99,
      pluginConfig: {} as OhMyOpenCodeConfig,
      toolName: "bash",
    })

    // when
    await runPreemptiveCompactionIfNeeded(args)

    // then
    expect(args.ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })
})
