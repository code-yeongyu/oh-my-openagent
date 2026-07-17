import { describe, expect, test } from "bun:test";
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
