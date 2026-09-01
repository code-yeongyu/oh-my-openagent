declare const require: (name: string) => any
const { afterEach, beforeEach, describe, expect, mock, spyOn, test } = require("bun:test")
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import * as availableModels from "./available-models"

describe("resolveCategoryExecution unknown category handling", () => {
	beforeEach(() => {
		mock.restore()
	})

	afterEach(() => {
		mock.restore()
	})

	test("#given unknown category #when resolving category execution #then it rejects before fetching available models", async () => {
		//#given
		const availableModelsSpy = spyOn(availableModels, "getAvailableModelsForDelegateTask")
		const executorContext: ExecutorContext = {
			client: {} as ExecutorContext["client"],
			manager: {} as ExecutorContext["manager"],
			directory: "/tmp/test",
			userCategories: {},
			sisyphusJuniorModel: undefined,
		}
		const args = {
			category: "backend-engineer",
			prompt: "test prompt",
			description: "Test task",
			run_in_background: false,
			load_skills: [],
			blockedBy: undefined,
			enableSkillTools: false,
		}

		//#when
		const result = await resolveCategoryExecution(args, executorContext, undefined, "anthropic/claude-sonnet-4-6")

		//#then
		expect(result.error).toContain('Unknown category: "backend-engineer"')
		expect(availableModelsSpy).not.toHaveBeenCalled()
	})
})
