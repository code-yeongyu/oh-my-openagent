import { describe, test, expect } from "bun:test"
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"

describe("resolveCategoryExecution", () => {
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
		const systemDefaultModel = "anthropic/claude-sonnet-4-5"

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
		const systemDefaultModel = "anthropic/claude-sonnet-4-5"

		//#when
		const result = await resolveCategoryExecution(args, executorCtx, inheritedModel, systemDefaultModel)

		//#then
		expect(result.error).toBeDefined()
		expect(result.error).toContain("Unknown category")
		expect(result.error).toContain("definitely-not-a-real-category-xyz123")
	})
})
