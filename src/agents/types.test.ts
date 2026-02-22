import { describe, test, expect } from "bun:test";
import { isGptModel } from "./types";

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
    expect(isGptModel("anthropic/claude-sonnet-4-5")).toBe(false);
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
