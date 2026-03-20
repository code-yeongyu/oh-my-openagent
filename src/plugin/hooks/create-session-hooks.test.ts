import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"
import { createSessionHooks } from "./create-session-hooks"

const mockContext = {
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
} as unknown as PluginContext

const mockModelCacheState = {} as ModelCacheState

describe("createSessionHooks", () => {
  it("keeps model fallback disabled when config is unset", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
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
      isHookEnabled: (hookName) => hookName === "model-fallback",
      safeHookEnabled: true,
    })

    // then
    expect(result.modelFallback).not.toBeNull()
  })
})
