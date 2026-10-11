import { describe, expect, test } from "bun:test";
import { createMomusAgent } from "./momus";

describe("createMomusAgent", () => {
  test("uses high reasoning for GPT-6 Astra", () => {
    const agent = createMomusAgent("openai/gpt-6-astra")
    expect(agent.reasoningEffort).toBe("high")
  })

  test("keeps high reasoning for Copilot and fast Astra ids", () => {
    // given

    // when
    const copilotConfig = createMomusAgent("github-copilot/gpt-6-astra")
    const fastConfig = createMomusAgent("openai/gpt-6-astra-fast")

    // then
    for (const config of [copilotConfig, fastConfig]) {
      expect(config.reasoningEffort).toBe("high")
      expect(config.textVerbosity).toBe("high")
    }
  })
  describe("#given a GPT-5.6 family model", () => {
    test("#when creating the agent #then it runs high reasoning with a GPT-5.6 tuned prompt", () => {
      // given
      const model = "openai/gpt-5.6-sol";

      // when
      const config = createMomusAgent(model);

      // then
      expect(config.reasoningEffort).toBe("high");
    });

    test("#when creating the agent #then review contract and restrictions are preserved", () => {
      // given
      const model = "openai/gpt-5.6-sol";

      // when
      const config = createMomusAgent(model);
      const permission = config.permission as Record<string, string>;

      // then
      expect(config.mode).toBe("subagent");
      expect(config.temperature).toBe(0.1);
      expect(permission.write).toBe("deny");
      expect(permission.edit).toBe("deny");
      expect(permission.apply_patch).toBe("deny");
    });

    test("#when the model is a dotted or dashed 5.6 alias #then the 5.6 path is selected", () => {
      // given

      // when
      const aliasConfig = createMomusAgent("openai/gpt-5.6");
      const dashedConfig = createMomusAgent("vercel/openai/gpt-5-6-sol");

      // then
      expect(aliasConfig.reasoningEffort).toBe("high");
      expect(dashedConfig.reasoningEffort).toBe("high");
    });
  });

  describe("#given a GPT-5.5 or older GPT model", () => {
    test("#when creating the agent #then the existing GPT path stays unchanged", () => {
      // given
      const model = "openai/gpt-5.5";

      // when
      const config = createMomusAgent(model);

      // then
      expect(config.reasoningEffort).toBe("medium");
    });
  });

  describe("#given a Claude model", () => {
    test("#when creating the agent #then the default prompt and thinking config apply", () => {
      // given
      const model = "anthropic/claude-sonnet-4-6";

      // when
      const config = createMomusAgent(model) as Record<string, unknown>;

      // then
      expect(config.reasoningEffort).toBeUndefined();
      expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 32000 });
    });
  });
});
