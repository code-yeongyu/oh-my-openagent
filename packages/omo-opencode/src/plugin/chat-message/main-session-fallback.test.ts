import { afterEach, describe, expect, test } from "bun:test"

import {
  _resetMainSessionFallbackStateForTesting,
  applyMainSessionFallbackOverride,
  resolveMainSessionFallbackModel,
} from "./main-session-fallback"
import { subagentSessions } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("main-session fallback_models", () => {
  afterEach(() => {
    subagentSessions.delete("ses_main_fallback_subagent")
    _resetMainSessionFallbackStateForTesting()
  })

  describe("#given a main session whose agent configures fallback_models", () => {
    test("#when the primary model is unavailable #then the first reachable fallback entry is promoted (issue #7226)", () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: [
              { model: "github-copilot/claude-sonnet-5", variant: "max" },
              { model: "opencode/kimi-k2.5" },
            ],
          },
        },
      })
      const availableModels = new Set([
        "github-copilot/claude-sonnet-5",
        "opencode/kimi-k2.5",
      ])

      // when
      const promoted = resolveMainSessionFallbackModel({
        sessionID: "ses_main_fallback_issue",
        agent: "sisyphus",
        requestedModel: { providerID: "opencode", modelID: "claude-opus-4-8" },
        pluginConfig,
        availableModels,
      })

      // then
      expect(promoted).toEqual({
        providerID: "github-copilot",
        modelID: "claude-sonnet-5",
        variant: "max",
      })
    })

    test("#when the primary model is reachable #then no fallback is promoted", () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: [{ model: "opencode/kimi-k2.5" }],
          },
        },
      })
      const availableModels = new Set([
        "opencode/claude-opus-4-8",
        "opencode/kimi-k2.5",
      ])

      // when
      const promoted = resolveMainSessionFallbackModel({
        sessionID: "ses_main_fallback_reachable",
        agent: "sisyphus",
        requestedModel: { providerID: "opencode", modelID: "claude-opus-4-8" },
        pluginConfig,
        availableModels,
      })

      // then
      expect(promoted).toBeUndefined()
    })

    test("#when availability data is cold (empty set) #then resolution defers without guessing", () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: [{ model: "opencode/kimi-k2.5" }],
          },
        },
      })

      // when
      const promoted = resolveMainSessionFallbackModel({
        sessionID: "ses_main_fallback_cold",
        agent: "sisyphus",
        requestedModel: { providerID: "opencode", modelID: "claude-opus-4-8" },
        pluginConfig,
        availableModels: new Set<string>(),
      })

      // then
      expect(promoted).toBeUndefined()
    })

    test("#when no reachable fallback exists #then nothing is promoted", () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: [{ model: "opencode/kimi-k2.5" }],
          },
        },
      })
      const availableModels = new Set(["other-provider/other-model"])

      // when
      const promoted = resolveMainSessionFallbackModel({
        sessionID: "ses_main_fallback_unreachable_chain",
        agent: "sisyphus",
        requestedModel: { providerID: "opencode", modelID: "claude-opus-4-8" },
        pluginConfig,
        availableModels,
      })

      // then
      expect(promoted).toBeUndefined()
    })

    test("#when the agent has no fallback_models configured #then nothing is promoted", () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {},
        },
      })
      const availableModels = new Set(["opencode/kimi-k2.5"])

      // when
      const promoted = resolveMainSessionFallbackModel({
        sessionID: "ses_main_fallback_no_chain",
        agent: "sisyphus",
        requestedModel: { providerID: "opencode", modelID: "claude-opus-4-8" },
        pluginConfig,
        availableModels,
      })

      // then
      expect(promoted).toBeUndefined()
    })

    test("#when the agent inherits its category fallback_models #then the category chain is honored", () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: { category: "quick" },
        },
        categories: {
          quick: {
            fallback_models: [{ model: "opencode/kimi-k2.5" }],
          },
        },
      })
      const availableModels = new Set(["opencode/kimi-k2.5"])

      // when
      const promoted = resolveMainSessionFallbackModel({
        sessionID: "ses_main_fallback_category",
        agent: "sisyphus",
        requestedModel: { providerID: "opencode", modelID: "claude-opus-4-8" },
        pluginConfig,
        availableModels,
      })

      // then
      expect(promoted).toEqual({ providerID: "opencode", modelID: "kimi-k2.5" })
    })

    test("#when the session is a delegated subagent session #then resolution stays with the delegate path", () => {
      // given
      const sessionID = "ses_main_fallback_subagent"
      subagentSessions.add(sessionID)
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: [{ model: "opencode/kimi-k2.5" }],
          },
        },
      })
      const availableModels = new Set(["opencode/kimi-k2.5"])

      // when
      const promoted = resolveMainSessionFallbackModel({
        sessionID,
        agent: "sisyphus",
        requestedModel: { providerID: "opencode", modelID: "claude-opus-4-8" },
        pluginConfig,
        availableModels,
      })

      // then
      expect(promoted).toBeUndefined()
    })
  })

  describe("#given applyMainSessionFallbackOverride wiring", () => {
    test("#when the primary is unreachable #then output.message carries the promoted model and input stays untouched", async () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: [
              { model: "github-copilot/claude-sonnet-5", variant: "max" },
            ],
          },
        },
      })
      const input = {
        sessionID: "ses_main_fallback_wiring",
        agent: "sisyphus",
        model: { providerID: "opencode", modelID: "claude-opus-4-8" },
      }
      const output = { message: { model: { ...input.model } } as Record<string, unknown> }
      const notifications: string[] = []

      // when
      await applyMainSessionFallbackOverride({
        input,
        output,
        pluginConfig,
        getAvailableModels: () =>
          Promise.resolve(new Set(["github-copilot/claude-sonnet-5"])),
        notify: (title, message) => notifications.push(`${title}: ${message}`),
      })

      // then
      expect(output.message.model).toEqual({
        providerID: "github-copilot",
        modelID: "claude-sonnet-5",
      })
      expect(output.message.variant).toBe("max")
      expect(input.model).toEqual({
        providerID: "opencode",
        modelID: "claude-opus-4-8",
      })
      expect(notifications).toHaveLength(1)
    })

    test("#when the same fallback was already promoted for the session #then no duplicate notification fires", async () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: [{ model: "opencode/kimi-k2.5" }],
          },
        },
      })
      const makeOutput = () =>
        ({ message: { model: { providerID: "opencode", modelID: "claude-opus-4-8" } } }) as {
          message: Record<string, unknown>
        }
      const notifications: string[] = []
      const args = {
        input: {
          sessionID: "ses_main_fallback_dedupe",
          agent: "sisyphus",
          model: { providerID: "opencode", modelID: "claude-opus-4-8" },
        },
        pluginConfig,
        getAvailableModels: () => Promise.resolve(new Set(["opencode/kimi-k2.5"])),
        notify: (title: string, message: string) => notifications.push(`${title}: ${message}`),
      }

      // when
      await applyMainSessionFallbackOverride({ ...args, output: makeOutput() })
      await applyMainSessionFallbackOverride({ ...args, output: makeOutput() })

      // then
      expect(notifications).toHaveLength(1)
    })

    test("#when no promotion happens #then output.message is left untouched", async () => {
      // given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {},
        },
      })
      const originalModel = { providerID: "opencode", modelID: "claude-opus-4-8" }
      const output = { message: { model: { ...originalModel } } as Record<string, unknown> }

      // when
      await applyMainSessionFallbackOverride({
        input: {
          sessionID: "ses_main_fallback_noop",
          agent: "sisyphus",
          model: { ...originalModel },
        },
        output,
        pluginConfig,
        getAvailableModels: () => Promise.resolve(new Set(["opencode/claude-opus-4-8"])),
      })

      // then
      expect(output.message.model).toEqual(originalModel)
      expect(output.message.variant).toBeUndefined()
    })
  })
})
