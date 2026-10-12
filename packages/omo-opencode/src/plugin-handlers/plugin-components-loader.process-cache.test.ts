/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import {
  getPluginComponentsRealLoadCount,
  loadPluginComponents,
} from "./plugin-components-loader"
import { resetProcessConfigCacheForTests } from "../shared/process-config-cache"
import type { OhMyOpenCodeConfig } from "../config"

// No module mocks: the compat-core loader barrel is imported by other test
// files (hook-config merging), and mocking it leaks across files sharing a
// worker. The real loader runs against the hermetic home (no ~/.claude/plugins),
// and cache behavior is observed through the real-load counter seam.
const basePluginConfig = {
  claude_code: { plugins: true },
} as OhMyOpenCodeConfig

describe("plugin-components-loader process cache (local fix 28, first-message-drop F5c)", () => {
  beforeEach(() => {
    resetProcessConfigCacheForTests()
    delete process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE
  })

  test("second load with the same config does not re-run the real loader", async () => {
    const first = await loadPluginComponents({ pluginConfig: basePluginConfig })
    const loadsAfterFirst = getPluginComponentsRealLoadCount()

    const second = await loadPluginComponents({ pluginConfig: basePluginConfig })

    expect(getPluginComponentsRealLoadCount()).toBe(loadsAfterFirst)
    expect(second).toBe(first)
  })

  test("a different plugin config slice re-runs the real loader", async () => {
    await loadPluginComponents({ pluginConfig: basePluginConfig })
    const loadsAfterFirst = getPluginComponentsRealLoadCount()

    await loadPluginComponents({
      pluginConfig: {
        ...basePluginConfig,
        claude_code: { plugins: true, anthropic_provider: "custom" },
      } as OhMyOpenCodeConfig,
    })

    expect(getPluginComponentsRealLoadCount()).toBe(loadsAfterFirst + 1)
  })

  test("the kill-switch OMO_DISABLE_PROCESS_CONFIG_CACHE=1 restores per-call loads", async () => {
    process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE = "1"
    await loadPluginComponents({ pluginConfig: basePluginConfig })
    const loadsAfterFirst = getPluginComponentsRealLoadCount()

    await loadPluginComponents({ pluginConfig: basePluginConfig })

    expect(getPluginComponentsRealLoadCount()).toBe(loadsAfterFirst + 1)
  })

  test("plugins disabled returns the empty result without touching the loader or cache", async () => {
    const loadsBefore = getPluginComponentsRealLoadCount()

    const result = await loadPluginComponents({
      pluginConfig: { ...basePluginConfig, claude_code: { plugins: false } } as OhMyOpenCodeConfig,
    })

    expect(getPluginComponentsRealLoadCount()).toBe(loadsBefore)
    expect(result.commands).toEqual({})
  })
})
