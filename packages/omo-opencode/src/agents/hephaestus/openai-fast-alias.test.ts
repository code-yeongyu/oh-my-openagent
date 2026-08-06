/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { maybeCreateHephaestusConfig } from "../builtin-agents/hephaestus-agent";
import type { AgentOverrides } from "../types";
import { createHephaestusAgent, getHephaestusPromptSource } from "./index";

const OPENAI_FAST_MODEL_IDS = [
  "openai/gpt-5.6-sol-fast",
  "openai/gpt-5.6-terra-fast",
  "openai/gpt-5.6-luna-fast",
] as const;

describe("Hephaestus OpenAI GPT-5.6 fast aliases", () => {
  test("uses the GPT-5.6 prompt while preserving each transport model ID", () => {
    for (const model of OPENAI_FAST_MODEL_IDS) {
      const config = createHephaestusAgent(model);

      expect(getHephaestusPromptSource(model)).toBe("gpt-5-6");
      expect(config.model).toBe(model);
      expect(config.prompt).toContain("based on GPT-5.6");
      expect(config.prompt).not.toContain("based on GPT-5.5");
    }
  });

  test("preserves the configured reasoning variant", () => {
    const model = "openai/gpt-5.6-sol-fast";
    const agentOverrides: AgentOverrides = {
      hephaestus: { model, variant: "xhigh" },
    };

    const config = maybeCreateHephaestusConfig({
      disabledAgents: [],
      agentOverrides,
      availableModels: new Set([model]),
      systemDefaultModel: model,
      isFirstRunNoCache: false,
      availableAgents: [],
      availableSkills: [],
      availableCategories: [],
      mergedCategories: {},
      useTaskSystem: false,
    });

    expect(config?.model).toBe(model);
    expect(config?.variant).toBe("xhigh");
    expect(config?.prompt).toContain("based on GPT-5.6");
  });
});
