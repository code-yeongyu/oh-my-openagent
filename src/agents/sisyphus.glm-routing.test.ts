/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { createSisyphusAgent } from "./sisyphus";

function getPrompt(model: string, availableCategories?: Parameters<typeof createSisyphusAgent>[4]): string {
  const agent = createSisyphusAgent(model, undefined, undefined, undefined, availableCategories);
  return agent.prompt ?? "";
}

describe("createSisyphusAgent - GLM routing", () => {
  test("#given GLM harness models #then routes to the GLM prompt builder", () => {
    const models = [
      "opencode-go/glm-5",
      "opencode-go/glm-5.1",
      "opencode-go/glm-5-1",
      "opencode-go/glm-5-turbo",
      "opencode-go/glm5-turbo",
      "zai/glm-5.1:thinking",
      "zai/glm-5v-turbo",
      "zai/glm5v-turbo",
    ];

    for (const model of models) {
      const prompt = getPrompt(model);

      expect(prompt).toContain("<re_entry_rule>");
      expect(prompt).toContain("<verification_loop>");
      expect(prompt).toContain("V1");
    }
  });

  test("#given excluded GLM-like models #then does not route to the GLM prompt builder", () => {
    const models = ["zai-coding-plan/glm-4.6v", "zai/glm-5.1-preview", "big-pickle/glm"];

    for (const model of models) {
      const prompt = getPrompt(model);

      expect(prompt).not.toContain("GLM exploration principle");
      expect(prompt).not.toContain("GLM delegation defaults");
      expect(prompt).not.toContain("GLM_VISION_CONSTRAINT");
    }
  });

  test("#given Kimi model #then keeps Kimi markers and avoids GLM ledger markers", () => {
    const prompt = getPrompt("moonshotai/kimi-k2.6");

    expect(prompt).toContain("Toggle RL");
    expect(prompt).toContain("K2.x post-training context");
    expect(prompt).not.toContain("DIRECT HEPHAESTUS DELEGATION");
    expect(prompt).not.toContain("DECOMPOSE AND DELEGATE - YOU ARE NOT AN IMPLEMENTER");
    expect(prompt).not.toContain(".sisyphus/state/");
    expect(prompt).not.toContain("<Small_Context_Working_Memory>");
    expect(prompt).not.toContain("goal.md");
    expect(prompt).not.toContain("verification.md");
  });

  test("#given GLM harness model #then returns config with thinking enabled (no budgetTokens)", () => {
    const agent = createSisyphusAgent("zai/glm-5.1");

    expect(agent.thinking).toEqual({ type: "enabled" });
    expect((agent as Record<string, unknown>).reasoningEffort).toBeUndefined();
  });

  test("#given GLM harness model #then strongly biases implementation toward category delegation", () => {
    const prompt = getPrompt("zai/glm-5.1");

    expect(prompt).toContain("DECOMPOSE AND DELEGATE - YOU ARE NOT AN IMPLEMENTER");
    expect(prompt).toContain("NEVER implement directly");
    expect(prompt).toContain("DEEP DELEGATION - YOUR IMPLEMENTATION PATH");
    expect(prompt).toContain('task(category="deep"');
    expect(prompt).toContain("delegate to Hephaestus");
  });

  test("#given GLM harness model #when building prompt #then preserves direct delegation markers", () => {
    const prompt = getPrompt("zai/glm-5.1");

    expect(prompt).toContain("DECOMPOSE AND DELEGATE - YOU ARE NOT AN IMPLEMENTER");
    expect(prompt).toContain("DEEP DELEGATION");
  });

  test("#given GLM harness model #when building prompt #then places delegation before verification and style sections", () => {
    const prompt = getPrompt("zai/glm-5.1");
    const delegationIndex = prompt.indexOf("DEEP DELEGATION");
    const verificationIndex = prompt.indexOf("<verification>");
    const styleIndex = prompt.indexOf("<style>");

    expect(delegationIndex).toBeGreaterThanOrEqual(0);
    expect(styleIndex).toBeGreaterThanOrEqual(0);
    if (verificationIndex >= 0) {
      expect(delegationIndex).toBeLessThan(verificationIndex);
    }
    expect(delegationIndex).toBeLessThan(styleIndex);
  });

  test("#given GLM harness model with empty categories #when building prompt #then includes fallback delegation section", () => {
    const prompt = getPrompt("zai/glm-5.1", []);

    expect(prompt).toContain("DECOMPOSE AND DELEGATE - YOU ARE NOT AN IMPLEMENTER");
    expect(prompt).toContain("NEVER implement directly");
  });
});
