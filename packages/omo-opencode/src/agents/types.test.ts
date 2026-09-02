import { describe, test, expect } from "bun:test";
import {
  buildClaudeThinkingConfig,
  CLAUDE_THINKING_BUDGET_BY_VARIANT,
  isGptModel,
  isGeminiModel,
  isGlmModel,
  isGptNativeSisyphusModel,
  isMiniMaxModel,
  resolveClaudeThinkingBudget,
} from "./types";

describe("resolveClaudeThinkingBudget", () => {
  test("#given no variant #then returns the legacy default budget", () => {
    expect(resolveClaudeThinkingBudget(undefined)).toBe(32000);
  });

  test("#given each canonical reasoning level #then returns a strictly increasing budget ladder", () => {
    // given
    const levels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

    // when
    const budgets = levels.map((level) => resolveClaudeThinkingBudget(level));

    // then
    expect(budgets).toEqual([4096, 8192, 16000, 32000, 48000, 60000]);
    for (let index = 1; index < budgets.length; index += 1) {
      const previous = budgets[index - 1];
      const current = budgets[index];
      if (previous === undefined || current === undefined) throw new Error("unreachable");
      expect(current).toBeGreaterThan(previous);
    }
  });

  test("#given high variant #then matches the legacy default budget", () => {
    expect(resolveClaudeThinkingBudget("high")).toBe(32000);
  });

  test("#given variant lookup #then is case-insensitive", () => {
    expect(resolveClaudeThinkingBudget("MAX")).toBe(60000);
    expect(resolveClaudeThinkingBudget("Low")).toBe(8192);
  });

  test("#given off or unknown or empty variant #then falls back to the legacy default budget", () => {
    expect(resolveClaudeThinkingBudget("off")).toBe(32000);
    expect(resolveClaudeThinkingBudget("turbo")).toBe(32000);
    expect(resolveClaudeThinkingBudget("")).toBe(32000);
  });

  test("#given the exported tier map #then every budget satisfies the Anthropic minimum of 1024", () => {
    for (const budget of Object.values(CLAUDE_THINKING_BUDGET_BY_VARIANT)) {
      expect(budget).toBeGreaterThanOrEqual(1024);
    }
  });
});

describe("buildClaudeThinkingConfig", () => {
  test("#given manual-path Claude model without variant #then emits the legacy default budget", () => {
    expect(buildClaudeThinkingConfig("anthropic/claude-sonnet-5")).toEqual({
      thinking: { type: "enabled", budgetTokens: 32000 },
    });
  });

  test("#given manual-path Claude model with low vs max variant #then emits different budgets", () => {
    // given
    const model = "anthropic/claude-sonnet-5";

    // when
    const low = buildClaudeThinkingConfig(model, "low");
    const max = buildClaudeThinkingConfig(model, "max");

    // then
    expect(low).toEqual({ thinking: { type: "enabled", budgetTokens: 8192 } });
    expect(max).toEqual({ thinking: { type: "enabled", budgetTokens: 60000 } });
  });

  test("#given adaptive-path Claude model #then emits no thinking config regardless of variant", () => {
    expect(buildClaudeThinkingConfig("anthropic/claude-opus-4-7", "max")).toEqual({});
    expect(buildClaudeThinkingConfig("anthropic/claude-fable-5", "low")).toEqual({});
  });
});

describe("isGptNativeSisyphusModel", () => {
  test("allows GPT-5.x where x >= 4", () => {
    expect(isGptNativeSisyphusModel("openai/gpt-5.4")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5-4")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5.5")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5-5")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5.9")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5-9")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5.10")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5-10")).toBe(true);
  });

  test("allows with various providers and suffixes", () => {
    expect(isGptNativeSisyphusModel("github-copilot/gpt-5.4")).toBe(true);
    expect(isGptNativeSisyphusModel("venice/gpt-5-4")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5.3-codex")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5.4-codex")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5.5-mini")).toBe(true);
  });

  test("rejects GPT-5.x where x < 4", () => {
    expect(isGptNativeSisyphusModel("openai/gpt-5.0")).toBe(false);
    expect(isGptNativeSisyphusModel("openai/gpt-5.1")).toBe(false);
    expect(isGptNativeSisyphusModel("openai/gpt-5-0")).toBe(false);
  });

  test("rejects other GPT models", () => {
    expect(isGptNativeSisyphusModel("openai/gpt-4o")).toBe(false);
    expect(isGptNativeSisyphusModel("github-copilot/gpt-4o")).toBe(false);
  });

  test("rejects non-GPT models", () => {
    expect(isGptNativeSisyphusModel("anthropic/claude-opus-4-7")).toBe(false);
    expect(isGptNativeSisyphusModel("google/gemini-3.1-pro")).toBe(false);
    expect(isGptNativeSisyphusModel("openai/o1")).toBe(false);
  });
});

