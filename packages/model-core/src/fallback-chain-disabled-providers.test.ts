import { describe, expect, test } from "bun:test";
import {
	filterFallbackChainByDisabledProviders,
	getFirstAllowedFallbackEntry,
} from "./fallback-chain-provider-filter";
import { resolveModelPipeline } from "./model-resolution-pipeline";

const MIRRORED_CLAUDE_ENTRY = {
	providers: ["anthropic", "opencode"],
	model: "claude-opus-5",
	variant: "max",
} as const;

const ALLOWED_OPENAI_ENTRY = {
	providers: ["openai"],
	model: "gpt-5.6",
	variant: "high",
} as const;

describe("resolveModelPipeline disabled provider constraints", () => {
	test("skips every mirror of a disabled provider when using connected providers", () => {
		// given
		const fallbackChain = [MIRRORED_CLAUDE_ENTRY, ALLOWED_OPENAI_ENTRY];

		// when
		const result = resolveModelPipeline({
			constraints: {
				availableModels: new Set<string>(),
				connectedProviders: ["opencode", "openai"],
				disabledProviders: ["anthropic"],
			},
			policy: { fallbackChain },
		});

		// then
		expect(result).toMatchObject({
			model: "openai/gpt-5.6",
			provenance: "provider-fallback",
			variant: "high",
		});
	});

	test("matches disabled providers case-insensitively when using available models", () => {
		// given
		const fallbackChain = [MIRRORED_CLAUDE_ENTRY, ALLOWED_OPENAI_ENTRY];

		// when
		const result = resolveModelPipeline({
			constraints: {
				availableModels: new Set(["opencode/claude-opus-5", "openai/gpt-5.6"]),
				disabledProviders: ["AnThRoPiC"],
			},
			policy: { fallbackChain },
		});

		// then
		expect(result).toMatchObject({
			model: "openai/gpt-5.6",
			provenance: "provider-fallback",
			variant: "high",
		});
	});

	test("preserves normal fallback selection when no listed provider is disabled", () => {
		// given
		const fallbackChain = [MIRRORED_CLAUDE_ENTRY, ALLOWED_OPENAI_ENTRY];

		// when
		const result = resolveModelPipeline({
			constraints: {
				availableModels: new Set<string>(),
				connectedProviders: ["opencode", "openai"],
				disabledProviders: ["google"],
			},
			policy: { fallbackChain },
		});

		// then
		expect(result?.model).toBe("opencode/claude-opus-5");
		expect(result?.variant).toBe("max");
	});

	test("keeps an explicit user override and inherits its original fallback variant", () => {
		// given
		const fallbackChain = [MIRRORED_CLAUDE_ENTRY, ALLOWED_OPENAI_ENTRY];

		// when
		const result = resolveModelPipeline({
			intent: { userModel: "opencode/claude-opus-5" },
			constraints: {
				availableModels: new Set<string>(),
				disabledProviders: ["anthropic"],
			},
			policy: { fallbackChain },
		});

		// then
		expect(result).toEqual({
			model: "opencode/claude-opus-5",
			provenance: "override",
			variant: "max",
		});
	});
});

describe("fallback chain disabled provider policy", () => {
	test("preserves the original chain when no entry is filtered", () => {
		// given
		const fallbackChain = [MIRRORED_CLAUDE_ENTRY, ALLOWED_OPENAI_ENTRY];

		// when
		const filteredChain = filterFallbackChainByDisabledProviders(
			fallbackChain,
			["google"],
		);

		// then
		expect(filteredChain).toBe(fallbackChain);
	});

	test("returns the first entry whose mirror providers are all allowed", () => {
		// given
		const fallbackChain = [MIRRORED_CLAUDE_ENTRY, ALLOWED_OPENAI_ENTRY];

		// when
		const firstAllowedEntry = getFirstAllowedFallbackEntry(
			fallbackChain,
			["anthropic"],
		);

		// then
		expect(firstAllowedEntry).toBe(ALLOWED_OPENAI_ENTRY);
	});
});
