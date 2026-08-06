/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { CategoryConfig } from "../../config/schema";
import { maybeCreateHephaestusConfig } from "../builtin-agents/hephaestus-agent";
import type { AgentOverrides } from "../types";
import { getHephaestusPrompt, getHephaestusPromptSource } from "./index";

const EXPLICIT_VARIANT = "xhigh";
const SYSTEM_DEFAULT_MODEL = "openai/gpt-5.5";
const SUPPORTED_MODEL_IDS = [
	"openai/gpt-5.6",
	"openai/gpt-5.6-sol",
	"openai/gpt-5.6-terra-fast",
	"openai/gpt-5.6-luna-pro",
	"vercel/openai/gpt-5.6-sol",
	"cx/gpt-5.6-sol",
] as const;

describe("maybeCreateHephaestusConfig GPT-5.6 registration", () => {
	for (const model of SUPPORTED_MODEL_IDS) {
		test(`#given ${model} overrides a different system default #when Hephaestus registers #then the override, variant, and GPT-5.6 prompt are preserved`, () => {
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
				availableModels: new Set([model, SYSTEM_DEFAULT_MODEL]),
				systemDefaultModel: SYSTEM_DEFAULT_MODEL,
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
			expect(getHephaestusPromptSource(config?.model)).toBe("gpt-5-6");
			expect(config?.prompt).toBe(getHephaestusPrompt(model));
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
