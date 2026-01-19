import { describe, expect, test } from "bun:test";
import { resolveModel, type ModelResolutionInput } from "./model-resolver";

describe("resolveModel", () => {
  describe("priority chain", () => {
    test("returns userModel when all three are set", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      };

      // #when
      const result = resolveModel(input);

      // #then
      expect(result).toBe("anthropic/claude-opus-4-5");
    });

    test("returns inheritedModel when userModel is undefined", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      };

      // #when
      const result = resolveModel(input);

      // #then
      expect(result).toBe("openai/gpt-5.2");
    });

    test("returns systemDefault when both userModel and inheritedModel are undefined", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: undefined,
        systemDefault: "google/gemini-3-pro",
      };

      // #when
      const result = resolveModel(input);

      // #then
      expect(result).toBe("google/gemini-3-pro");
    });
  });

  describe("empty string handling", () => {
    test("treats empty string as unset, uses fallback", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "",
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      };

      // #when
      const result = resolveModel(input);

      // #then
      expect(result).toBe("openai/gpt-5.2");
    });

    test("treats whitespace-only string as unset, uses fallback", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "   ",
        inheritedModel: "",
        systemDefault: "google/gemini-3-pro",
      };

      // #when
      const result = resolveModel(input);

      // #then
      expect(result).toBe("google/gemini-3-pro");
    });
  });

  describe("purity", () => {
    test("same input returns same output (referential transparency)", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      };

      // #when
      const result1 = resolveModel(input);
      const result2 = resolveModel(input);

      // #then
      expect(result1).toBe(result2);
    });
  });
});
