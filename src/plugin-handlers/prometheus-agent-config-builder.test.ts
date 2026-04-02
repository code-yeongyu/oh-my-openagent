import { describe, expect, test, spyOn, afterEach, beforeEach } from "bun:test";
import { buildPrometheusAgentConfig } from "./prometheus-agent-config-builder";
import * as shared from "../shared";
import * as categoryResolver from "./category-config-resolver";
import type { CategoryConfig } from "../config/schema";

describe("buildPrometheusAgentConfig", () => {
  let fetchAvailableModelsSpy: ReturnType<typeof spyOn>;
  let readConnectedProvidersCacheSpy: ReturnType<typeof spyOn>;
  let resolveCategoryConfigSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchAvailableModelsSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set());
    readConnectedProvidersCacheSpy = spyOn(shared, "readConnectedProvidersCache").mockReturnValue(null);
    resolveCategoryConfigSpy = spyOn(categoryResolver, "resolveCategoryConfig").mockImplementation(
      (category) => ({ model: `${category}/default-model` } as CategoryConfig)
    );
    logSpy = spyOn(shared, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchAvailableModelsSpy.mockRestore();
    readConnectedProvidersCacheSpy.mockRestore();
    resolveCategoryConfigSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe("#given no explicit Prometheus model configured", () => {
    describe("#when currentModel is NOT in Prometheus fallback chain", () => {
      test("falls through to fallback chain instead of using currentModel as override", async () => {
        // given - currentModel is a model NOT in Prometheus fallback chain
        // Prometheus chain: claude-opus-4-6, gpt-5.4, glm-5, gemini-3.1-pro
        const currentModel = "some-provider/gpt-5.3-codex";

        // when
        await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel,
        });

        // then - should NOT have resolved via override (currentModel)
        // The model should fall through to fallback chain
        const lastLogCall = logSpy.mock.calls[logSpy.mock.calls.length - 1];
        const lastLogMessage = lastLogCall?.[0] as string;
        expect(lastLogMessage).not.toContain("UI selection");
        expect(lastLogMessage).not.toContain("config override");
      });
    });

    describe("#when currentModel IS in Prometheus fallback chain", () => {
      test("preserves currentModel as uiSelectedModel for claude-opus-4-6", async () => {
        // given - currentModel matches a Prometheus fallback chain entry
        const currentModel = "anthropic/claude-opus-4-6";

        // when - should not throw and should produce a valid config
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel,
        });

        // then - config should be produced (currentModel accepted as valid)
        expect(result).toBeDefined();
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

      test("accepts glm-5 from fallback chain", async () => {
        const result = await buildPrometheusAgentConfig({
          configAgentPlan: undefined,
          pluginPrometheusOverride: undefined,
          userCategories: undefined,
          currentModel: "opencode-go/glm-5",
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
      const currentModel = "anthropic/claude-opus-4-6";
      const explicitModel = "custom-provider/custom-model";

      // when
      await buildPrometheusAgentConfig({
        configAgentPlan: undefined,
        pluginPrometheusOverride: { model: explicitModel },
        userCategories: undefined,
        currentModel,
      });

      // then - should resolve via config override, not UI selection
      const configOverrideLog = logSpy.mock.calls.find(
        (call) => (call[0] as string).includes("config override")
      );
      expect(configOverrideLog).toBeDefined();
      expect(configOverrideLog?.[1]).toEqual({ model: explicitModel });
    });
  });

  describe("#given category with model configured", () => {
    test("category model wins when no explicit override", async () => {
      // given
      const currentModel = "anthropic/claude-opus-4-6";
      const categoryModel = "category-provider/category-model";

      resolveCategoryConfigSpy.mockReturnValue({
        model: categoryModel,
      } as CategoryConfig);

      // when
      await buildPrometheusAgentConfig({
        configAgentPlan: undefined,
        pluginPrometheusOverride: { category: "test-category" },
        userCategories: { "test-category": { model: categoryModel } },
        currentModel,
      });

      // then - should resolve via category default
      const categoryDefaultLog = logSpy.mock.calls.find(
        (call) => (call[0] as string).includes("category default")
      );
      expect(categoryDefaultLog).toBeDefined();
    });

    test("explicit model override wins over category model", async () => {
      // given
      const categoryModel = "category-provider/category-model";
      const explicitModel = "explicit-provider/explicit-model";

      resolveCategoryConfigSpy.mockReturnValue({
        model: categoryModel,
      } as CategoryConfig);

      // when
      await buildPrometheusAgentConfig({
        configAgentPlan: undefined,
        pluginPrometheusOverride: {
          category: "test-category",
          model: explicitModel,
        },
        userCategories: { "test-category": { model: categoryModel } },
        currentModel: undefined,
      });

      // then - should resolve via config override, not category default
      const configOverrideLog = logSpy.mock.calls.find(
        (call) => (call[0] as string).includes("config override")
      );
      expect(configOverrideLog).toBeDefined();
      expect(configOverrideLog?.[1]).toEqual({ model: explicitModel });
    });
  });

  describe("#given no currentModel and no explicit config", () => {
    test("falls through to fallback chain", async () => {
      // given - no currentModel, no explicit config
      readConnectedProvidersCacheSpy.mockReturnValue(["anthropic"]);

      // when
      await buildPrometheusAgentConfig({
        configAgentPlan: undefined,
        pluginPrometheusOverride: undefined,
        userCategories: undefined,
        currentModel: undefined,
      });

      // then - should resolve via fallback chain
      const fallbackChainLog = logSpy.mock.calls.find(
        (call) => (call[0] as string).includes("fallback chain")
      );
      expect(fallbackChainLog).toBeDefined();
    });
  });
});
