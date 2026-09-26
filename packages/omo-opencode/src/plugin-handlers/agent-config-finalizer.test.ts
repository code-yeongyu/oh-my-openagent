import { afterEach, describe, expect, test } from "bun:test";
import {
  isAgentRegistered,
  registerAgentName,
  _resetForTesting as resetSessionStateForTesting,
} from "../features/claude-code-session-state";
import type { OhMyOpenCodeConfig } from "../config";
import { finalizeAgentConfig } from "./agent-config-finalizer";

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    sisyphus_agent: {
      planner_enabled: false,
    },
  };
}

describe("finalizeAgentConfig", () => {
  afterEach(() => {
    resetSessionStateForTesting();
  });

  test("does not throw or keep stale registrations when config.agent is absent", () => {
    // given
    registerAgentName("stale-agent");

    // when
    const result = finalizeAgentConfig({
      config: {},
      pluginConfig: createPluginConfig(),
      configuredDefaultAgent: undefined,
    });

    // then
    expect(result).toEqual({});
    expect(isAgentRegistered("stale-agent")).toBe(false);
  });

  describe("providerOptions translation", () => {
    test("translates providerOptions flat into options for all agents", () => {
      // given
      const config = {
        agent: {
          oracle: {
            name: "oracle",
            model: "openai/gpt-5.5",
            providerOptions: {
              thinking_token_budget: 1024,
              chat_template_kwargs: { enable_thinking: false },
            },
          } as Record<string, unknown>,
          librarian: {
            name: "librarian",
            model: "openai/gpt-5.4-mini-fast",
            providerOptions: {
              custom_api_version: "v2025-01-01",
            },
          } as Record<string, unknown>,
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: "oracle",
      });

      // then
      const oracle = result.oracle as Record<string, unknown>;
      expect(oracle).toHaveProperty("options.thinking_token_budget", 1024);
      expect(oracle).toHaveProperty("options.chat_template_kwargs.enable_thinking", false);
      expect("providerOptions" in oracle).toBe(false);

      const librarian = result.librarian as Record<string, unknown>;
      expect(librarian).toHaveProperty("options.custom_api_version", "v2025-01-01");
      expect("providerOptions" in librarian).toBe(false);
    });

    test("deep-merges providerOptions with pre-existing options", () => {
      // given
      const config = {
        agent: {
          oracle: {
            name: "oracle",
            model: "openai/gpt-5.5",
            options: { top_p: 0.95, existing_key: "keep-me" },
            providerOptions: { new_key: "added", chat_template_kwargs: { enable: true } },
          } as Record<string, unknown>,
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: "oracle",
      });

      // then
      const oracle = result.oracle as Record<string, unknown>;
      const opts = oracle.options as Record<string, unknown>;
      expect(opts.top_p).toBe(0.95);
      expect(opts.existing_key).toBe("keep-me");
      expect(opts.new_key).toBe("added");
      expect(opts.chat_template_kwargs).toEqual({ enable: true });
    });

    test("agent with no providerOptions is unchanged", () => {
      // given
      const config = {
        agent: {
          oracle: {
            name: "oracle",
            model: "openai/gpt-5.5",
            options: { top_p: 0.95 },
          } as Record<string, unknown>,
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: "oracle",
      });

      // then
      const oracle = result.oracle as Record<string, unknown>;
      expect(oracle).toEqual({ name: "oracle", model: "openai/gpt-5.5", options: { top_p: 0.95 } });
    });

    test("plan agent inherits providerOptions from override, translated by finalizer", () => {
      // given
      const config = {
        agent: {
          plan: {
            mode: "subagent",
            hidden: true,
            model: "openai/gpt-5.4",
            providerOptions: {
              thinking_token_budget: 512,
            },
          } as Record<string, unknown>,
          sisyphus: {
            name: "Sisyphus",
            model: "claude-opus-4-7",
          } as Record<string, unknown>,
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: "sisyphus",
      });

      // then
      const plan = result.plan as Record<string, unknown>;
      expect(plan.model).toBe("openai/gpt-5.4");
      expect(plan).toHaveProperty("options.thinking_token_budget", 512);
      expect("providerOptions" in plan).toBe(false);
    });
  });
});
