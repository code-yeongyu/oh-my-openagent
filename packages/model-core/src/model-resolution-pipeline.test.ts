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

	test("#given pipe user fallback and available gateway model #when resolved #then matching routed provider wins", () => {
		// #given
		const result = resolveModelPipeline({
			intent: {
				userFallbackModels: ["omniRoute|9router/openai/gpt-5.5"],
			},
			constraints: {
				availableModels: new Set(["9router/openai/gpt-5.5"]),
			},
			policy: {
				systemDefaultModel: "openai/gpt-5.5",
			},
		});

		// when
		const resolvedModel = result?.model;

		// then
		expect(resolvedModel).toBe("9router/openai/gpt-5.5");
		expect(result?.provenance).toBe("provider-fallback");
	});

	test("#given pipe user fallback and connected providers #when availability is unknown #then connected routed provider wins", () => {
		// #given
		const result = resolveModelPipeline({
			intent: {
				userFallbackModels: ["omniRoute|9router/openai/gpt-5.5"],
			},
			constraints: {
				availableModels: new Set(),
				connectedProviders: ["9router"],
			},
			policy: {
				systemDefaultModel: "openai/gpt-5.5",
			},
		});

		// when
		const resolvedModel = result?.model;

		// then
		expect(resolvedModel).toBe("9router/openai/gpt-5.5");
		expect(result?.provenance).toBe("provider-fallback");
	});

	test("#given gateway fallback chain and available transformed model #when resolved #then gateway display transform is used for matching", () => {
		// #given
		const result = resolveModelPipeline({
			constraints: {
				availableModels: new Set(["vercel/openai/gpt-5.5"]),
			},
			policy: {
				fallbackChain: [{ providers: ["vercel"], model: "gpt-5.5", variant: "medium" }],
				systemDefaultModel: "openai/gpt-5.5",
			},
		});

		// when
		const resolvedModel = result?.model;

		// then
		expect(resolvedModel).toBe("vercel/openai/gpt-5.5");
		expect(result?.variant).toBe("medium");
		expect(result?.provenance).toBe("provider-fallback");
	});

	test("#given malformed pipe user fallback #when resolved #then resolution falls through without crashing", () => {
		// #given
		const result = resolveModelPipeline({
			intent: {
				userFallbackModels: ["omniRoute|/gpt-5.5"],
			},
			constraints: {
				availableModels: new Set(["omniRoute/gpt-5.5"]),
			},
			policy: {
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
