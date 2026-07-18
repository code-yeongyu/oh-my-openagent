import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"
import { createSessionHooks } from "./create-session-hooks"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const mockContext = unsafeTestValue<PluginContext>({
  directory: "/tmp",
  client: {
    tui: {
      showToast: async () => ({}),
    },
    session: {
      get: async () => ({ data: null }),
      update: async () => ({}),
    },
  },
})

const mockModelCacheState = {} as ModelCacheState
const mockBackgroundManager = unsafeTestValue<BackgroundManager>({})

describe("createSessionHooks", () => {
  it("keeps model fallback disabled when config is unset", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName) => hookName === "model-fallback",
      safeHookEnabled: true,
    })

    // then
    expect(result.modelFallback).toBeNull()
  })

  it("creates model fallback hook when config explicitly enables it", () => {
    // given
    const pluginConfig = { model_fallback: true } as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName) => hookName === "model-fallback",
      safeHookEnabled: true,
    })

    // then
    expect(result.modelFallback).not.toBeNull()
  })

  it("does not create removed context window monitor hook", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName: string) => hookName === "context-window-monitor",
      safeHookEnabled: true,
    })

    // then
    expect("contextWindowMonitor" in result).toBe(false)
  })

  it("skips interactive bash session hook when tmux integration is disabled", () => {
    // given
    const pluginConfig = {
      tmux: {
        enabled: false,
        layout: "main-vertical",
        main_pane_size: 60,
        main_pane_min_width: 120,
        agent_pane_min_width: 40,
        isolation: "inline",
      },
    } as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName) => hookName === "interactive-bash-session",
      safeHookEnabled: true,
    })

    // then
    expect(result.interactiveBashSession).toBeNull()
  })

  it("skips codegraph bootstrap when disabled hooks exclude it", () => {
    // given
    const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({})

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName) => hookName !== "codegraph-bootstrap",
      safeHookEnabled: true,
    })

    // then
    expect(result.codegraphBootstrap).toBeNull()
  })

  it("keeps codegraph bootstrap registered when the hook is enabled", () => {
    // given
    const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({
      codegraph: {
        enabled: false,
      },
    })

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName) => hookName === "codegraph-bootstrap",
      safeHookEnabled: true,
    })

    // then
    expect(result.codegraphBootstrap).not.toBeNull()
  })

  describe("preemptiveCompaction opt-out gating", () => {
    it("creates the hook when experimental.preemptive_compaction is left unset", () => {
      // given
      const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({})

      // when
      const result = createSessionHooks({
        ctx: mockContext,
        pluginConfig,
        modelCacheState: mockModelCacheState,
        backgroundManager: mockBackgroundManager,
        isHookEnabled: (hookName) => hookName === "preemptive-compaction",
        safeHookEnabled: true,
      })

      // then
      expect(result.preemptiveCompaction).not.toBeNull()
    })

    it("creates the hook when experimental.preemptive_compaction is explicitly true", () => {
      // given
      const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({
        experimental: {
          preemptive_compaction: true,
        },
      })

      // when
      const result = createSessionHooks({
        ctx: mockContext,
        pluginConfig,
        modelCacheState: mockModelCacheState,
        backgroundManager: mockBackgroundManager,
        isHookEnabled: (hookName) => hookName === "preemptive-compaction",
        safeHookEnabled: true,
      })

      // then
      expect(result.preemptiveCompaction).not.toBeNull()
    })

    it("skips the hook when experimental.preemptive_compaction is explicitly false", () => {
      // given
      const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({
        experimental: {
          preemptive_compaction: false,
        },
      })

      // when
      const result = createSessionHooks({
        ctx: mockContext,
        pluginConfig,
        modelCacheState: mockModelCacheState,
        backgroundManager: mockBackgroundManager,
        isHookEnabled: (hookName) => hookName === "preemptive-compaction",
        safeHookEnabled: true,
      })

      // then
      expect(result.preemptiveCompaction).toBeNull()
    })

    it("skips the hook when disabled_hooks excludes preemptive-compaction, regardless of the experimental flag", () => {
      // given
      const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({
        experimental: {
          preemptive_compaction: true,
        },
      })

      // when
      const result = createSessionHooks({
        ctx: mockContext,
        pluginConfig,
        modelCacheState: mockModelCacheState,
        backgroundManager: mockBackgroundManager,
        isHookEnabled: (hookName) => hookName !== "preemptive-compaction",
        safeHookEnabled: true,
      })

      // then
      expect(result.preemptiveCompaction).toBeNull()
    })
  })
})
