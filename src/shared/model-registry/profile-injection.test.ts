import { describe, expect, it } from "bun:test";
import { applyModelResolution } from "../../agents/builtin-agents/model-resolution";
import { AGENT_MODEL_REQUIREMENTS } from "../../shared";

describe("Profile override injection", () => {
	describe("#given no manual agent model override", () => {
		describe("#when profile override exists for agent", () => {
			it("#then profile override model is injected as userModel", () => {
				const result = applyModelResolution({
					profileName: "economy",
					agentName: "sisyphus",
					requirement: AGENT_MODEL_REQUIREMENTS.sisyphus,
					availableModels: new Set(["anthropic/claude-sonnet-4-6"]),
					systemDefaultModel: "anthropic/claude-opus-4-6",
				});

				expect(result).toMatchObject({
					model: "claude-sonnet-4-6",
					provenance: "override",
				});
			});
		});
	});

	describe("#given manual agent model override", () => {
		describe("#when profile override also exists", () => {
			it("#then manual override wins over profile", () => {
				const result = applyModelResolution({
					userModel: "openai/gpt-5.4",
					profileName: "economy",
					agentName: "sisyphus",
					requirement: AGENT_MODEL_REQUIREMENTS.sisyphus,
					availableModels: new Set([
						"openai/gpt-5.4",
						"anthropic/claude-sonnet-4-6",
					]),
					systemDefaultModel: "anthropic/claude-opus-4-6",
				});

				expect(result).toMatchObject({
					model: "openai/gpt-5.4",
					provenance: "override",
				});
			});
		});
	});

	describe("#given balanced profile", () => {
		describe("#when resolving model with and without profile name", () => {
			it("#then behavior remains unchanged", () => {
				const withoutProfile = applyModelResolution({
					requirement: AGENT_MODEL_REQUIREMENTS.oracle,
					availableModels: new Set(["openai/gpt-5.4"]),
					systemDefaultModel: "anthropic/claude-opus-4-6",
				});

				const withBalancedProfile = applyModelResolution({
					profileName: "balanced",
					agentName: "oracle",
					requirement: AGENT_MODEL_REQUIREMENTS.oracle,
					availableModels: new Set(["openai/gpt-5.4"]),
					systemDefaultModel: "anthropic/claude-opus-4-6",
				});

				expect(withBalancedProfile?.model).toEqual(withoutProfile?.model);
				expect(withBalancedProfile?.provenance).toEqual(withoutProfile?.provenance);
			});
		});
	});
});
