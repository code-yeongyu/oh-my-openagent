import { describe, expect, test } from "bun:test";
import type { CategoryConfig } from "../../config/schema";
import { maybeCreateHephaestusConfig } from "../builtin-agents/hephaestus-agent";
import type { AgentOverrides } from "../types";

const GPT_5_6_PROMPT_MARKER = "based on GPT-5.6";
const EXPLICIT_VARIANT = "xhigh";
const SUPPORTED_MODEL_IDS = [
	"openai/gpt-5.6-sol",
	"openai/gpt-5.6-terra-fast",
	"openai/gpt-5.6-luna-pro",
	"vercel/openai/gpt-5.6-sol",
	"cx/gpt-5.6-sol",
] as const;

describe("maybeCreateHephaestusConfig GPT-5.6 registration", () => {
	for (const model of SUPPORTED_MODEL_IDS) {
		test(`#given ${model} with an explicit variant #when Hephaestus registers #then the configured model and GPT-5.6 prompt are preserved`, () => {
			// given
			const agentOverrides: AgentOverrides = {
				hephaestus: {
					model,
					variant: EXPLICIT_VARIANT,
				},
			};
			const mergedCategories: Record<string, CategoryConfig> = {};

			// when
			const config = maybeCreateHephaestusConfig({
				disabledAgents: [],
				agentOverrides,
				availableModels: new Set([model]),
				systemDefaultModel: model,
				isFirstRunNoCache: false,
				availableAgents: [],
				availableSkills: [],
				availableCategories: [],
				mergedCategories,
				useTaskSystem: false,
			});

			// then
			expect(config).toBeDefined();
			expect(config?.model).toBe(model);
			expect(config?.variant).toBe(EXPLICIT_VARIANT);
			expect(config?.prompt).toContain(GPT_5_6_PROMPT_MARKER);
		});
	}

	test("#given an unsupported Claude model #when Hephaestus registers #then no config is registered", () => {
		// given
		const model = "anthropic/claude-sonnet-4-6";
		const agentOverrides: AgentOverrides = {
			hephaestus: {
				model,
				variant: EXPLICIT_VARIANT,
			},
		};
		const mergedCategories: Record<string, CategoryConfig> = {};

		// when
		const config = maybeCreateHephaestusConfig({
			disabledAgents: [],
			agentOverrides,
			availableModels: new Set([model]),
			systemDefaultModel: model,
			isFirstRunNoCache: false,
			availableAgents: [],
			availableSkills: [],
			availableCategories: [],
			mergedCategories,
			useTaskSystem: false,
		});

		// then
		expect(config).toBeUndefined();
	});
});
