declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

// #9146: the OpenCode edition delegates through the same delegate-core resolver, so a machine whose
// only provider is OpenRouter must not have builtin categories routed onto OpenRouter's copies.
const OPENROUTER_MODELS = [
	"anthropic/claude-fable-5.1",
	"anthropic/claude-opus-5.5",
	"anthropic/claude-sonnet-5",
	"anthropic/claude-haiku-4.5",
	"openai/gpt-6-astra",
	"openai/gpt-5.6-sol",
	"openai/gpt-5.6-terra",
	"moonshotai/kimi-k3",
	"z-ai/glm-5.3",
	"~deepseek/deepseek-flash-latest",
	"xiaomi/mimo-v2.6-pro",
]

const BUILTIN_CATEGORIES = ["visual-engineering", "artistry", "unspecified-high", "writing", "ultrabrain", "deep-high", "deep-low", "quick", "unspecified-low"]

describe("OpenCode delegate-task on an OpenRouter-only machine (#9146)", () => {
	const spies: Array<{ mockRestore(): void }> = []

	beforeEach(() => {
		mock.restore()
		spies.push(
			spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
				models: { openrouter: OPENROUTER_MODELS },
				connected: ["openrouter"],
				updatedAt: "2026-09-29T00:00:00.000Z",
			}),
			spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openrouter"]),
			spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true),
			spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true),
		)
	})

	afterEach(() => {
		for (const spy of spies.splice(0)) spy.mockRestore()
	})

	const executorContext = (userCategories: ExecutorContext["userCategories"] = {}): ExecutorContext => ({
		client: unsafeTestValue({}),
		manager: unsafeTestValue({}),
		directory: "/tmp/test",
		userCategories,
		sisyphusJuniorModel: undefined,
	})

	const args = (category: string) => ({
		category,
		prompt: "leak probe",
		description: "leak probe",
		run_in_background: false,
		load_skills: [],
		blockedBy: undefined,
		enableSkillTools: false,
	})

	for (const category of BUILTIN_CATEGORIES) {
		test(`#when ${category} is delegated with no session default #then no OpenRouter model is selected`, async () => {
			const result = await resolveCategoryExecution(args(category), executorContext(), undefined, undefined)

			expect(result.actualModel?.startsWith("openrouter/") ?? false).toBe(false)
		})
	}

	test("#when the user pins an OpenRouter model for the category #then that pin is honored", async () => {
		const result = await resolveCategoryExecution(
			args("writing"),
			executorContext({ writing: { model: "openrouter/anthropic/claude-opus-5.5" } }),
			undefined,
			undefined,
		)

		expect(result.actualModel).toBe("openrouter/anthropic/claude-opus-5.5")
	})
})