describe("isGptModel", () => {
  test("standard openai provider gpt models", () => {
    expect(isGptModel("openai/gpt-5.4")).toBe(true);
    expect(isGptModel("openai/gpt-4o")).toBe(true);
  });

  test("o-series models are not gpt by name", () => {
    expect(isGptModel("openai/o1")).toBe(false);
    expect(isGptModel("openai/o3-mini")).toBe(false);
    expect(isGptModel("litellm/o1")).toBe(false);
    expect(isGptModel("litellm/o3-mini")).toBe(false);
    expect(isGptModel("litellm/o4-mini")).toBe(false);
  });

  test("github copilot gpt models", () => {
    expect(isGptModel("github-copilot/gpt-5.4")).toBe(true);
    expect(isGptModel("github-copilot/gpt-4o")).toBe(true);
  });

  test("litellm proxied gpt models", () => {
    expect(isGptModel("litellm/gpt-5.4")).toBe(true);
    expect(isGptModel("litellm/gpt-4o")).toBe(true);
  });

  test("other proxied gpt models", () => {
    expect(isGptModel("ollama/gpt-4o")).toBe(true);
    expect(isGptModel("custom-provider/gpt-5.4")).toBe(true);
  });

  test("venice provider gpt models", () => {
    expect(isGptModel("venice/gpt-5.4")).toBe(true);
    expect(isGptModel("venice/gpt-4o")).toBe(true);
  });

  test("gpt4 prefix without hyphen (legacy naming)", () => {
    expect(isGptModel("litellm/gpt4o")).toBe(true);
    expect(isGptModel("ollama/gpt4")).toBe(true);
  });

  test("claude models are not gpt", () => {
    expect(isGptModel("anthropic/claude-opus-4-7")).toBe(false);
    expect(isGptModel("anthropic/claude-sonnet-4-6")).toBe(false);
    expect(isGptModel("litellm/anthropic.claude-opus-4-5")).toBe(false);
  });

  test("gemini models are not gpt", () => {
    expect(isGptModel("google/gemini-3.1-pro")).toBe(false);
    expect(isGptModel("litellm/gemini-3.1-pro")).toBe(false);
  });

  test("opencode provider is not gpt", () => {
    expect(isGptModel("opencode/claude-opus-4-7")).toBe(false);
  });
});

describe("isMiniMaxModel", () => {
  test("detects minimax models with provider prefix", () => {
    expect(isMiniMaxModel("opencode-go/minimax-m2.7")).toBe(true);
    expect(isMiniMaxModel("opencode/minimax-m2.7-highspeed")).toBe(true);
    expect(isMiniMaxModel("opencode-go/minimax-m2.5")).toBe(true);
    expect(isMiniMaxModel("opencode/minimax-m2.5-free")).toBe(true);
  });

  test("detects minimax models without provider prefix", () => {
    expect(isMiniMaxModel("minimax-m2.7")).toBe(true);
    expect(isMiniMaxModel("minimax-m2.7-highspeed")).toBe(true);
    expect(isMiniMaxModel("minimax-m2.5")).toBe(true);
  });

  test("does not match non-minimax models", () => {
    expect(isMiniMaxModel("openai/gpt-5.4")).toBe(false);
    expect(isMiniMaxModel("anthropic/claude-opus-4-7")).toBe(false);
    expect(isMiniMaxModel("google/gemini-3.1-pro")).toBe(false);
    expect(isMiniMaxModel("opencode-go/kimi-k2.5")).toBe(false);
  });
});

describe("isGlmModel", () => {
  test("#given GLM models with provider prefix #then returns true", () => {
    expect(isGlmModel("z-ai/glm-5")).toBe(true);
    expect(isGlmModel("opencode/glm-5")).toBe(true);
    expect(isGlmModel("opencode-go/glm-5-turbo")).toBe(true);
    expect(isGlmModel("opencode/glm-4.6v")).toBe(true);
  });

  test("#given GLM models without provider prefix #then returns true", () => {
    expect(isGlmModel("glm-5")).toBe(true);
    expect(isGlmModel("glm-5-turbo")).toBe(true);
  });

  test("#given non-GLM models #then returns false", () => {
    expect(isGlmModel("openai/gpt-5.4")).toBe(false);
    expect(isGlmModel("anthropic/claude-opus-4-7")).toBe(false);
    expect(isGlmModel("google/gemini-3.1-pro")).toBe(false);
  });
});

describe("isGeminiModel", () => {
  test("#given google provider models #then returns true", () => {
    expect(isGeminiModel("google/gemini-3.1-pro")).toBe(true);
    expect(isGeminiModel("google/gemini-3-flash")).toBe(true);
    expect(isGeminiModel("google/gemini-2.5-pro")).toBe(true);
  });

  test("#given google-vertex provider models #then returns true", () => {
    expect(isGeminiModel("google-vertex/gemini-3.1-pro")).toBe(true);
    expect(isGeminiModel("google-vertex/gemini-3-flash")).toBe(true);
  });

  test("#given github copilot gemini models #then returns true", () => {
    expect(isGeminiModel("github-copilot/gemini-3.1-pro")).toBe(true);
    expect(isGeminiModel("github-copilot/gemini-3-flash")).toBe(true);
  });

  test("#given litellm proxied gemini models #then returns true", () => {
    expect(isGeminiModel("litellm/gemini-3.1-pro")).toBe(true);
    expect(isGeminiModel("litellm/gemini-3-flash")).toBe(true);
    expect(isGeminiModel("litellm/gemini-2.5-pro")).toBe(true);
  });

  test("#given other proxied gemini models #then returns true", () => {
    expect(isGeminiModel("custom-provider/gemini-3.1-pro")).toBe(true);
    expect(isGeminiModel("ollama/gemini-3-flash")).toBe(true);
  });

  test("#given gpt models #then returns false", () => {
    expect(isGeminiModel("openai/gpt-5.4")).toBe(false);
    expect(isGeminiModel("openai/o3-mini")).toBe(false);
    expect(isGeminiModel("litellm/gpt-4o")).toBe(false);
  });

  test("#given claude models #then returns false", () => {
    expect(isGeminiModel("anthropic/claude-opus-4-7")).toBe(false);
    expect(isGeminiModel("anthropic/claude-sonnet-4-6")).toBe(false);
  });

  test("#given opencode provider #then returns false", () => {
    expect(isGeminiModel("opencode/claude-opus-4-7")).toBe(false);
  });
});
