import { describe, expect, test } from "bun:test";
import { createMomusAgent } from "./momus";

describe("createMomusAgent", () => {
  describe("#given a GPT-5.6 family model", () => {
    test("#when creating the agent #then it runs high reasoning with a GPT-5.6 tuned prompt", () => {
      // given
      const model = "openai/gpt-5.6-sol";

      // when
      const config = createMomusAgent(model);
      const gpt55Config = createMomusAgent("openai/gpt-5.5");

      // then
      expect(config.reasoningEffort).toBe("high");
      expect(config.prompt).not.toBe(gpt55Config.prompt);
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
      const solConfig = createMomusAgent("openai/gpt-5.6-sol");

      // when
      const aliasConfig = createMomusAgent("openai/gpt-5.6");
      const dashedConfig = createMomusAgent("vercel/openai/gpt-5-6-sol");

      // then
      expect(aliasConfig.prompt).toBe(solConfig.prompt);
      expect(aliasConfig.reasoningEffort).toBe("high");
      expect(dashedConfig.prompt).toBe(solConfig.prompt);
      expect(dashedConfig.reasoningEffort).toBe("high");
    });
  });

  describe("#given a GPT-5.5 or older GPT model", () => {
    test("#when creating the agent #then the existing GPT path stays unchanged", () => {
      // given
      const model = "openai/gpt-5.5";

      // when
      const config = createMomusAgent(model);
      const gpt56Config = createMomusAgent("openai/gpt-5.6-sol");

      // then
      expect(config.reasoningEffort).toBe("medium");
      expect(config.prompt).not.toBe(gpt56Config.prompt);
    });
  });

  describe("#given a Claude model", () => {
    test("#when creating the agent #then the default prompt and thinking config apply", () => {
      // given
      const model = "anthropic/claude-sonnet-4-6";

      // when
      const config = createMomusAgent(model) as Record<string, unknown>;
      const gptConfig = createMomusAgent("openai/gpt-5.5");

      // then
      expect(config.reasoningEffort).toBeUndefined();
      expect(config.prompt).not.toBe(gptConfig.prompt);
      expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 32000 });
    });
  });
});
