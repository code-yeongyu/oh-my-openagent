import { describe, expect, test } from "bun:test"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackConfig } from "../../config"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"

const context: RuntimeFallbackPluginInput = {
  client: {
    session: { abort: async () => ({}), messages: async () => ({}), promptAsync: async () => ({}) },
    tui: { showToast: async () => ({}) },
  },
  directory: "/test",
}

function boundUsedBy(config: RuntimeFallbackConfig): number | undefined {
  let captured: number | undefined
  const hook = createRuntimeFallbackHook(context, { config }, {
    createFirstPromptWatchdog: (deps: HookDeps, helpers: AutoRetryHelpers, watchdogMs?: number) => {
      captured = watchdogMs
      return createFirstPromptWatchdog(deps, helpers, watchdogMs)
    },
  })
  hook.dispose?.()
  return captured
}

describe("first-prompt watchdog bound (#11887)", () => {
  test("#given runtime_fallback without first_prompt_timeout_seconds #when the hook starts #then the watchdog waits 300 s, not 90 s, for a subagent's first progress", () => {
    expect(boundUsedBy({ enabled: true })).toBe(300_000)
  })

  test("#given first_prompt_timeout_seconds #when the hook starts #then the watchdog uses that bound", () => {
    expect(boundUsedBy({ enabled: true, first_prompt_timeout_seconds: 600 })).toBe(600_000)
  })

})
