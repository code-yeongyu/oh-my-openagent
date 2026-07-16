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
          model: "opencode-go/kimi-k2.7",
          promptAnchors: ["running on Kimi K2.7", "<operating_rules>"],
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
          promptAnchors: ["<use_parallel_tool_calls>", "<Task_Management>", "claude-opus-4-7"],
        },
        {
          model: "anthropic/claude-opus-4-8",
          promptAnchors: ["<use_parallel_tool_calls>", "<Task_Management>", "claude-opus-4-8"],
        },
        {
          model: "anthropic/claude-fable-5",
          promptAnchors: ["<use_parallel_tool_calls>", "<Task_Management>", "claude-fable-5"],
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

  describe("#given Kimi K2.7 vs K2.6 models", () => {
    test("#when creating agents #then K2.7 routes to its own restrained variant, not the K2.6 prompt", () => {
      // given
      const k27Agent = createSisyphusAgent("opencode-go/kimi-k2.7");
      const k26Agent = createSisyphusAgent("opencode-go/kimi-k2.6");

      // then
      expect(k27Agent.prompt).toContain("running on Kimi K2.7");
      expect(k27Agent.prompt).not.toContain("Toggle RL");
      expect(k26Agent.prompt).toContain("Toggle RL");
      expect(k26Agent.prompt).not.toContain("Kimi K2.7");
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
      const fable5Agent = createSisyphusAgent("anthropic/claude-fable-5");
      const sonnetAgent = createSisyphusAgent("anthropic/claude-sonnet-4-6");

      // then
      expect(opus47Agent.thinking).toBeUndefined();
      expect(opus48Agent.thinking).toBeUndefined();
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

      // then
      expect(agent.prompt).toContain("running on GLM 5.2");
      expect(agent.prompt).toContain("<glm_52_calibration>");
      expect(agent.thinking).toBeUndefined();
      expect(agent.reasoningEffort).toBeUndefined();
    });
  });

  describe("#given a MiMo V2.5 Pro Sisyphus model", () => {
    test("#when creating the agent #then uses the MiMo-native prompt with bare config", () => {
      // given
      const model = "xiaomi/mimo-v2.5-pro";

      // when
      const agent = createSisyphusAgent(model);

      // then
      expect(agent.prompt).toContain("running on MiMo V2.5 Pro");
      expect(agent.prompt).toContain("<mimo_calibration>");
      expect(agent.prompt).toContain("SEQUENTIAL TOOL CALLS");
      expect(agent.prompt).toContain("THINKING-TOOL CONFLICT");
      expect(agent.thinking).toBeUndefined();
      expect(agent.reasoningEffort).toBeUndefined();
    });

    test("#when creating the agent with alternate provider naming #then still routes to MiMo variant", () => {
      // given
      const models = [
        "XiaomiMiMo/MiMo-V2.5-Pro",
        "mimo-v2.5-pro",
        "opencode-go/mimo-v2-5-pro",
      ];

      for (const model of models) {
        // when
        const agent = createSisyphusAgent(model);

        // then
        expect(agent.prompt).toContain("running on MiMo V2.5 Pro");
      }
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
