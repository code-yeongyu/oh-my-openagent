import { afterEach, describe, expect, test } from "bun:test"

import { getFallbackModelsForSession, getRawFallbackModels } from "./fallback-models"
import { detectAgentFromSession, resolveAgentForSession } from "./agent-resolver"
import { setSessionFallbackSnapshot, clearSessionFallbackSnapshot } from "../../shared/session-fallback-snapshot"
import { registerDelegatedChildSessionBootstrap, clearAllDelegatedChildSessionBootstrap } from "../../shared/delegated-child-session-bootstrap"
import { createModelFallbackStateController } from "../model-fallback/fallback-state-controller"
import { applyUserConfiguredFallbackChain } from "../../plugin/event-model-fallback-state"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("runtime-fallback fallback-models", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
    clearAllDelegatedChildSessionBootstrap()
  })

  test("both error fallback systems use the delegated dispatch snapshot instead of startup agent/category config", () => {
    const sessionID = "ses_hot_reload_snapshot"
    SessionCategoryRegistry.register(sessionID, "quick")
    const pluginConfig = { agents: { explore: { fallback_models: ["premium/startup"] } }, categories: { quick: { fallback_models: ["premium/category"] } } }
    registerDelegatedChildSessionBootstrap({
      sessionID,
      promptText: "delegated work",
      fallbackChain: [{ providers: ["budget"], model: "backup", variant: "low", temperature: 0.2 }],
    })
    expect(getRawFallbackModels(sessionID, "explore", pluginConfig)).toEqual([{ model: "budget/backup", variant: "low", temperature: 0.2 }])
    expect(getFallbackModelsForSession(sessionID, "explore", pluginConfig)).toEqual(["budget/backup(low)"])
    const controller = createModelFallbackStateController({ pendingModelFallbacks: new Map(), lastToastKey: new Map(), sessionFallbackChains: new Map() })
    applyUserConfiguredFallbackChain(controller, sessionID, "explore", "budget", pluginConfig)
    expect(controller.getSessionFallbackChain(sessionID)).toMatchObject([{ providers: ["budget"], model: "backup", variant: "low", temperature: 0.2 }])
  })

  test("a delegated snapshot without fallbacks suppresses startup fallback inheritance", () => {
    const sessionID = "ses_hot_reload_empty"
    const pluginConfig = { agents: { explore: { fallback_models: ["premium/startup"] } } }
    registerDelegatedChildSessionBootstrap({ sessionID, promptText: "pinned delegated work", fallbackChain: undefined })
    expect(getFallbackModelsForSession(sessionID, "explore", pluginConfig)).toEqual([])
    const controller = createModelFallbackStateController({ pendingModelFallbacks: new Map(), lastToastKey: new Map(), sessionFallbackChains: new Map() })
    applyUserConfiguredFallbackChain(controller, sessionID, "explore", "budget", pluginConfig)
    expect(controller.getSessionFallbackChain(sessionID)).toEqual([])
    expect(controller.setPendingModelFallback(sessionID, "explore", "budget", "pinned")).toBe(false)
  })

  test("a primary session can register a selected profile chain without a delegated bootstrap", () => {
    const pluginConfig = { agents: { sisyphus: { fallback_models: ["premium/startup"] } } }
    setSessionFallbackSnapshot("parent", [{ providers: ["budget", "backup-provider"], model: "profile-backup" }])
    expect(getFallbackModelsForSession("parent", "sisyphus", pluginConfig)).toEqual(["budget/profile-backup", "backup-provider/profile-backup"])
    const controller = createModelFallbackStateController({ pendingModelFallbacks: new Map(), lastToastKey: new Map(), sessionFallbackChains: new Map() })
    applyUserConfiguredFallbackChain(controller, "parent", "sisyphus", "budget", pluginConfig)
    expect(controller.getSessionFallbackChain("parent")).toEqual([{ providers: ["budget", "backup-provider"], model: "profile-backup" }])
    clearSessionFallbackSnapshot("parent")
    expect(getFallbackModelsForSession("parent", "sisyphus", pluginConfig)).toEqual(["premium/startup"])
  })

  test("uses category fallback_models when session category is registered", () => {
    //#given
    const sessionID = "ses_runtime_fallback_category"
    SessionCategoryRegistry.register(sessionID, "quick")
    const pluginConfig = unsafeTestValue({
      categories: {
        quick: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession(sessionID, undefined, pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-4-7"])
  })

  test("uses agent-specific fallback_models when agent is resolved", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_agent", "oracle", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-4-7"])
  })

  test("inherits prometheus fallback_models for a replaced plan agent by default", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        plan: {},
        prometheus: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-4-7"])
  })

  test("uses explicit plan fallback_models before prometheus inheritance", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        plan: {
          fallback_models: ["openai/gpt-5.4"],
        },
        prometheus: {
          fallback_models: ["openai/gpt-5.5"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.4"])
  })

  test("explicit empty plan fallback_models suppresses prometheus inheritance", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        plan: {
          fallback_models: [],
        },
        prometheus: {
          fallback_models: ["openai/gpt-5.5"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual([])
  })

  test.each([
    { planner_enabled: false },
    { replace_plan: false },
    { disabled: true },
  ])("does not inherit prometheus fallback_models when plan replacement is disabled: %#", (sisyphusAgent) => {
    //#given
    const pluginConfig = unsafeTestValue({
      sisyphus_agent: sisyphusAgent,
      agents: {
        plan: {},
        prometheus: {
          fallback_models: ["openai/gpt-5.5"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual([])
  })

  test("does not fall back to another agent chain when agent cannot be resolved", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        sisyphus: {
          fallback_models: ["quotio/gpt-5.5", "quotio/glm-5", "quotio/kimi-k2.5"],
        },
        oracle: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_unknown", undefined, pluginConfig)

    //#then
    expect(result).toEqual([])
  })

  // #8402 — general agent must resolve fallback_models like any other named agent
  test("resolves fallback_models for general agent via normalizeAgentName (#8402)", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        general: {
          fallback_models: ["openai/gpt-5.5"],
        },
      },
    })

    //#when
    const sessionID = "ses_any_session"
    const agent = resolveAgentForSession(sessionID, "general")
    const result = getFallbackModelsForSession(sessionID, agent, pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5"])
  })

  test("does not infer general from an opaque session ID substring", () => {
    //#given
    const sessionID = "ses_abcdefgeneral012345"

    //#when
    const agent = detectAgentFromSession(sessionID)

    //#then
    expect(agent).toBeUndefined()
  })

  test("explicit agent takes precedence over a general token in the session ID", () => {
    //#given
    const sessionID = "ses-general-storage"

    //#when
    const agent = resolveAgentForSession(sessionID, "oracle")

    //#then
    expect(agent).toBe("oracle")
  })
})
