/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { createAtlasAgent } from "./atlas/agent"
import { createMetisAgent } from "./metis"
import { createMomusAgent } from "./momus"
import { createOracleAgent } from "./oracle"
import { createSisyphusAgent } from "./sisyphus"
import { buildGlmLanguageConstraint } from "./sisyphus/glm"
import { buildGlmSisyphusJuniorPrompt } from "./sisyphus-junior/glm"
import { getGlmPrometheusPrompt } from "./prometheus/glm"
import { getGlmAtlasPrompt } from "./atlas/glm"
import type {
	AvailableAgent,
	AvailableCategory,
	AvailableSkill,
} from "./dynamic-agent-prompt-builder"

const GLM_TEXT_MODEL = "zai-coding-plan/glm-5"
const GLM_VLM_MODEL = "zai-coding-plan/glm-5v-turbo"
const NON_GLM_MODEL = "claude-opus-4-7"

const SISYPHUS_AGENTS: AvailableAgent[] = [
	{
		name: "oracle",
		description: "Architecture consultant",
		metadata: {
			category: "advisor",
			cost: "EXPENSIVE",
			promptAlias: "Oracle",
			triggers: [],
		},
	},
]

const SISYPHUS_TOOLS = ["task"]
const SISYPHUS_SKILLS: AvailableSkill[] = []
const SISYPHUS_CATEGORIES: AvailableCategory[] = []

function createSisyphusForTest(model: string): AgentConfig {
	return createSisyphusAgent(
		model,
		SISYPHUS_AGENTS,
		SISYPHUS_TOOLS,
		SISYPHUS_SKILLS,
		SISYPHUS_CATEGORIES,
	)
}

function prompt(agent: AgentConfig): string {
	return String(agent.prompt ?? "")
}

const LANG_CONSTRAINT_TAG = "GLM_LANGUAGE_CONSTRAINT"
const REGENERATE_KEYWORD = "regenerate"

describe("GLM language constraint", () => {
	describe("#given buildGlmLanguageConstraint builder", () => {
		describe("#when called", () => {
			it("#then returns GLM_LANGUAGE_CONSTRAINT tag", () => {
				const constraint = buildGlmLanguageConstraint()
				expect(constraint).toContain(LANG_CONSTRAINT_TAG)
			})

			it("#then contains regenerate instruction", () => {
				const constraint = buildGlmLanguageConstraint()
				expect(constraint).toContain(REGENERATE_KEYWORD)
			})

			it("#then mentions code exemption", () => {
				const constraint = buildGlmLanguageConstraint()
				expect(constraint.toLowerCase()).toContain("code")
				expect(constraint.toLowerCase()).toContain("exempt")
			})
		})
	})

	describe("#given GLM agent factories", () => {
		describe("#when each factory receives a GLM text model", () => {
			const promptFactories = [
				{ name: "Sisyphus", create: createSisyphusForTest },
				{ name: "Metis", create: createMetisAgent },
				{ name: "Momus", create: createMomusAgent },
				{ name: "Oracle", create: createOracleAgent },
				{ name: "Atlas", create: (model: string) => createAtlasAgent({ model }) },
			]

			it("#then every returned config prompt contains GLM_LANGUAGE_CONSTRAINT", () => {
				for (const factory of promptFactories) {
					const agent = factory.create(GLM_TEXT_MODEL)
					expect(prompt(agent), factory.name).toContain(LANG_CONSTRAINT_TAG)
				}
			})
		})

		describe("#when each factory receives a non-GLM model", () => {
			const promptFactories = [
				{ name: "Sisyphus", create: createSisyphusForTest },
				{ name: "Metis", create: createMetisAgent },
				{ name: "Momus", create: createMomusAgent },
				{ name: "Oracle", create: createOracleAgent },
				{ name: "Atlas", create: (model: string) => createAtlasAgent({ model }) },
			]

			it("#then no returned config prompt contains GLM_LANGUAGE_CONSTRAINT", () => {
				for (const factory of promptFactories) {
					const agent = factory.create(NON_GLM_MODEL)
					expect(prompt(agent), factory.name).not.toContain(LANG_CONSTRAINT_TAG)
				}
			})
		})
	})

	describe("#given GLM standalone prompt builders", () => {
		describe("#when called", () => {
			it("#then sisyphus-junior GLM prompt contains GLM_LANGUAGE_CONSTRAINT", () => {
				const prompt = buildGlmSisyphusJuniorPrompt(GLM_TEXT_MODEL, false)
				expect(prompt).toContain(LANG_CONSTRAINT_TAG)
			})

			it("#then prometheus GLM prompt contains GLM_LANGUAGE_CONSTRAINT", () => {
				const prompt = getGlmPrometheusPrompt()
				expect(prompt).toContain(LANG_CONSTRAINT_TAG)
			})

			it("#then atlas GLM prompt contains GLM_LANGUAGE_CONSTRAINT", () => {
				const prompt = getGlmAtlasPrompt()
				expect(prompt).toContain(LANG_CONSTRAINT_TAG)
			})
		})
	})

	describe("#given GLM VLM model", () => {
		describe("#when factory receives a GLM VLM model", () => {
			it("#then sisyphus prompt still contains GLM_LANGUAGE_CONSTRAINT (language applies to all GLM)", () => {
				const agent = createSisyphusForTest(GLM_VLM_MODEL)
				expect(prompt(agent)).toContain(LANG_CONSTRAINT_TAG)
			})

			it("#then sisyphus-junior prompt still contains GLM_LANGUAGE_CONSTRAINT", () => {
				const prompt = buildGlmSisyphusJuniorPrompt(GLM_VLM_MODEL, false)
				expect(prompt).toContain(LANG_CONSTRAINT_TAG)
			})
		})
	})
})
