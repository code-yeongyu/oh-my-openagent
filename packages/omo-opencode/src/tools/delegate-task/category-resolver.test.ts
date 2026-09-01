declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import { resolveCategoryExecution } from "./category-resolver"
import { applyCategoryParams } from "./delegated-model-config"
import type { DelegatedModelConfig } from "./types"
import type { CategoryConfig } from "../../config/schema"
import type { ExecutorContext } from "./executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
	DEEP_CATEGORY_PROMPT_APPEND,
	DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5,
} from "./openai-categories"

const PROMPT_INPUT_SENTINEL = "PROMPT_INPUT_SENTINEL"
const DESCRIPTION_INPUT_SENTINEL = "DESCRIPTION_INPUT_SENTINEL"

describe("resolveCategoryExecution", () => {
	let connectedProvidersSpy: ReturnType<typeof spyOn> | undefined
	let providerModelsSpy: ReturnType<typeof spyOn> | undefined
	let hasConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined
	let hasProviderModelsSpy: ReturnType<typeof spyOn> | undefined

	beforeEach(() => {
		mock.restore()
		connectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
		providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
		hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(false)
		hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
	})

	afterEach(() => {
		connectedProvidersSpy?.mockRestore()
		providerModelsSpy?.mockRestore()
		hasConnectedProvidersSpy?.mockRestore()
		hasProviderModelsSpy?.mockRestore()
	})

	const createMockExecutorContext = (): ExecutorContext => ({
		client: unsafeTestValue({}),
		manager: unsafeTestValue({}),
		directory: "/tmp/test",
		userCategories: {},
		sisyphusJuniorModel: undefined,
	})

	test("returns unpinned resolution when category cache is not ready on first run", async () => {
		//#given
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: {},
		}
		const inheritedModel = undefined
		const systemDefaultModel = "anthropic/claude-sonnet-4-6"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBeUndefined()
		expect(result.categoryModel).toBeUndefined()
		expect(result.agentToUse).toBeDefined()
	})

	test("returns 'unknown category' error for truly unknown categories", async () => {
		//#given
		const args = {
			category: "definitely-not-a-real-category-xyz123",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		const inheritedModel = undefined
		const systemDefaultModel = "anthropic/claude-sonnet-4-6"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

		//#then
		expect(result.error).toBeDefined()
		expect(result.error).toContain("Unknown category")
		expect(result.error).toContain("definitely-not-a-real-category-xyz123")
	})

	test("uses category fallback_models for background/runtime fallback chain", async () => {
		//#given
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: {
				model: "quotio/claude-opus-4-7",
				fallback_models: ["quotio/kimi-k2.5", "openai/gpt-5.5(high)"],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.fallbackChain).toEqual([
			{ providers: ["quotio"], model: "kimi-k2.5", variant: undefined },
			{ providers: ["openai"], model: "gpt-5.5", variant: "high" },
		])
	})

	test("prefers the canonical models chain over legacy model fields and carries entry reasoning", async () => {
		//#given
		const args = {
			category: "canonical-chain",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			"canonical-chain": {
				model: "legacy/primary",
				fallback_models: ["legacy/fallback"],
				reasoning: "medium",
				reasoningEffort: "low",
				models: [
					{ model: "openai/gpt-5.4", reasoning: "high", reasoningEffort: "minimal" },
					{ model: "test-provider/plain-model", reasoning: "low" },
				],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.4")
		expect(result.categoryModel?.reasoning).toBe("high")
		expect(result.fallbackChain).toEqual([
			{
				providers: ["test-provider"],
				model: "plain-model",
				variant: undefined,
				reasoning: "low",
				reasoningEffort: undefined,
				temperature: undefined,
				top_p: undefined,
				maxTokens: undefined,
				thinking: undefined,
			},
		])
	})

	test("promotes object-style fallback model settings to categoryModel when fallback becomes initial model", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-5.4"] },
			connected: ["openai"],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			quick: {
				fallback_models: [
					{
						model: "openai/gpt-5.4 high",
						variant: "low",
						reasoningEffort: "high",
						temperature: 0.4,
						top_p: 0.7,
						maxTokens: 4096,
						thinking: { type: "disabled" },
					},
				],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.4")
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-5.4",
			variant: "low",
			reasoningEffort: "high",
			temperature: 0.4,
			top_p: 0.7,
			maxTokens: 4096,
			thinking: { type: "disabled" },
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("preserves inline variant from category model string when no explicit variant is configured", async () => {
		//#given
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			quick: {
				model: "openai/gpt-5.4 high",
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBeDefined()
		expect(result.categoryModel).toBeDefined()
		if (!result.actualModel || !result.categoryModel) {
			throw new Error("Expected resolved model and category model")
		}
		expect(result.actualModel).toBe("openai/gpt-5.4")
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-5.4",
			variant: "high",
		})
	})

	test("does not apply object-style fallback settings when the configured primary model matches directly", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-5.4-preview"] },
			connected: ["openai"],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			quick: {
				model: "openai/gpt-5.4-preview",
				fallback_models: [
					{
						model: "openai/gpt-5.4",
						variant: "low",
						reasoningEffort: "high",
					},
				],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.4-preview")
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-5.4-preview",
			variant: undefined,
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("matches promoted fallback settings after fuzzy model resolution", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-5.4-preview"] },
			connected: ["openai"],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			quick: {
				fallback_models: [
					{
						model: "openai/gpt-5.4",
						variant: "low",
						reasoningEffort: "high",
						temperature: 0.6,
						top_p: 0.5,
						maxTokens: 1234,
						thinking: { type: "disabled" },
					},
				],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.4-preview")
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-5.4-preview",
			variant: "low",
			reasoningEffort: "high",
			temperature: 0.6,
			top_p: 0.5,
			maxTokens: 1234,
			thinking: { type: "disabled" },
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("prefers exact promoted fallback match over earlier fuzzy prefix match", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-5.4-preview"] },
			connected: ["openai"],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			quick: {
				fallback_models: [
					{
						model: "openai/gpt-5.4",
						variant: "low",
						reasoningEffort: "medium",
					},
					{
						model: "openai/gpt-5.4-preview",
						variant: "max",
						reasoningEffort: "high",
					},
				],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.4-preview")
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-5.4-preview",
			variant: "max",
			reasoningEffort: "high",
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("matches promoted fallback settings when fuzzy resolution extends configured model without hyphen", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-5.4o"] },
			connected: ["openai"],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			quick: {
				fallback_models: [
					{
						model: "openai/gpt-5.4",
						variant: "low",
						reasoningEffort: "high",
					},
				],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.4o")
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-5.4o",
			variant: "low",
			reasoningEffort: "high",
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("prefers the most specific prefix match when fallback entries share a prefix", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-4o"] },
			connected: ["openai"],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: {
				fallback_models: [
					{
						model: "openai/gpt-4",
						variant: "low",
						reasoningEffort: "medium",
					},
					{
						model: "openai/gpt-4o",
						variant: "max",
						reasoningEffort: "high",
					},
				],
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-4o")
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-4o",
			variant: "max",
			reasoningEffort: "high",
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("does not inherit hardcoded fallbackChain when user configures a category model [regression #3040]", async () => {
		//#given
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			quick: {
				model: "animal-gateway-xai/grok-4-fast-non-reasoning",
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("animal-gateway-xai/grok-4-fast-non-reasoning")
		expect(result.categoryModel).toEqual({
			providerID: "animal-gateway-xai",
			modelID: "grok-4-fast-non-reasoning",
			variant: undefined,
		})
		expect(result.fallbackChain).toBeUndefined()
	})

	test("does not inherit hardcoded fallbackChain when sisyphus-junior model override is set [regression #2941]", async () => {
		//#given
		const args = {
			category: "quick",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.sisyphusJuniorModel = "anthropic/claude-sonnet-4-6"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("anthropic/claude-sonnet-4-6")
		expect(result.categoryModel).toEqual({
			providerID: "anthropic",
			modelID: "claude-sonnet-4-6",
			variant: undefined,
		})
		expect(result.fallbackChain).toBeUndefined()
	})

	test("routes gpt-5.5 family models to the gpt-5.5 deep append", async () => {
		//#given - the shipped family appends anchor the routing decision;
		//#given the resolver under test must not be reused as its own oracle
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: { model: "openai/gpt-5.5" },
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then - the 5.5 family append is selected, not the legacy one
		expect(result.error).toBeUndefined()
		expect(result.categoryPromptAppend).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
		expect(result.categoryPromptAppend).not.toBe(DEEP_CATEGORY_PROMPT_APPEND)
	})

	test("routes gpt-5.6 family models to the same gpt-5.5 deep append", async () => {
		//#given - 5.6 belongs to the same routed family as 5.5
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: { model: "openai/gpt-5.6-sol" },
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then - family routing collapses 5.6 onto the 5.5 append
		expect(result.error).toBeUndefined()
		expect(result.categoryPromptAppend).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
	})

	test("routes non-family models to the legacy deep append", async () => {
		//#given
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: { model: "openai/gpt-5.4" },
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then - the legacy append is selected, not the 5.5 family one
		expect(result.error).toBeUndefined()
		expect(result.categoryPromptAppend).toBe(DEEP_CATEGORY_PROMPT_APPEND)
		expect(result.categoryPromptAppend).not.toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
	})

	test("appends user prompt_append after the gpt-5.5 family deep append", async () => {
		//#given
		const userPromptAppend = "USER_PROMPT_APPEND_SENTINEL"
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: {
				model: "openai/gpt-5.5",
				prompt_append: userPromptAppend,
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then - the shipped family append carries the dynamic user payload
		expect(result.error).toBeUndefined()
		expect(result.categoryPromptAppend).toBe(
			`${DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5}\n\n${userPromptAppend}`,
		)
	})

	test("appends user prompt_append after the legacy deep append", async () => {
		//#given
		const userPromptAppend = "USER_PROMPT_APPEND_SENTINEL"
		const args = {
			category: "deep",
			prompt: PROMPT_INPUT_SENTINEL,
			description: DESCRIPTION_INPUT_SENTINEL,
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: {
				model: "openai/gpt-5.4",
				prompt_append: userPromptAppend,
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then - the legacy family append carries the dynamic user payload
		expect(result.error).toBeUndefined()
		expect(result.categoryPromptAppend).toBe(
			`${DEEP_CATEGORY_PROMPT_APPEND}\n\n${userPromptAppend}`,
		)
	})

	test("applyCategoryParams propagates category tools config (issue #5182)", () => {
		//#given a category with tools restriction
		const base: DelegatedModelConfig = {
			providerID: "anthropic",
			modelID: "claude-sonnet-4-6",
		}
		const config: CategoryConfig = {
			tools: { grep: false, read: true },
		}

		//#when applyCategoryParams runs with a tools-restricted category config
		const result = applyCategoryParams(base, config)

		//#then tools from the category config should appear in the result
		// THIS TEST MUST FAIL (RED) - proves bug #5182 that applyCategoryParams drops config.tools
		expect((result as unknown as { tools?: Record<string, boolean> }).tools).toEqual({ grep: false, read: true })
	})
})
