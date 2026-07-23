import { describe, expect, test, spyOn, afterEach, beforeEach, mock } from "bun:test";

import * as shared from "../shared";
import * as categoryResolver from "./category-config-resolver";
import type { CategoryConfig } from "../config/schema";

let buildPrometheusAgentConfig: (typeof import("./prometheus-agent-config-builder"))["buildPrometheusAgentConfig"]

async function importFreshPrometheusAgentConfigBuilderModule(): Promise<typeof import("./prometheus-agent-config-builder")> {
  return import(`./prometheus-agent-config-builder?test=${Date.now()}-${Math.random()}`)
}

describe("buildPrometheusAgentConfig", () => {
  let fetchAvailableModelsSpy: ReturnType<typeof spyOn>;
  let readConnectedProvidersCacheSpy: ReturnType<typeof spyOn>;
  let resolveCategoryConfigSpy: ReturnType<typeof spyOn>;
  let resolveModelPipelineSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    mock.restore();
    fetchAvailableModelsSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set());
    readConnectedProvidersCacheSpy = spyOn(shared, "readConnectedProvidersCache").mockReturnValue(null);
    resolveCategoryConfigSpy = spyOn(categoryResolver, "resolveCategoryConfig").mockImplementation(
      (category) => ({ model: `${category}/default-model` } as CategoryConfig)
    );
    resolveModelPipelineSpy = spyOn(shared, "resolveModelPipeline").mockReturnValue({
      model: "anthropic/claude-opus-4-8",
      provenance: "provider-fallback",
    });
    ;({ buildPrometheusAgentConfig } = await importFreshPrometheusAgentConfigBuilderModule())
  });

  afterEach(() => {
    fetchAvailableModelsSpy.mockRestore();
    readConnectedProvidersCacheSpy.mockRestore();
    resolveCategoryConfigSpy.mockRestore();
    resolveModelPipelineSpy.mockRestore();
    mock.restore();
  });

  describe("#given no explicit Prometheus model configured", () => {
    describe("#when currentModel is NOT in Prometheus fallback chain", () => {
      test("falls through to fallback chain instead of using currentModel as override", async () => {
        // given - currentModel is a model NOT in Prometheus fallback chain
        // Prometheus chain: claude-opus-4-8, gpt-5.4, glm-5, gemini-3.1-pro
        const currentModel = "some-provider/not-prometheus-compatible";

        // when
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel,
        });

        // then
        expect(resolveModelPipelineSpy).toHaveBeenCalledWith({
          intent: {
            uiSelectedModel: undefined,
            userModel: undefined,
            categoryDefaultModel: undefined,
          },
          constraints: { availableModels: new Set() },
          policy: expect.objectContaining({
            systemDefaultModel: undefined,
          }),
        });
        expect(result.model).toBe("anthropic/claude-opus-4-8");
      });
    });

    describe("#when currentModel IS in Prometheus fallback chain", () => {
      test("preserves currentModel as uiSelectedModel for claude-opus-4-8", async () => {
        // given - currentModel matches a Prometheus fallback chain entry
        const currentModel = "anthropic/claude-opus-4-8";

        // when - should not throw and should produce a valid config
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel,
        });

        // then - config should be produced (currentModel accepted as valid)
        expect(result).toBeDefined();
        expect(resolveModelPipelineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            intent: expect.objectContaining({
              uiSelectedModel: currentModel,
            }),
          })
        );
      });

      test("accepts gpt-5.4 from fallback chain", async () => {
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel: "openai/gpt-5.4",
        });
        expect(result).toBeDefined();
      });

      test("accepts glm-5.1 from fallback chain", async () => {
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel: "opencode-go/glm-5.1",
        });
        expect(result).toBeDefined();
      });

      test("accepts gemini-3.1-pro from fallback chain", async () => {
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel: "google/gemini-3.1-pro",
        });
        expect(result).toBeDefined();
      });
    });
  });

  describe("#given explicit Prometheus model configured via plugin override", () => {
      test("explicit config wins over currentModel and fallback chain", async () => {
      // given
      const currentModel = "anthropic/claude-opus-4-8";
      const explicitModel = "custom-provider/custom-model";

      // when
        resolveModelPipelineSpy.mockReturnValue({
          model: explicitModel,
          variant: "high",
          provenance: "override",
        });

        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: { model: explicitModel },
          userCategories: undefined,
          currentModel,
        });

        // then
        expect(resolveModelPipelineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            intent: {
              uiSelectedModel: undefined,
              userModel: explicitModel,
              categoryDefaultModel: undefined,
            },
          })
        );
        expect(result.model).toBe(explicitModel);
        expect(result.variant).toBe("high");
      });
  });

  describe("#given category with model configured", () => {
      test("category model wins when no explicit override", async () => {
      // given
      const currentModel = "anthropic/claude-opus-4-8";
      const categoryModel = "category-provider/category-model";

      resolveCategoryConfigSpy.mockReturnValue({
        model: categoryModel,
      } as CategoryConfig);

      // when
        resolveModelPipelineSpy.mockReturnValue({
          model: categoryModel,
          provenance: "category-default",
        });

        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: { category: "test-category" },
          userCategories: { "test-category": { model: categoryModel } },
          currentModel,
        });

        // then
        expect(resolveCategoryConfigSpy).toHaveBeenCalledWith("test-category", {
          "test-category": { model: categoryModel },
        });
        expect(resolveModelPipelineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            intent: {
              uiSelectedModel: undefined,
              userModel: undefined,
              categoryDefaultModel: categoryModel,
            },
          })
        );
        expect(result.model).toBe(categoryModel);
      });

    test("explicit model override wins over category model", async () => {
      // given
      const categoryModel = "category-provider/category-model";
      const explicitModel = "explicit-provider/explicit-model";

      resolveCategoryConfigSpy.mockReturnValue({
        model: categoryModel,
      } as CategoryConfig);

      // when
        resolveModelPipelineSpy.mockReturnValue({
          model: explicitModel,
          provenance: "override",
        });

        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: {
            category: "test-category",
          model: explicitModel,
        },
        userCategories: { "test-category": { model: categoryModel } },
          currentModel: undefined,
        });

        // then
        expect(resolveModelPipelineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            intent: {
              uiSelectedModel: undefined,
              userModel: explicitModel,
              categoryDefaultModel: categoryModel,
            },
          })
        );
        expect(result.model).toBe(explicitModel);
      });
  });

  describe("#given category fallback_models", () => {
    test("materializes category fallback_models when Prometheus has no explicit fallback_models", async () => {
      // given
      const categoryFallbackModels = ["openai/gpt-5.4"];
      resolveCategoryConfigSpy.mockReturnValue({
        fallback_models: categoryFallbackModels,
      } as CategoryConfig);

      // when
      const result = await buildPrometheusAgentConfig({
        configAgentPlan: undefined,
        pluginPrometheusOverride: { category: "test-category" },
        userCategories: { "test-category": { fallback_models: categoryFallbackModels } },
        currentModel: undefined,
      });

      // then
      expect(result.fallback_models).toEqual(categoryFallbackModels);
    });

    test.each([
      ["explicit fallback_models", ["openai/gpt-5.5"]],
      ["explicit empty fallback_models", []],
    ])("preserves %s over category fallback_models", async (_label, explicitFallbackModels) => {
      // given
      const categoryFallbackModels = ["openai/gpt-5.4"];
      resolveCategoryConfigSpy.mockReturnValue({
        fallback_models: categoryFallbackModels,
      } as CategoryConfig);

      // when
      const result = await buildPrometheusAgentConfig({
        configAgentPlan: undefined,
        pluginPrometheusOverride: {
          category: "test-category",
          fallback_models: explicitFallbackModels,
        },
        userCategories: { "test-category": { fallback_models: categoryFallbackModels } },
        currentModel: undefined,
      });

      // then
      expect(result.fallback_models).toEqual(explicitFallbackModels);
    });
  });

  describe("#given no currentModel and no explicit config", () => {
    test("falls through to fallback chain", async () => {
      // given - no currentModel, no explicit config
      readConnectedProvidersCacheSpy.mockReturnValue(["anthropic"]);

      // when
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel: undefined,
        });

        // then
        expect(fetchAvailableModelsSpy).toHaveBeenCalledWith(undefined, {
          connectedProviders: ["anthropic"],
        });
        expect(resolveModelPipelineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            intent: {
              uiSelectedModel: undefined,
              userModel: undefined,
              categoryDefaultModel: undefined,
            },
          })
        );
        expect(result.model).toBe("anthropic/claude-opus-4-8");
      });
  });

  test("returns Prometheus as a primary agent", async () => {
    // given

    // when
    const result = await buildPrometheusAgentConfig({
      configAgentPlan: undefined,
      pluginPrometheusOverride: undefined,
      userCategories: undefined,
      currentModel: undefined,
    });

    // then
    expect(result.mode).toBe("primary");
  });

  describe("#given a Prometheus prompt override tries to replace the base prompt", () => {
    test("keeps the mandatory ulw-plan skill instruction when prompt is configured", async () => {
      // given
      const replacementOnlyPrompt = "OVERRIDE_PROMPT_NO_SHARED_SKILL";

      // when
      const result = await buildPrometheusAgentConfig({
        configAgentPlan: undefined,
        pluginPrometheusOverride: { prompt: replacementOnlyPrompt },
        userCategories: undefined,
        currentModel: undefined,
      });

      // then
      expect(typeof result.prompt).toBe("string");
      if (typeof result.prompt === "string") {
        expect(result.prompt).toContain('skill(name="ulw-plan")');
        expect(result.prompt).toContain(replacementOnlyPrompt);
        expect(result.prompt).not.toBe(replacementOnlyPrompt);
      }
    });
  });
});
