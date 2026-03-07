import { describe, expect, test } from "bun:test";
import {
  getHephaestusPromptSource,
  getHephaestusPrompt,
  createHephaestusAgent,
} from "./index";

describe("getHephaestusPromptSource", () => {
  test("returns 'gpt-5-4' for gpt-5.4 models", () => {
    // given
    const model1 = "openai/gpt-5.4";
    const model2 = "openai/gpt-5.4-codex";
    const model3 = "github-copilot/gpt-5.4";

    // when
    const source1 = getHephaestusPromptSource(model1);
    const source2 = getHephaestusPromptSource(model2);
    const source3 = getHephaestusPromptSource(model3);

    // then
    expect(source1).toBe("gpt-5-4");
    expect(source2).toBe("gpt-5-4");
    expect(source3).toBe("gpt-5-4");
  });

  test("returns 'gpt-5-3-codex' for GPT 5.3 Codex models", () => {
    // given
    const model1 = "openai/gpt-5.3-codex";
    const model2 = "github-copilot/gpt-5.3-codex";

    // when
    const source1 = getHephaestusPromptSource(model1);
    const source2 = getHephaestusPromptSource(model2);

    // then
    expect(source1).toBe("gpt-5-3-codex");
    expect(source2).toBe("gpt-5-3-codex");
  });

  test("returns 'gpt' for generic GPT models", () => {
    // given
    const model1 = "openai/gpt-4o";
    const model2 = "github-copilot/gpt-4o";
    const model3 = "openai/gpt-4o";

    // when
    const source1 = getHephaestusPromptSource(model1);
    const source2 = getHephaestusPromptSource(model2);
    const source3 = getHephaestusPromptSource(model3);

    // then
    expect(source1).toBe("gpt");
    expect(source2).toBe("gpt");
    expect(source3).toBe("gpt");
  });

  test("returns 'gpt' for non-GPT models and undefined", () => {
    // given
    const model1 = "anthropic/claude-opus-4-6";
    const model2 = undefined;

    // when
    const source1 = getHephaestusPromptSource(model1);
    const source2 = getHephaestusPromptSource(model2);

    // then
    expect(source1).toBe("gpt");
    expect(source2).toBe("gpt");
  });
});

describe("getHephaestusPrompt", () => {
  test("GPT 5.4 model returns GPT-5.4 optimized prompt", () => {
    // given
    const model = "openai/gpt-5.4";

    // when
    const prompt = getHephaestusPrompt(model);

    // then
    expect(prompt).toContain("You build context by examining");
    expect(prompt).toContain("Never chain together bash commands");
    expect(prompt).toContain("<tool_usage_rules>");
  });

  test("GPT 5.4-codex model returns GPT-5.4 optimized prompt", () => {
    // given
    const model = "openai/gpt-5.4-codex";

    // when
    const prompt = getHephaestusPrompt(model);

    // then
    expect(prompt).toContain("You build context by examining");
    expect(prompt).toContain("Never chain together bash commands");
    expect(prompt).toContain("<tool_usage_rules>");
  });

  test("GPT 5.3-codex model returns GPT-5.3 prompt", () => {
    // given
    const model = "openai/gpt-5.3-codex";

    // when
    const prompt = getHephaestusPrompt(model);

    // then
    expect(prompt).toContain("Senior Staff Engineer");
    expect(prompt).toContain("Hard Constraints");
    expect(prompt).toContain("<tool_usage_rules>");
  });

  test("generic GPT model returns generic GPT prompt", () => {
    // given
    const model = "openai/gpt-4o";

    // when
    const prompt = getHephaestusPrompt(model);

    // then
    expect(prompt).toContain("Senior Staff Engineer");
    expect(prompt).toContain("KEEP GOING");
    expect(prompt).not.toContain("intent_extraction");
  });

  test("Claude model returns generic GPT prompt (Hephaestus default)", () => {
    // given
    const model = "anthropic/claude-opus-4-6";

    // when
    const prompt = getHephaestusPrompt(model);

    // then
    expect(prompt).toContain("autonomous deep worker");
    expect(prompt).toContain("Hephaestus");
  });

  test("useTaskSystem=true includes Task Discipline for GPT models", () => {
    // given
    const model = "openai/gpt-5.4";

    // when
    const prompt = getHephaestusPrompt(model, true);

    // then
    expect(prompt).toContain("Task Discipline");
    expect(prompt).toContain("task_create");
    expect(prompt).toContain("task_update");
  });

  test("useTaskSystem=false includes Todo Discipline for Claude models", () => {
    // given
    const model = "anthropic/claude-opus-4-6";

    // when
    const prompt = getHephaestusPrompt(model, false);

    // then
    expect(prompt).toContain("Todo Discipline");
    expect(prompt).toContain("todowrite");
  });
});

describe("createHephaestusAgent", () => {
  test("returns AgentConfig with required fields", () => {
    // given
    const model = "openai/gpt-5.4";

    // when
    const config = createHephaestusAgent(model);

    // then
    expect(config).toHaveProperty("description");
    expect(config).toHaveProperty("mode", "all");
    expect(config).toHaveProperty("model", "openai/gpt-5.4");
    expect(config).toHaveProperty("maxTokens", 32000);
    expect(config).toHaveProperty("prompt");
    expect(config).toHaveProperty("color", "#D97706");
    expect(config).toHaveProperty("permission");
    expect(config.permission).toHaveProperty("question", "allow");
    expect(config.permission).toHaveProperty("call_omo_agent", "deny");
    expect(config).toHaveProperty("reasoningEffort", "medium");
  });

  test("GPT 5.4 model includes GPT-5.4 specific prompt content", () => {
    // given
    const model = "openai/gpt-5.4";

    // when
    const config = createHephaestusAgent(model);

    // then
    expect(config.prompt).toContain("You build context by examining");
    expect(config.prompt).toContain("Never chain together bash commands");
    expect(config.prompt).toContain("<tool_usage_rules>");
  });

  test("GPT 5.3-codex model includes GPT-5.3 specific prompt content", () => {
    // given
    const model = "openai/gpt-5.3-codex";

    // when
    const config = createHephaestusAgent(model);

    // then
    expect(config.prompt).toContain("Senior Staff Engineer");
    expect(config.prompt).toContain("Hard Constraints");
    expect(config.prompt).toContain("<tool_usage_rules>");
  });

  test("includes Hephaestus identity in prompt", () => {
    // given
    const model = "openai/gpt-5.4";

    // when
    const config = createHephaestusAgent(model);

    // then
    expect(config.prompt).toContain("Hephaestus");
    expect(config.prompt).toContain("autonomous deep worker");
  });

  test("useTaskSystem=true produces Task Discipline prompt", () => {
    // given
    const model = "openai/gpt-5.4";

    // when
    const config = createHephaestusAgent(model, [], [], [], [], true);

    // then
    expect(config.prompt).toContain("task_create");
    expect(config.prompt).toContain("task_update");
    expect(config.prompt).not.toContain("todowrite");
  });

  test("useTaskSystem=false produces Todo Discipline prompt", () => {
    // given
    const model = "openai/gpt-5.4";

    // when
    const config = createHephaestusAgent(model, [], [], [], [], false);

    // then
    expect(config.prompt).toContain("todowrite");
    expect(config.prompt).not.toContain("task_create");
  });
});
