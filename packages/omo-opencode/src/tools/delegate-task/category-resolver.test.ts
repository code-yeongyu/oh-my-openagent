import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS , SUPPORTED_REASONING_EFFORTS } from "@oh-my-opencode/model-core";
declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import { resolveCategoryExecution } from "./category-resolver"
import { applyCategoryParams } from "./delegated-model-config"
import type { DelegatedModelConfig } from "./types"
import type { CategoryConfig } from "../../config/schema"
import type { ExecutorContext } from "./executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

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
			prompt: "test prompt",
			description: "Test task",
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
			prompt: "test prompt",
			description: "Test task",
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
			prompt: "test prompt",
			description: "Test task",
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
			{ providers: ["quotio"], model: SUPPORTED_MODELS.KIMI_K2_5, variant: undefined },
			{ providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_5, variant: SUPPORTED_VARIANTS.HIGH },
		])
	})

	test("promotes object-style fallback model settings to categoryModel when fallback becomes initial model", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: [SUPPORTED_MODELS.GPT_5_4] },
			connected: [SUPPORTED_PROVIDERS.OPENAI],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])
		const args = {
			category: "quick",
			prompt: "test prompt",
			description: "Test task",
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
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
						temperature: 0.4,
						topP: 0.7,
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
			providerID: SUPPORTED_PROVIDERS.OPENAI,
			modelID: SUPPORTED_MODELS.GPT_5_4,
			variant: "low",
			reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
			temperature: 0.4,
			topP: 0.7,
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
			prompt: "test prompt",
			description: "Test task",
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
			providerID: SUPPORTED_PROVIDERS.OPENAI,
			modelID: SUPPORTED_MODELS.GPT_5_4,
			variant: SUPPORTED_VARIANTS.HIGH,
		})
	})

	test("does not apply object-style fallback settings when the configured primary model matches directly", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-5.4-preview"] },
			connected: [SUPPORTED_PROVIDERS.OPENAI],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])
		const args = {
			category: "quick",
			prompt: "test prompt",
			description: "Test task",
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
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
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
			providerID: SUPPORTED_PROVIDERS.OPENAI,
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
			connected: [SUPPORTED_PROVIDERS.OPENAI],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])
		const args = {
			category: "quick",
			prompt: "test prompt",
			description: "Test task",
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
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
						temperature: 0.6,
						topP: 0.5,
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
			providerID: SUPPORTED_PROVIDERS.OPENAI,
			modelID: "gpt-5.4-preview",
			variant: "low",
			reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
			temperature: 0.6,
			topP: 0.5,
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
			connected: [SUPPORTED_PROVIDERS.OPENAI],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])
		const args = {
			category: "quick",
			prompt: "test prompt",
			description: "Test task",
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
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.MEDIUM,
					},
					{
						model: "openai/gpt-5.4-preview",
						variant: SUPPORTED_VARIANTS.MAX,
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
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
			providerID: SUPPORTED_PROVIDERS.OPENAI,
			modelID: "gpt-5.4-preview",
			variant: SUPPORTED_VARIANTS.MAX,
			reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("matches promoted fallback settings when fuzzy resolution extends configured model without hyphen", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: ["gpt-5.4o"] },
			connected: [SUPPORTED_PROVIDERS.OPENAI],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])
		const args = {
			category: "quick",
			prompt: "test prompt",
			description: "Test task",
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
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
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
			providerID: SUPPORTED_PROVIDERS.OPENAI,
			modelID: "gpt-5.4o",
			variant: "low",
			reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("prefers the most specific prefix match when fallback entries share a prefix", async () => {
		//#given
		const cacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
			models: { openai: [SUPPORTED_MODELS.GPT_4O] },
			connected: [SUPPORTED_PROVIDERS.OPENAI],
			updatedAt: "2026-03-03T00:00:00.000Z",
		})
		const agentsSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI])
		const args = {
			category: "deep",
			prompt: "test prompt",
			description: "Test task",
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
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.MEDIUM,
					},
					{
						model: "openai/gpt-4o",
						variant: SUPPORTED_VARIANTS.MAX,
						reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
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
			providerID: SUPPORTED_PROVIDERS.OPENAI,
			modelID: SUPPORTED_MODELS.GPT_4O,
			variant: SUPPORTED_VARIANTS.MAX,
			reasoningEffort: SUPPORTED_REASONING_EFFORTS.HIGH,
		})
		cacheSpy.mockRestore()
		agentsSpy.mockRestore()
	})

	test("does not inherit hardcoded fallbackChain when user configures a category model [regression #3040]", async () => {
		//#given
		const args = {
			category: "quick",
			prompt: "test prompt",
			description: "Test task",
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
			prompt: "test prompt",
			description: "Test task",
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
			providerID: SUPPORTED_PROVIDERS.ANTHROPIC,
			modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
			variant: undefined,
		})
		expect(result.fallbackChain).toBeUndefined()
	})

	test("uses GPT-5.5 deep prompt append when category model resolves to gpt-5.5", async () => {
		//#given
		const args = {
			category: "deep",
			prompt: "test prompt",
			description: "Test task",
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: { model: "openai/gpt-5.5", variant: SUPPORTED_VARIANTS.MEDIUM },
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.5")
		expect(result.categoryPromptAppend).toBeDefined()
		expect(result.categoryPromptAppend).toContain("operating in DEEP mode")
		expect(result.categoryPromptAppend).toContain("five to fifteen minutes")
	})

	test("uses legacy deep prompt append when category model resolves to gpt-5.4", async () => {
		//#given
		const args = {
			category: "deep",
			prompt: "test prompt",
			description: "Test task",
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

		//#then
		expect(result.error).toBeUndefined()
		expect(result.actualModel).toBe("openai/gpt-5.4")
		expect(result.categoryPromptAppend).toBeDefined()
		expect(result.categoryPromptAppend).toContain("GOAL-ORIENTED AUTONOMOUS")
		expect(result.categoryPromptAppend).not.toContain("operating in DEEP mode")
	})

	test("appends user prompt_append to GPT-5.5 deep base prompt", async () => {
		//#given
		const args = {
			category: "deep",
			prompt: "test prompt",
			description: "Test task",
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: {
				model: "openai/gpt-5.5",
				prompt_append: "USER_CUSTOM_INSTRUCTION_XYZ",
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.categoryPromptAppend).toContain("operating in DEEP mode")
		expect(result.categoryPromptAppend).toContain("USER_CUSTOM_INSTRUCTION_XYZ")
	})

	test("appends user prompt_append to legacy deep base prompt for non-gpt-5.5 models", async () => {
		//#given
		const args = {
			category: "deep",
			prompt: "test prompt",
			description: "Test task",
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}
		const executorCtx = createMockExecutorContext()
		executorCtx.userCategories = {
			deep: {
				model: "openai/gpt-5.4",
				prompt_append: "USER_CUSTOM_INSTRUCTION_LEGACY",
			},
		}

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toBeUndefined()
		expect(result.categoryPromptAppend).toContain("GOAL-ORIENTED AUTONOMOUS")
		expect(result.categoryPromptAppend).toContain("USER_CUSTOM_INSTRUCTION_LEGACY")
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
