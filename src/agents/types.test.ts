import { describe, test, expect } from "bun:test";
import { isGptModel, isGeminiModel } from "./types";

describe("isGptModel", () => {
  test("standard openai provider models", () => {
    expect(isGptModel("openai/gpt-5.2")).toBe(true);
    expect(isGptModel("openai/gpt-4o")).toBe(true);
    expect(isGptModel("openai/o1")).toBe(true);
    expect(isGptModel("openai/o3-mini")).toBe(true);
  });

  test("github copilot gpt models", () => {
    expect(isGptModel("github-copilot/gpt-5.2")).toBe(true);
    expect(isGptModel("github-copilot/gpt-4o")).toBe(true);
  });

  test("litellm proxied gpt models", () => {
    expect(isGptModel("litellm/gpt-5.2")).toBe(true);
    expect(isGptModel("litellm/gpt-4o")).toBe(true);
    expect(isGptModel("litellm/o1")).toBe(true);
    expect(isGptModel("litellm/o3-mini")).toBe(true);
    expect(isGptModel("litellm/o4-mini")).toBe(true);
  });

  test("other proxied gpt models", () => {
    expect(isGptModel("ollama/gpt-4o")).toBe(true);
    expect(isGptModel("custom-provider/gpt-5.2")).toBe(true);
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
    expect(isGptModel("google/gemini-3-pro")).toBe(false);
    expect(isGptModel("litellm/gemini-3-pro")).toBe(false);
  });

  test("opencode provider is not gpt", () => {
    expect(isGptModel("opencode/claude-opus-4-6")).toBe(false);
  });
});

describe("isGeminiModel", () => {
  test("#given google provider models #then returns true", () => {
    expect(isGeminiModel("google/gemini-3-pro")).toBe(true);
    expect(isGeminiModel("google/gemini-3-flash")).toBe(true);
    expect(isGeminiModel("google/gemini-2.5-pro")).toBe(true);
  });

  test("#given google-vertex provider models #then returns true", () => {
    expect(isGeminiModel("google-vertex/gemini-3-pro")).toBe(true);
    expect(isGeminiModel("google-vertex/gemini-3-flash")).toBe(true);
  });

  test("#given github copilot gemini models #then returns true", () => {
    expect(isGeminiModel("github-copilot/gemini-3-pro")).toBe(true);
    expect(isGeminiModel("github-copilot/gemini-3-flash")).toBe(true);
  });

  test("#given litellm proxied gemini models #then returns true", () => {
    expect(isGeminiModel("litellm/gemini-3-pro")).toBe(true);
    expect(isGeminiModel("litellm/gemini-3-flash")).toBe(true);
    expect(isGeminiModel("litellm/gemini-2.5-pro")).toBe(true);
  });

  test("#given other proxied gemini models #then returns true", () => {
    expect(isGeminiModel("custom-provider/gemini-3-pro")).toBe(true);
    expect(isGeminiModel("ollama/gemini-3-flash")).toBe(true);
  });

  test("#given gpt models #then returns false", () => {
    expect(isGeminiModel("openai/gpt-5.2")).toBe(false);
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
