import { describe, test, expect } from "bun:test";
import {
  isGptModel,
  isGeminiModel,
  isGlmModel,
  isGlmSisyphusHarnessModel,
  isGlmThinkingModel,
  isGlmVisionModel,
  isGptNativeSisyphusModel,
  isMiniMaxModel,
} from "./types";

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
    expect(isGptNativeSisyphusModel("openai/gpt-5.4-codex")).toBe(true);
    expect(isGptNativeSisyphusModel("openai/gpt-5.5-mini")).toBe(true);
  });

  test("rejects GPT-5.x where x < 4", () => {
    expect(isGptNativeSisyphusModel("openai/gpt-5.3-codex")).toBe(false);
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

describe("isGlmVisionModel", () => {
  test("#given GLM VLM variants #then returns true", () => {
    expect(isGlmVisionModel("opencode/glm-4.6v")).toBe(true);
    expect(isGlmVisionModel("opencode/glm-5v")).toBe(true);
    expect(isGlmVisionModel("opencode/glm-5v-turbo")).toBe(true);
    expect(isGlmVisionModel("z-ai/glm-5v-turbo")).toBe(true);
    expect(isGlmVisionModel("opencode-go/glm5v-turbo")).toBe(true);
  });

  test("#given GLM text models #then returns false", () => {
    expect(isGlmVisionModel("opencode/glm-5")).toBe(false);
    expect(isGlmVisionModel("z-ai/glm-5.1")).toBe(false);
    expect(isGlmVisionModel("opencode/glm-5-turbo")).toBe(false);
    expect(isGlmVisionModel("opencode-go/glm5-turbo")).toBe(false);
  });

  test("#given non-GLM models #then returns false", () => {
    expect(isGlmVisionModel("openai/gpt-5.4")).toBe(false);
    expect(isGlmVisionModel("anthropic/claude-opus-4-7")).toBe(false);
  });
});

describe("isGlmThinkingModel", () => {
  test("#given GLM-5+ text models #then returns true", () => {
    expect(isGlmThinkingModel("opencode/glm-5")).toBe(true);
    expect(isGlmThinkingModel("z-ai/glm-5.1")).toBe(true);
    expect(isGlmThinkingModel("opencode/glm-5-turbo")).toBe(true);
    expect(isGlmThinkingModel("opencode-go/glm5-turbo")).toBe(true);
    expect(isGlmThinkingModel("zai-coding-plan/glm-5")).toBe(true);
  });

  test("#given GLM VLM models #then returns false", () => {
    expect(isGlmThinkingModel("opencode/glm-4.6v")).toBe(false);
    expect(isGlmThinkingModel("opencode/glm-5v")).toBe(false);
    expect(isGlmThinkingModel("opencode/glm-5v-turbo")).toBe(false);
  });

  test("#given non-GLM models #then returns false", () => {
    expect(isGlmThinkingModel("openai/gpt-5.4")).toBe(false);
    expect(isGlmThinkingModel("anthropic/claude-opus-4-7")).toBe(false);
    expect(isGlmThinkingModel("google/gemini-3.1-pro")).toBe(false);
  });
});

describe("isGlmSisyphusHarnessModel", () => {
  test("#given exact GLM Sisyphus harness families #then returns true", () => {
    expect(isGlmSisyphusHarnessModel("z-ai/glm-5")).toBe(true);
    expect(isGlmSisyphusHarnessModel("vercel/zai/glm-5")).toBe(true);
    expect(isGlmSisyphusHarnessModel("zai-coding-plan/glm-5")).toBe(true);
    expect(isGlmSisyphusHarnessModel("z-ai/glm-5.1")).toBe(true);
    expect(isGlmSisyphusHarnessModel("zai-org/glm-5.1:thinking")).toBe(true);
    expect(isGlmSisyphusHarnessModel("opencode-go/glm-5-1")).toBe(true);
    expect(isGlmSisyphusHarnessModel("opencode-go/glm5.1")).toBe(true);
    expect(isGlmSisyphusHarnessModel("opencode/glm-5-turbo")).toBe(true);
    expect(isGlmSisyphusHarnessModel("opencode-go/glm5-turbo")).toBe(true);
    expect(isGlmSisyphusHarnessModel("opencode/glm-5v-turbo")).toBe(true);
    expect(isGlmSisyphusHarnessModel("opencode-go/glm5v-turbo")).toBe(true);
  });

  test("#given compact plain glm5 #then returns false", () => {
    expect(isGlmSisyphusHarnessModel("z-ai/glm5")).toBe(false);
    expect(isGlmSisyphusHarnessModel("glm5")).toBe(false);
    expect(isGlmSisyphusHarnessModel("z-ai/glm5:thinking")).toBe(false);
  });

  test("#given non-target GLM variants #then returns false", () => {
    expect(isGlmSisyphusHarnessModel("opencode/glm-4.6v")).toBe(false);
    expect(isGlmSisyphusHarnessModel("opencode/go/glm-4-6v")).toBe(false);
    expect(isGlmSisyphusHarnessModel("z-ai/glm-5.1-preview")).toBe(false);
    expect(isGlmSisyphusHarnessModel("accounts/fireworks/models/glm-5p1")).toBe(false);
    expect(isGlmSisyphusHarnessModel("opencode/big-pickle")).toBe(false);
  });

  test("#given other providers and families #then returns false", () => {
    expect(isGlmSisyphusHarnessModel("openai/gpt-5.4")).toBe(false);
    expect(isGlmSisyphusHarnessModel("anthropic/claude-opus-4-7")).toBe(false);
    expect(isGlmSisyphusHarnessModel("google/gemini-3.1-pro")).toBe(false);
    expect(isGlmSisyphusHarnessModel("moonshotai/kimi-k2.5")).toBe(false);
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
