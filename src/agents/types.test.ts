import { describe, test, expect } from "bun:test";
import { isGptModel, isGeminiModel, isGlmModel, isGpt5_4Model, isMiniMaxModel } from "./types";

describe("isGpt5_4Model", () => {
  test("detects gpt-5.4 models", () => {
    expect(isGpt5_4Model("openai/gpt-5.4")).toBe(true);
    expect(isGpt5_4Model("openai/gpt-5-4")).toBe(true);
    expect(isGpt5_4Model("openai/gpt-5.4-codex")).toBe(true);
    expect(isGpt5_4Model("github-copilot/gpt-5.4")).toBe(true);
    expect(isGpt5_4Model("venice/gpt-5-4")).toBe(true);
  });

  test("does not match other GPT models", () => {
    expect(isGpt5_4Model("openai/gpt-5.3-codex")).toBe(false);
    expect(isGpt5_4Model("openai/gpt-5.1")).toBe(false);
    expect(isGpt5_4Model("openai/gpt-4o")).toBe(false);
    expect(isGpt5_4Model("github-copilot/gpt-4o")).toBe(false);
  });

  test("does not match non-GPT models", () => {
    expect(isGpt5_4Model("anthropic/claude-opus-4-6")).toBe(false);
    expect(isGpt5_4Model("google/gemini-3.1-pro")).toBe(false);
    expect(isGpt5_4Model("openai/o1")).toBe(false);
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
    expect(isGptModel("anthropic/claude-opus-4-6")).toBe(false);
    expect(isGptModel("anthropic/claude-sonnet-4-6")).toBe(false);
    expect(isGptModel("litellm/anthropic.claude-opus-4-5")).toBe(false);
  });

  test("gemini models are not gpt", () => {
    expect(isGptModel("google/gemini-3.1-pro")).toBe(false);
    expect(isGptModel("litellm/gemini-3.1-pro")).toBe(false);
  });

  test("opencode provider is not gpt", () => {
    expect(isGptModel("opencode/claude-opus-4-6")).toBe(false);
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
    expect(isMiniMaxModel("anthropic/claude-opus-4-6")).toBe(false);
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
    expect(isGlmModel("anthropic/claude-opus-4-6")).toBe(false);
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
    expect(isGeminiModel("anthropic/claude-opus-4-6")).toBe(false);
    expect(isGeminiModel("anthropic/claude-sonnet-4-6")).toBe(false);
  });

  test("#given opencode provider #then returns false", () => {
    expect(isGeminiModel("opencode/claude-opus-4-6")).toBe(false);
  });
});
