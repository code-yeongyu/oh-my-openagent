import { afterEach, describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"
import { createSessionHooks } from "./create-session-hooks"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { resetVersionCache, setVersionCache } from "../../shared/opencode-version"

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
  describe("Hephaestus AGENTS.md registration", () => {
    afterEach(resetVersionCache)

    it.each([
      { version: "1.1.36", enabled: true, registered: true },
      { version: "1.1.37", enabled: true, registered: false },
      { version: "1.18.33", enabled: true, registered: false },
      { version: null, enabled: true, registered: true },
      { version: "1.1.36", enabled: false, registered: false },
      { version: null, enabled: false, registered: false },
    ])("registers=$registered when version=$version and enabled=$enabled", ({ version, enabled, registered }) => {
      // given
      setVersionCache(version)

      // when
      const result = createSessionHooks({
        ctx: mockContext,
        pluginConfig: unsafeTestValue<OhMyOpenCodeConfig>({}),
        modelCacheState: mockModelCacheState,
        backgroundManager: mockBackgroundManager,
        isHookEnabled: (hookName) => enabled && hookName === "hephaestus-agents-md-injector",
        safeHookEnabled: true,
      })

      // then
      expect(result.hephaestusAgentsMdInjector !== null).toBe(registered)
    })
  })

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

  it("skips ast-grep sg provision when disabled hooks exclude it", () => {
    // given
    const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({})

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName) => hookName !== "ast-grep-sg-provision",
      safeHookEnabled: true,
    })

    // then
    expect(result.astGrepSgProvision).toBeNull()
  })

  it("keeps ast-grep sg provision registered when the hook is enabled", () => {
    // given
    const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({})

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      backgroundManager: mockBackgroundManager,
      isHookEnabled: (hookName) => hookName === "ast-grep-sg-provision",
      safeHookEnabled: true,
    })

    // then
    expect(result.astGrepSgProvision).not.toBeNull()
  })
})
