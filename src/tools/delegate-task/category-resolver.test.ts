declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

describe("resolveCategoryExecution", () => {
	let connectedProvidersSpy: ReturnType<typeof spyOn> | undefined
	let providerModelsSpy: ReturnType<typeof spyOn> | undefined

	beforeEach(() => {
		mock.restore()
		connectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
		providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
	})

	afterEach(() => {
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
		const inheritedModel = undefined
		const systemDefaultModel = "anthropic/claude-sonnet-4-6"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

		//#then
		expect(result.error).toBeDefined()
		expect(result.error).toContain("deep")
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
		const systemDefaultModel = "anthropic/claude-sonnet-4-6"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

		//#then
		expect(result.error).toBeDefined()
		expect(result.error).toContain("Unknown category")
		expect(result.error).toContain("definitely-not-a-real-category-xyz123")
	})

	describe("#given isUnstableAgent detection", () => {
		test("visual-engineering with user override to stable model sets isUnstableAgent=false", async () => {
			//#given - user overrides visual-engineering model to a stable (non-gemini) model
			const args = {
				category: "visual-engineering",
				prompt: "test prompt",
				description: "Test task",
				run_in_background: false,
				load_skills: [],
				blockedBy: undefined,
				enableSkillTools: false,
			}
			const executorCtx = createMockExecutorContext()
			executorCtx.userCategories = {
				"visual-engineering": { model: "anthropic/claude-sonnet-4-6" },
			}
			const inheritedModel = undefined
			const systemDefaultModel = "anthropic/claude-sonnet-4-6"

			//#when
			const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

			//#then - actualModel is the stable override, isUnstableAgent must be false
			expect(result.error).toBeUndefined()
			expect(result.actualModel).toBe("anthropic/claude-sonnet-4-6")
			expect(result.isUnstableAgent).toBe(false)
		})

		test("visual-engineering with default gemini model sets isUnstableAgent=true", async () => {
			//#given - no user override, default gemini model resolves
			const args = {
				category: "visual-engineering",
				prompt: "test prompt",
				description: "Test task",
				run_in_background: false,
				load_skills: [],
				blockedBy: undefined,
				enableSkillTools: false,
			}
			const executorCtx = createMockExecutorContext()
			const inheritedModel = undefined
			const systemDefaultModel = undefined

			//#when
			const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

			//#then - default model contains "gemini", so isUnstableAgent should be true
			expect(result.error).toBeUndefined()
			expect(result.actualModel).toContain("gemini")
			expect(result.isUnstableAgent).toBe(true)
		})

		test("writing with user override to stable model sets isUnstableAgent=false", async () => {
			//#given - user overrides writing model to a stable (non-kimi) model
			const args = {
				category: "writing",
				prompt: "test prompt",
				description: "Test task",
				run_in_background: false,
				load_skills: [],
				blockedBy: undefined,
				enableSkillTools: false,
			}
			const executorCtx = createMockExecutorContext()
			executorCtx.userCategories = {
				writing: { model: "anthropic/claude-sonnet-4-6" },
			}
			const inheritedModel = undefined
			const systemDefaultModel = "anthropic/claude-sonnet-4-6"

			//#when
			const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

			//#then - actualModel is the stable override, isUnstableAgent must be false
			expect(result.error).toBeUndefined()
			expect(result.actualModel).toBe("anthropic/claude-sonnet-4-6")
			expect(result.isUnstableAgent).toBe(false)
		})

		test("writing with default kimi model sets isUnstableAgent=true", async () => {
			//#given - no user override, default kimi model resolves
			const args = {
				category: "writing",
				prompt: "test prompt",
				description: "Test task",
				run_in_background: false,
				load_skills: [],
				blockedBy: undefined,
				enableSkillTools: false,
			}
			const executorCtx = createMockExecutorContext()
			const inheritedModel = undefined
			const systemDefaultModel = undefined

			//#when
			const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

			//#then - default model contains "kimi", so isUnstableAgent should be true
			expect(result.error).toBeUndefined()
			expect(result.actualModel).toContain("kimi")
			expect(result.isUnstableAgent).toBe(true)
		})

		test("is_unstable_agent=true in config forces isUnstableAgent=true regardless of model", async () => {
			//#given - user sets is_unstable_agent=true with a stable model
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
				quick: { model: "anthropic/claude-sonnet-4-6", is_unstable_agent: true },
			}
			const inheritedModel = undefined
			const systemDefaultModel = "anthropic/claude-sonnet-4-6"

			//#when
			const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

			//#then - is_unstable_agent=true overrides model-based detection
			expect(result.error).toBeUndefined()
			expect(result.isUnstableAgent).toBe(true)
		})

		test("sisyphusJuniorModel override to stable model sets isUnstableAgent=false for visual-engineering", async () => {
			//#given - global sisyphus-junior model overrides to stable model
			const args = {
				category: "visual-engineering",
				prompt: "test prompt",
				description: "Test task",
				run_in_background: false,
				load_skills: [],
				blockedBy: undefined,
				enableSkillTools: false,
			}
			const executorCtx = createMockExecutorContext()
			executorCtx.sisyphusJuniorModel = "anthropic/claude-sonnet-4-6"
			const inheritedModel = undefined
			const systemDefaultModel = "anthropic/claude-sonnet-4-6"

			//#when
			const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

			//#then - actualModel is the stable override via sisyphusJuniorModel
			expect(result.error).toBeUndefined()
			expect(result.actualModel).toBe("anthropic/claude-sonnet-4-6")
			expect(result.isUnstableAgent).toBe(false)
		})
	})
})
