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
    test("translates providerOptions to options for a single agent", () => {
      // given - "oracle" maps to itself so result key stays "oracle"
      const config = {
        agent: {
          oracle: {
            model: "anthropic/claude-opus-4-7",
            mode: "primary",
            providerOptions: { thinking_token_budget: 4096 },
          },
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: undefined,
      });

      // then - providerOptions is converted to options; providerOptions key is removed
      expect(result["oracle"]).toEqual(
        expect.objectContaining({
          model: "anthropic/claude-opus-4-7",
          options: { thinking_token_budget: 4096 },
        }),
      );
      expect((result["oracle"] as Record<string, unknown>)["providerOptions"]).toBeUndefined();
    });

    test("merges providerOptions into existing options without overwriting", () => {
      // given - agent already has an options key from another source
      const config = {
        agent: {
          librarian: {
            model: "provider/model",
            mode: "subagent",
            options: { existing_key: "existing_value" },
            providerOptions: { chat_template_kwargs: { enable_thinking: false } },
          },
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: undefined,
      });

      // then - both existing and new options survive; providerOptions is removed
      const agent = result["librarian"] as Record<string, unknown>;
      expect(agent["options"]).toEqual({
        existing_key: "existing_value",
        chat_template_kwargs: { enable_thinking: false },
      });
      expect(agent["providerOptions"]).toBeUndefined();
    });

    test("providerOptions overwrites same-named keys already in options", () => {
      // given - conflict: same key in both options and providerOptions
      const config = {
        agent: {
          oracle: {
            options: { thinking_token_budget: 0 },
            providerOptions: { thinking_token_budget: 8192 },
          },
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: undefined,
      });

      // then - providerOptions wins (last-write semantics)
      const agent = result["oracle"] as Record<string, unknown>;
      expect(agent["options"]).toEqual({ thinking_token_budget: 8192 });
      expect(agent["providerOptions"]).toBeUndefined();
    });

    test("leaves agent unchanged when providerOptions is absent", () => {
      // given - "librarian" maps to itself so result key stays "librarian"
      const config = {
        agent: {
          librarian: {
            model: "openai/gpt-5.4",
            temperature: 0.7,
          },
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: undefined,
      });

      // then - no options key created, no providerOptions key present
      const agent = result["librarian"] as Record<string, unknown>;
      expect(agent["options"]).toBeUndefined();
      expect(agent["providerOptions"]).toBeUndefined();
      expect(agent["model"]).toBe("openai/gpt-5.4");
    });

    test("translates providerOptions across multiple agents in one pass", () => {
      // given - oracle/librarian/explore all map to themselves
      const config = {
        agent: {
          oracle: { providerOptions: { thinking_token_budget: 8192 } },
          librarian: { providerOptions: { thinking_token_budget: 2048 } },
          explore: { providerOptions: { chat_template_kwargs: { enable_thinking: false } } },
        },
      };

      // when
      const result = finalizeAgentConfig({
        config,
        pluginConfig: createPluginConfig(),
        configuredDefaultAgent: undefined,
      });

      // then - all three agents are translated
      for (const name of ["oracle", "librarian", "explore"]) {
        const agent = result[name] as Record<string, unknown>;
        expect(agent["providerOptions"]).toBeUndefined();
        expect(typeof agent["options"]).toBe("object");
      }
      expect((result["explore"] as Record<string, unknown>)["options"]).toEqual({
        chat_template_kwargs: { enable_thinking: false },
      });
    });
  });
});
