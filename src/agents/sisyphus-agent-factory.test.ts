import { describe, expect, test } from "bun:test";
import { createSisyphusAgent } from "./sisyphus";

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
    test("#when creating agents #then selects each model family prompt", () => {
      // given
      const cases = [
        {
          model: "moonshotai/kimi-k2.6",
          promptAnchors: ["<re_entry_rule>", "<verification_loop>"],
        },
        {
          model: "openai/gpt-5.5",
          promptAnchors: ["## Validating your work", "## Task tracking"],
        },
        {
          model: "openai/gpt-5.4",
          promptAnchors: ["<execution_loop>", "<tasks>"],
        },
        {
          model: "anthropic/claude-opus-4-7",
          promptAnchors: ["<use_parallel_tool_calls>", "<Task_Management>"],
        },
      ];

      for (const { model, promptAnchors } of cases) {
        // when
        const agent = createSisyphusAgent(model);

        // then
        for (const promptAnchor of promptAnchors) {
          expect(agent.prompt).toContain(promptAnchor);
        }
      }
    });
  });

  describe("#given GPT-family Sisyphus models", () => {
    test("#when creating agents #then preserves reasoning and apply_patch restrictions", () => {
      // given
      const models = ["openai/gpt-5.5", "openai/gpt-5.4"];

      for (const model of models) {
        // when
        const agent = createSisyphusAgent(model);

        // then
        expect(agent.reasoningEffort).toBe("medium");
        expect(permissionValue(agent.permission, "apply_patch")).toBe("deny");
        expect(agent.thinking).toBeUndefined();
      }
    });
  });

  describe("#given Claude-family Sisyphus models", () => {
    test("#when creating agents #then preserves current thinking config split", () => {
      // given
      const opus47Agent = createSisyphusAgent("anthropic/claude-opus-4-7");
      const sonnetAgent = createSisyphusAgent("anthropic/claude-sonnet-4-6");

      // then
      expect(opus47Agent.thinking).toBeUndefined();
      expect(sonnetAgent.thinking).toEqual({
        type: "enabled",
        budgetTokens: 32000,
      });
    });
  });

  describe("#given a Gemini model", () => {
    test("#when creating the agent #then injects Gemini corrective anchors before constraints", () => {
      // given
      const model = "google/gemini-3.1-pro";

      // when
      const agent = createSisyphusAgent(model);
      const prompt = agent.prompt ?? "";

      // then
      expect(prompt).toContain("<TOOL_CALL_MANDATE>");
      expect(prompt).toContain("<GEMINI_TOOL_GUIDE>");
      expect(prompt).toContain("<GEMINI_DELEGATION_OVERRIDE>");
      expect(prompt.indexOf("<GEMINI_DELEGATION_OVERRIDE>")).toBeLessThan(
        prompt.indexOf("<Constraints>"),
      );
      expect(agent.thinking).toEqual({
        type: "enabled",
        budgetTokens: 32000,
      });
    });
  });
});
