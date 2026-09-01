import { describe, expect, test } from "bun:test";
import { createSisyphusAgent } from "./sisyphus";
import {
  resolveSisyphusPromptFamily,
  type SisyphusPromptFamily,
} from "./sisyphus-agent-factory";

function permissionValue(
  permission: ReturnType<typeof createSisyphusAgent>["permission"],
  key: string,
): unknown {
  return Object.entries(permission ?? {}).find(([permissionKey]) => permissionKey === key)?.[1];
}

describe("createSisyphusAgent", () => {
  describe("#given any Sisyphus model", () => {
    test("#when creating the agent #then exposes the primary facade contract", () => {
      // given
      const model = "anthropic/claude-sonnet-4-6";

      // when
      const agent = createSisyphusAgent(model);

      // then
      expect(createSisyphusAgent.mode).toBe("primary");
      expect(agent.mode).toBe("primary");
      expect(agent.model).toBe(model);
      expect(agent.maxTokens).toBe(64000);
      expect(agent.color).toBe("#00CED1");
      expect(agent.permission).toMatchObject({
        question: "allow",
        call_omo_agent: "deny",
      });
    });
  });

  describe("#given routed native prompt models", () => {
    test("#when resolving prompt families #then maps each model id to the routed family", () => {
      // given - aliases that intentionally share a family are represented explicitly
      const cases: Array<[model: string, family: SisyphusPromptFamily]> = [
        ["opencode-go/kimi-k3", "kimi-k3"],
        ["moonshotai/kimi-k2.6", "kimi-k2-6"],
        ["opencode-go/kimi-k2.7", "kimi-k2-7"],
        ["openai/gpt-5.6-sol", "gpt-5-5"],
        ["openai/gpt-5.5", "gpt-5-5"],
        ["openai/gpt-5.4", "gpt-5-4"],
        ["anthropic/claude-opus-4-7", "claude-opus-4-7"],
        ["anthropic/claude-opus-4-8", "claude-opus-4-8"],
        ["anthropic/claude-opus-5", "claude-opus-5"],
        ["anthropic/claude-fable-5", "claude-fable-5"],
        ["xai/grok-4.6", "grok-4"],
        ["x-ai/grok-4.5", "grok-4"],
        ["zai/glm-5.2", "glm-5-2"],
        ["google/gemini-3.1-pro", "fallback"],
      ];

      // when / then
      expect(cases.map(([model]) => resolveSisyphusPromptFamily(model))).toEqual(
        cases.map(([, family]) => family),
      );
    });

    test("#when selecting a tracking mode #then wires the matching tool contract", () => {
      // given
      const models = ["openai/gpt-5.5", "openai/gpt-5.6-sol"];

      for (const model of models) {
        // when
        const taskAgent = createSisyphusAgent(model, undefined, undefined, undefined, undefined, true);
        const todoAgent = createSisyphusAgent(model, undefined, undefined, undefined, undefined, false);

        // then
        expect(taskAgent.prompt).toContain("task_create");
        expect(taskAgent.prompt).toContain("task_update");
        expect(taskAgent.prompt).not.toContain("todowrite");
        expect(todoAgent.prompt).toContain("todowrite");
        expect(todoAgent.prompt).not.toContain("task_create");
        expect(todoAgent.prompt).not.toContain("task_update");
      }
    });
  });

  describe("#given GPT-family Sisyphus models", () => {
    test("#when creating agents #then preserves reasoning and leaves apply_patch available", () => {
      // given
      const models = ["openai/gpt-5.5", "openai/gpt-5.4"];

      for (const model of models) {
        // when
        const agent = createSisyphusAgent(model);

        // then
        expect(agent.reasoningEffort).toBe("medium");
        expect(permissionValue(agent.permission, "apply_patch")).toBeUndefined();
        expect(agent.thinking).toBeUndefined();
      }
    });
  });

  describe("#given Claude-family Sisyphus models", () => {
    test("#when creating agents #then preserves current thinking config split", () => {
      // given
      const opus47Agent = createSisyphusAgent("anthropic/claude-opus-4-7");
      const opus48Agent = createSisyphusAgent("anthropic/claude-opus-4-8");
      const opus5Agent = createSisyphusAgent("anthropic/claude-opus-5");
      const fable5Agent = createSisyphusAgent("anthropic/claude-fable-5");
      const sonnetAgent = createSisyphusAgent("anthropic/claude-sonnet-4-6");

      // then
      expect(opus47Agent.thinking).toBeUndefined();
      expect(opus48Agent.thinking).toBeUndefined();
      expect(opus5Agent.thinking).toBeUndefined();
      expect(fable5Agent.thinking).toBeUndefined();
      expect(sonnetAgent.thinking).toEqual({
        type: "enabled",
        budgetTokens: 32000,
      });
    });
  });

  describe("#given a GLM Sisyphus model", () => {
    test("#when creating the agent #then uses the GLM-native prompt with bare config", () => {
      // given
      const model = "zai/glm-5.2";

      // when
      const agent = createSisyphusAgent(model);

      // then - glm routes to its own variant, not the default prompt
      expect(agent.prompt).not.toBe(createSisyphusAgent("anthropic/claude-sonnet-4-6").prompt);
      expect(agent.thinking).toBeUndefined();
      expect(agent.reasoningEffort).toBeUndefined();
    });
  });

  describe("#given Grok 4.5/4.6 Sisyphus models", () => {
    test("#when creating agents #then uses the Grok-native prompt with high effort and no thinking", () => {
      // given
      const models = ["xai/grok-4.6", "x-ai/grok-4.5"];

      for (const model of models) {
        // when
        const agent = createSisyphusAgent(model);

        // then - grok 4.5/4.6 route to the shared grok variant, not the default prompt
        expect(agent.prompt).not.toBe(createSisyphusAgent("anthropic/claude-sonnet-4-6").prompt);
        expect(agent.reasoningEffort).toBe("high");
        expect(agent.thinking).toBeUndefined();
      }
    });

    test("#when creating agents for other grok ids #then keeps the fallback family", () => {
      // given
      const models = ["x-ai/grok-4.20", "xai/grok-4-1-fast-reasoning", "x-ai/grok-code-fast-1"];
      const grokPrompt = createSisyphusAgent("xai/grok-4.6").prompt;

      for (const model of models) {
        // when
        const agent = createSisyphusAgent(model);

        // then - unrecognized grok ids fall back to the default family
        expect(agent.prompt).not.toBe(grokPrompt);
        expect(agent.reasoningEffort).toBeUndefined();
      }
    });
  });

  describe("#given fallback-family Sisyphus models", () => {
    test("#when baking prompts for Gemini vs MiniMax #then the fallback family is not prompt-uniform", () => {
      // given - both models resolve to the broad fallback family
      const geminiModel = "google/gemini-3.1-pro";
      const minimaxModel = "minimax-coding-plan/MiniMax-M3";
      expect(resolveSisyphusPromptFamily(geminiModel)).toBe("fallback");
      expect(resolveSisyphusPromptFamily(minimaxModel)).toBe("fallback");

      // when
      const geminiPrompt = createSisyphusAgent(geminiModel).prompt;
      const minimaxPrompt = createSisyphusAgent(minimaxModel).prompt;

      // then - Gemini fallback overrides are baked in; MiniMax bakes the plain body
      expect(geminiPrompt).toContain("TOOL_CALL_MANDATE");
      expect(minimaxPrompt).not.toContain("TOOL_CALL_MANDATE");
      expect(geminiPrompt).not.toBe(minimaxPrompt);
    });

    test("#when baking prompts for DeepSeek vs MiniMax #then the plain fallback bodies are identical", () => {
      // given - neither model triggers fallback overrides
      const deepseekModel = "deepseek/deepseek-v4-pro";
      const minimaxModel = "minimax-coding-plan/MiniMax-M3";

      // when
      const deepseekPrompt = createSisyphusAgent(deepseekModel).prompt;
      const minimaxPrompt = createSisyphusAgent(minimaxModel).prompt;

      // then - genuine no-op swaps are detectable by prompt equality (#6966)
      expect(deepseekPrompt).toBe(minimaxPrompt);
    });
  });

  describe("#given a Gemini model", () => {
    test("#when creating the agent #then uses the Gemini-corrected prompt with thinking enabled", () => {
      // given
      const model = "google/gemini-3.1-pro";

      // when
      const agent = createSisyphusAgent(model);

      // then - gemini routes to its own corrected variant, not the default prompt
      expect(agent.prompt).not.toBe(createSisyphusAgent("anthropic/claude-sonnet-4-6").prompt);
      expect(agent.thinking).toEqual({
        type: "enabled",
        budgetTokens: 32000,
      });
    });
  });
});
