import { describe, expect, test } from "bun:test";
import { applyOverrides } from "../../agents/builtin-agents/agent-overrides";
import { applyModelResolution } from "../../agents/builtin-agents/model-resolution";
import { createExploreAgent } from "../../agents/explore";
import { createMetisAgent } from "../../agents/metis";
import { AGENT_MODEL_REQUIREMENTS } from "../../shared";
import { mergeCategories } from "../../shared/merge-categories";
import { MODEL_REGISTRY } from "./registry";

type IntegrationConfig = {
	agents?: Record<string, { model?: string; fallback_models?: string[]; category?: string }>;
	model_profile?: "premium" | "balanced" | "economy";
};

const ALL_AVAILABLE_MODELS = new Set([
	...Object.keys(MODEL_REGISTRY),
	"openai/gpt-5.4",
	"anthropic/claude-sonnet-4-6",
	"google/gemini-3-flash",
]);

function resolveAgent(config: IntegrationConfig, agentName: string) {
	return applyModelResolution({
		userModel: config.agents?.[agentName]?.model,
		profileName: config.model_profile,
		agentName,
		requirement: AGENT_MODEL_REQUIREMENTS[agentName],
		availableModels: ALL_AVAILABLE_MODELS,
		systemDefaultModel: "claude-opus-4-6",
	});
}

describe("model registry integration", () => {
	describe("#given empty config", () => {
		describe("#when resolving against hardcoded requirements", () => {
			test("#then agents resolve to the same hardcoded models", () => {
				expect(resolveAgent({}, "sisyphus")?.model).toBe("claude-opus-4-6");
				expect(resolveAgent({}, "oracle")?.model).toBe("openai/gpt-5.4");
				expect(resolveAgent({}, "explore")?.model).toBe("grok-code-fast-1");
			});
		});
	});

	describe("#given profile and manual override", () => {
		describe("#when oracle model is manually pinned", () => {
			test("#then manual override beats profile override", () => {
				const result = resolveAgent(
					{
						agents: {
							oracle: { model: "openai/gpt-5.4" },
						},
						model_profile: "economy",
					},
					"oracle",
				);

				expect(result?.model).toBe("openai/gpt-5.4");
			});
		});
	});

	describe("#given economy profile", () => {
		describe("#when resolving profile-aware models", () => {
			test("#then sisyphus downgrades to sonnet and oracle downgrades to flash", () => {
				const sisyphus = resolveAgent({ model_profile: "economy" }, "sisyphus");
				const oracle = resolveAgent({ model_profile: "economy" }, "oracle");

				expect(sisyphus?.model).toBe("claude-sonnet-4-6");
				expect(sisyphus?.model).not.toBe("claude-opus-4-6");
				expect(oracle?.model).toBe("gemini-3-flash");
			});
		});
	});

	describe("#given premium profile", () => {
		describe("#when comparing with no profile", () => {
			test("#then behavior is unchanged", () => {
				const withoutProfile = resolveAgent({}, "sisyphus");
				const withPremiumProfile = resolveAgent({ model_profile: "premium" }, "sisyphus");

				expect(withPremiumProfile).toEqual(withoutProfile);
			});
		});
	});

	describe("#given balanced profile", () => {
		describe("#when comparing with no profile", () => {
			test("#then behavior is unchanged", () => {
				const withoutProfile = resolveAgent({}, "oracle");
				const withBalancedProfile = resolveAgent(
					{ model_profile: "balanced" },
					"oracle",
				);

				expect(withBalancedProfile).toEqual(withoutProfile);
			});
		});
	});

	describe("#given agent override with fallback_models", () => {
		describe("#when applying overrides to explore", () => {
			test("#then fallback_models are preserved", () => {
				const base = createExploreAgent("grok-code-fast-1");
				const mergedCategories = mergeCategories();
				const overridden = applyOverrides(
					base,
					{
						fallback_models: ["provider-a/model-a", "provider-b/model-b"],
					},
					mergedCategories,
				);

				expect((overridden as { fallback_models?: string[] }).fallback_models).toEqual([
					"provider-a/model-a",
					"provider-b/model-b",
				]);
			});
		});
	});

	describe("#given metis category override", () => {
		describe("#when category is switched to quick", () => {
			test("#then quick category model is applied", () => {
				const base = createMetisAgent("claude-opus-4-6");
				const mergedCategories = mergeCategories();
				const overridden = applyOverrides(
					base,
					{ category: "quick" },
					mergedCategories,
				);

				expect(overridden.model).toContain("claude-haiku-4-5");
				expect(overridden.model).not.toContain("claude-opus-4-6");
				expect((overridden as { category?: string }).category).toBe("quick");
			});
		});
	});
});
