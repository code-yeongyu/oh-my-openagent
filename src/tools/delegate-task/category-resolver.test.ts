declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock, vi } = require("bun:test")
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import type { CategoriesConfig } from "../../config/schema"
import type { FallbackEntry } from "../../shared/model-requirements"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { resetPoolState } from "./model-pool-state"

vi.mock("./available-models", () => ({
	getAvailableModelsForDelegateTask: vi.fn(),
}))

vi.mock("./categories", () => ({
	resolveCategoryConfig: vi.fn(),
}))

vi.mock("./model-selection", () => ({
	resolveModelForDelegateTask: vi.fn(),
}))

vi.mock("../../shared/merge-categories", () => ({
	mergeCategories: vi.fn(),
}))

vi.mock("../../shared/model-requirements", () => ({
	CATEGORY_MODEL_REQUIREMENTS: {
		quick: {
			requiresModel: "haiku-4-5",
			fallbackChain: [{ model: "sonnet-4-5", providers: ["anthropic"] }],
		},
	},
}))

import { getAvailableModelsForDelegateTask } from "./available-models"
import { resolveCategoryConfig } from "./categories"
import { resolveModelForDelegateTask } from "./model-selection"
import { mergeCategories } from "../../shared/merge-categories"

const mockGetAvailableModels = getAvailableModelsForDelegateTask as ReturnType<typeof vi.fn>
const mockResolveCategoryConfig = resolveCategoryConfig as ReturnType<typeof vi.fn>
const mockResolveModelForDelegateTask = resolveModelForDelegateTask as ReturnType<typeof vi.fn>
const mockMergeCategories = mergeCategories as ReturnType<typeof vi.fn>

describe("resolveCategoryExecution", () => {
	let connectedProvidersSpy: ReturnType<typeof spyOn> | undefined
	let providerModelsSpy: ReturnType<typeof spyOn> | undefined

	beforeEach(() => {
		mock.restore()
		resetPoolState()
		vi.clearAllMocks()
		mockMergeCategories.mockReturnValue({})
		connectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
		providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
	})

	afterEach(() => {
		resetPoolState()
		vi.restoreAllMocks()
		connectedProvidersSpy?.mockRestore()
		providerModelsSpy?.mockRestore()
	})

	const createMockExecutorContext = (): ExecutorContext => ({
		client: {} as any,
		manager: {} as any,
		directory: "/tmp/test",
		userCategories: {},
		sisyphusJuniorModel: undefined,
	})

	test("returns clear error when category exists but required model is not available", async () => {
		//#given
		mockMergeCategories.mockReturnValue({ quick: { model: "haiku-4-5" } })
		mockResolveCategoryConfig.mockReturnValue(null)
		mockGetAvailableModels.mockResolvedValue(new Set())
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
		const inheritedModel = undefined
		const systemDefaultModel = "anthropic/claude-sonnet-4-5"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

		//#then
		expect(result.error).toBeDefined()
		expect(result.error).toContain("quick")
		expect(result.error).toMatch(/model.*not.*available|requires.*model/i)
		expect(result.error).not.toContain("Unknown category")
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
		const systemDefaultModel = "anthropic/claude-sonnet-4-5"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

		//#then
		expect(result.error).toBeDefined()
		expect(result.error).toContain("Unknown category")
		expect(result.error).toContain("definitely-not-a-real-category-xyz123")
	})
})

