/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { createSisyphusAgent } from "./sisyphus";

function getPrompt(model: string): string {
  const agent = createSisyphusAgent(model);
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

      expect(prompt).toContain(".sisyphus/state/");
      expect(prompt).toContain("<Small_Context_Working_Memory>");
      expect(prompt).toContain("goal.md");
    }
  });

  test("#given excluded GLM-like models #then does not route to the GLM prompt builder", () => {
    const models = ["zai-coding-plan/glm-4.6v", "zai/glm-5.1-preview", "big-pickle/glm"];

    for (const model of models) {
      const prompt = getPrompt(model);

      expect(prompt).not.toContain(".sisyphus/state/");
      expect(prompt).not.toContain("<Small_Context_Working_Memory>");
      expect(prompt).not.toContain("goal.md");
      expect(prompt).not.toContain("verification.md");
    }
  });

  test("#given Kimi model #then keeps Kimi markers and avoids GLM ledger markers", () => {
    const prompt = getPrompt("moonshotai/kimi-k2.6");

    expect(prompt).toContain("Toggle RL");
    expect(prompt).toContain("K2.x post-training context");
    expect(prompt).not.toContain(".sisyphus/state/");
    expect(prompt).not.toContain("<Small_Context_Working_Memory>");
    expect(prompt).not.toContain("goal.md");
    expect(prompt).not.toContain("verification.md");
  });
});
