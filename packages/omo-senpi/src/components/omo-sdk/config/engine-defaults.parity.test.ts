import { describe, expect, test } from "bun:test"
import { SettingsManager } from "@code-yeongyu/senpi"

import { ENGINE_DEFAULT_FALLBACK_CHAINS, ENGINE_DEFAULTS, type EngineDefaultKey } from "./engine"

describe("engine defaults parity", () => {
  const engine = SettingsManager.inMemory({})
  const compaction = engine.getCompactionSettings()
  const retry = engine.getRetryFallbackSettings()
  const answers: Record<EngineDefaultKey, unknown> = {
    "compaction.enabled": engine.getCompactionEnabled(),
    "compaction.speculativeEnabled": compaction.speculativeEnabled,
    "compaction.speculativeFraction": compaction.speculativeFraction,
    "compaction.speculativeCooldownMs": compaction.speculativeCooldownMs,
    "compaction.idleCompactionEnabled": compaction.idleCompactionEnabled,
    "retry.modelFallback": retry.modelFallback,
    "retry.fallbackRevertPolicy": retry.revertPolicy,
  }

  test("#given the SDK's default table #when a fresh in-memory SettingsManager is asked #then every default is the engine's", () => {
    expect(answers).toEqual({ ...ENGINE_DEFAULTS })
  })

  test("#given the SDK's default fallback chains #when the engine resolves chains with no settings #then they are the engine's", () => {
    expect(ENGINE_DEFAULT_FALLBACK_CHAINS).toEqual(retry.chains)
  })
})
