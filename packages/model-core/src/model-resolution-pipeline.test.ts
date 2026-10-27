import { describe, expect, test } from "bun:test";
import { AGENT_MODEL_REQUIREMENTS } from "./agent-model-requirements";
import { CATEGORY_MODEL_REQUIREMENTS } from "./category-model-requirements";
import { FABLE_55_LAUNCH, FABLE_55_RELEASED } from "./fable-55-launch";
import { resolveModelPipeline } from "./model-resolution-pipeline";

describe("resolveModelPipeline", () => {
	test("does not return unused explicit user config metadata in override result", () => {
		// given
		const result = resolveModelPipeline({
			intent: {
				userModel: "openai/gpt-5.5",
			},
			constraints: {
				availableModels: new Set<string>(),
			},
		});

		// when
		const hasExplicitUserConfigField = result
			? Object.prototype.hasOwnProperty.call(result, "explicitUserConfig")
			: false;

		// then
		expect(result).toEqual({ model: "openai/gpt-5.5", provenance: "override" });
		expect(hasExplicitUserConfigField).toBe(false);
	});

	test("resolves catalog fallback entries that already include their provider exactly once", () => {
		const result = resolveModelPipeline({
			constraints: { availableModels: new Set(["openrouter/qwen3.5-plus"]) },
			policy: {
				fallbackChain: [{ providers: ["openrouter"], model: "openrouter/qwen3.5-plus" }],
			},
		})

		expect(result?.model).toBe("openrouter/qwen3.5-plus")
		expect(result?.provenance).toBe("provider-fallback")
	})

	test("does not resolve provider fallback entries through a different provider with the same model name", () => {
		// given
		const result = resolveModelPipeline({
			constraints: {
				availableModels: new Set(["other/claude-opus-4-7"]),
			},
			policy: {
				fallbackChain: [
					{
						providers: ["anthropic"],
						model: "claude-opus-4-7",
						variant: "max",
					},
				],
				systemDefaultModel: "openai/gpt-5.5",
			},
		});

		// when
		const resolvedModel = result?.model;

		// then
		expect(resolvedModel).toBe("openai/gpt-5.5");
		expect(result?.provenance).toBe("system-default");
	});
});

test("inherits the fallback variant for an explicit matching user model", () => {
	// given
	const result = resolveModelPipeline({
		intent: {
			userModel: "openai/gpt-5.6-sol",
		},
		constraints: {
			availableModels: new Set<string>(),
		},
		policy: {
			fallbackChain: [
				{
					providers: ["openai", "vercel"],
					model: "gpt-5.6-sol",
					variant: "high",
				},
			],
		},
	})

	// when
	const variant = result?.variant

	// then
	expect(result?.model).toBe("openai/gpt-5.6-sol")
	expect(result?.provenance).toBe("override")
	expect(variant).toBe("high")
})

test("inherits the fallback variant for an explicit transformed gateway model", () => {
	// given
	const result = resolveModelPipeline({
		intent: {
			userModel: "vercel/openai/gpt-5.6-sol",
		},
		constraints: {
			availableModels: new Set<string>(),
		},
		policy: {
			fallbackChain: [
				{
					providers: ["openai", "vercel"],
					model: "gpt-5.6-sol",
					variant: "high",
				},
			],
		},
	})

	// when
	const variant = result?.variant

	// then
	expect(result?.model).toBe("vercel/openai/gpt-5.6-sol")
	expect(result?.provenance).toBe("override")
	expect(variant).toBe("high")
})

// The provisional Fable 5.5 id must never reach live routing before release: a cold provider-models
// cache with only anthropic connected gives no proof the model exists.
describe("launch-gated Fable 5.5 on a cold provider-models cache", () => {
	const expected = FABLE_55_RELEASED ? `anthropic/${FABLE_55_LAUNCH.id}` : "anthropic/claude-fable-5-1";
	const coldAnthropic = { availableModels: new Set<string>(), connectedProviders: ["anthropic"] };

	test.each(["metis", "prometheus"])("%s resolves past the launch rung", (agent) => {
		const result = resolveModelPipeline({
			constraints: coldAnthropic,
			policy: { fallbackChain: AGENT_MODEL_REQUIREMENTS[agent]?.fallbackChain },
		});
		expect(result?.model).toBe(expected);
	});

	test("artistry's launch-gated category default falls through to its chain", () => {
		const result = resolveModelPipeline({
			intent: { categoryDefaultModel: `anthropic/${FABLE_55_LAUNCH.id}` },
			constraints: coldAnthropic,
			policy: { fallbackChain: CATEGORY_MODEL_REQUIREMENTS.artistry?.fallbackChain },
		});
		expect(result?.model).toBe(expected);
	});
});