describe("resolveCategoryExecution (model pool)", () => {
	beforeEach(() => {
		resetPoolState()
		vi.clearAllMocks()
		mockMergeCategories.mockReturnValue({ quick: { model: ["haiku-4-5", "sonnet-4-5"] } })
	})

	afterEach(() => {
		resetPoolState()
		vi.restoreAllMocks()
	})

	function createPoolMockExecutorCtx(overrides?: { userCategories?: CategoriesConfig }): ExecutorContext {
		return {
			client: {} as any,
			manager: {} as any,
			directory: "/tmp/test",
			userCategories: overrides?.userCategories ?? {},
			sisyphusJuniorModel: undefined,
		} as ExecutorContext
	}

	test("pool=[A,B], A available → returns A", async () => {
		//#given
		const args = { category: "quick", description: "test", prompt: "test", run_in_background: false, load_skills: [] }
		const executorCtx = createPoolMockExecutorCtx()
		const pool = ["anthropic/haiku-4-5", "anthropic/sonnet-4-5"]

		mockGetAvailableModels.mockResolvedValue(new Set(["anthropic/haiku-4-5", "anthropic/sonnet-4-5"]))
		mockResolveCategoryConfig.mockReturnValue({
			model: pool,
			config: { model: pool },
			promptAppend: undefined,
		})
		mockResolveModelForDelegateTask.mockReturnValue({ model: "anthropic/haiku-4-5" })

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

		//#then
		expect(result.actualModel).toBe("anthropic/haiku-4-5")
		expect(result.error).toBeUndefined()
		expect(mockResolveModelForDelegateTask).toHaveBeenCalledWith(
			expect.objectContaining({ categoryDefaultModel: pool })
		)
	})

	test("pool=[A,B], A unavailable, B available → returns B", async () => {
		//#given
		const args = { category: "quick", description: "test", prompt: "test", run_in_background: false, load_skills: [] }
		const executorCtx = createPoolMockExecutorCtx()
		const pool = ["anthropic/haiku-4-5", "anthropic/sonnet-4-5"]

		mockGetAvailableModels.mockResolvedValue(new Set(["anthropic/sonnet-4-5"]))
		mockResolveCategoryConfig.mockReturnValue({
			model: pool,
			config: { model: pool },
			promptAppend: undefined,
		})
		mockResolveModelForDelegateTask.mockReturnValue({ model: "anthropic/sonnet-4-5" })

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

		//#then
		expect(result.actualModel).toBe("anthropic/sonnet-4-5")
		expect(result.error).toBeUndefined()
	})

	test("pool=[A,B], all unavailable → falls back to fallbackChain", async () => {
		//#given
		const args = { category: "quick", description: "test", prompt: "test", run_in_background: false, load_skills: [] }
		const executorCtx = createPoolMockExecutorCtx()
		const pool = ["anthropic/haiku-4-5", "anthropic/sonnet-4-5"]

		mockGetAvailableModels.mockResolvedValue(new Set(["anthropic/opus-4-6"]))
		mockResolveCategoryConfig.mockReturnValue({
			model: pool,
			config: { model: pool },
			promptAppend: undefined,
		})
		mockResolveModelForDelegateTask.mockReturnValue({ model: "anthropic/opus-4-6" })

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

		//#then
		expect(result.actualModel).toBe("anthropic/opus-4-6")
		expect(result.error).toBeUndefined()
	})

	test("category model='single' (string) → backward compatible behavior", async () => {
		//#given
		const args = { category: "quick", description: "test", prompt: "test", run_in_background: false, load_skills: [] }
		const executorCtx = createPoolMockExecutorCtx()

		mockGetAvailableModels.mockResolvedValue(new Set(["anthropic/haiku-4-5"]))
		mockResolveCategoryConfig.mockReturnValue({
			model: "anthropic/haiku-4-5",
			config: { model: "anthropic/haiku-4-5" },
			promptAppend: undefined,
		})
		mockResolveModelForDelegateTask.mockReturnValue({ model: "anthropic/haiku-4-5" })

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

		//#then
		expect(result.actualModel).toBe("anthropic/haiku-4-5")
		expect(result.error).toBeUndefined()
		expect(mockResolveModelForDelegateTask).toHaveBeenCalledWith(
			expect.objectContaining({ categoryDefaultModel: "anthropic/haiku-4-5" })
		)
	})

	test("userModel override → pool ignored, userModel used", async () => {
		//#given
		const args = { category: "quick", description: "test", prompt: "test", run_in_background: false, load_skills: [] }
		const userCategories: CategoriesConfig = { quick: { model: "anthropic/opus-4-6" } }
		const executorCtx = createPoolMockExecutorCtx({ userCategories })
		const pool = ["anthropic/haiku-4-5", "anthropic/sonnet-4-5"]

		mockGetAvailableModels.mockResolvedValue(new Set(["anthropic/opus-4-6"]))
		mockResolveCategoryConfig.mockReturnValue({
			model: pool,
			config: { model: pool },
			promptAppend: undefined,
		})
		mockResolveModelForDelegateTask.mockReturnValue({ model: "anthropic/opus-4-6" })

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

		//#then
		expect(result.actualModel).toBe("anthropic/opus-4-6")
		expect(result.error).toBeUndefined()
		expect(mockResolveModelForDelegateTask).toHaveBeenCalledWith(
			expect.objectContaining({ userModel: "anthropic/opus-4-6" })
		)
	})
})
