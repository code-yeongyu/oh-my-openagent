/**
 * MetaGovernor config loader tests — PR 8 of 8.
 *
 * given/when/then style. Verifies that loadOrchestratorConfig correctly
 * projects the user-facing MetaGovernorPluginConfig into the runtime
 * OrchestratorConfig, applies defaults for missing fields, and respects
 * user overrides.
 */

import { describe, expect, it } from "bun:test"
import type { MetaGovernorPluginConfig } from "./config"
import {
  isMetaGovernorEnabled,
  loadOrchestratorConfig,
} from "./config"

describe("loadOrchestratorConfig", () => {
  describe("#given undefined config", () => {
    const result = loadOrchestratorConfig(undefined)

    it("then enabled is false", () => {
      expect(result.enabled).toBe(false)
    })

    it("then memory.query has the default", () => {
      expect(result.memory.query).toBe("meta_governor_context")
    })

    it("then memory.timeoutMs has the default 2000", () => {
      expect(result.memory.timeoutMs).toBe(2000)
    })

    it("then memory.enabled is true (internal always on)", () => {
      expect(result.memory.enabled).toBe(true)
    })

    it("then tokenPredictor has default thresholds", () => {
      expect(result.tokenPredictor.compactBurnRateThreshold).toBe(500)
      expect(result.tokenPredictor.compactUsageThreshold).toBe(0.85)
      expect(result.tokenPredictor.switchModelUsageThreshold).toBe(0.95)
      expect(result.tokenPredictor.delegateConsecutiveHighBurn).toBe(5)
    })

    it("then scoring has default thresholds", () => {
      expect(result.scoring.continueThreshold).toBe(0.3)
      expect(result.scoring.warnThreshold).toBe(0.3)
      expect(result.scoring.escalateThreshold).toBe(0.6)
      expect(result.scoring.stopThreshold).toBe(0.8)
    })

    it("then decision has default history limit (50)", () => {
      expect(result.decision.maxHistoryPerSession).toBe(50)
      expect(result.decision.forceContinueAfterStops).toBe(3)
    })

    it("then closedLoop has default enabled + saveDecisions", () => {
      expect(result.closedLoop.enabled).toBe(true)
      expect(result.closedLoop.saveDecisions).toBe(true)
      expect(result.closedLoop.minSeverityToLearn).toBe("media")
      expect(result.closedLoop.maxLessonsPerSession).toBe(20)
    })
  })

  describe("#given enabled config", () => {
    const config: MetaGovernorPluginConfig = { enabled: true }
    const result = loadOrchestratorConfig(config)

    it("then enabled is true", () => {
      expect(result.enabled).toBe(true)
    })
  })

  describe("#given custom memory config", () => {
    const config: MetaGovernorPluginConfig = {
      enabled: true,
      memory: {
        agentmemoryTimeoutMs: 5000,
        query: "custom_query",
      },
    }
    const result = loadOrchestratorConfig(config)

    it("then timeoutMs reflects override", () => {
      expect(result.memory.timeoutMs).toBe(5000)
    })

    it("then query reflects override", () => {
      expect(result.memory.query).toBe("custom_query")
    })
  })

  describe("#given custom scoring config", () => {
    const config: MetaGovernorPluginConfig = {
      enabled: true,
      scoring: {
        stopThreshold: 0.95,
        escalateThreshold: 0.85,
      },
    }
    const result = loadOrchestratorConfig(config)

    it("then stopThreshold reflects override", () => {
      expect(result.scoring.stopThreshold).toBe(0.95)
    })

    it("then escalateThreshold reflects override", () => {
      expect(result.scoring.escalateThreshold).toBe(0.85)
    })

    it("then continueThreshold is default", () => {
      expect(result.scoring.continueThreshold).toBe(0.3)
    })
  })

  describe("#given custom closedLoop config (saveDecisions=false)", () => {
    const config: MetaGovernorPluginConfig = {
      enabled: true,
      closedLoop: { saveDecisions: false },
    }
    const result = loadOrchestratorConfig(config)

    it("then saveDecisions is false", () => {
      expect(result.closedLoop.saveDecisions).toBe(false)
    })

    it("then enabled still defaults to true", () => {
      expect(result.closedLoop.enabled).toBe(true)
    })

    it("then minSeverityToLearn is the default 'media'", () => {
      expect(result.closedLoop.minSeverityToLearn).toBe("media")
    })
  })
})

describe("isMetaGovernorEnabled", () => {
  it("#given undefined config then returns false", () => {
    expect(isMetaGovernorEnabled(undefined)).toBe(false)
  })

  it("#given disabled config then returns false", () => {
    const config: MetaGovernorPluginConfig = { enabled: false }
    expect(isMetaGovernorEnabled(config)).toBe(false)
  })

  it("#given enabled config then returns true", () => {
    const config: MetaGovernorPluginConfig = { enabled: true }
    expect(isMetaGovernorEnabled(config)).toBe(true)
  })
})
