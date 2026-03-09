import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import * as availableModels from "./available-models";
import { resolveCategoryExecution } from "./category-resolver";
import type { ExecutorContext } from "./executor-types";

describe("category profile override injection", () => {
	let availableModelsSpy: ReturnType<typeof spyOn> | undefined;

	beforeEach(() => {
		mock.restore();
		availableModelsSpy = spyOn(
			availableModels,
			"getAvailableModelsForDelegateTask",
		);
	});

	afterEach(() => {
		availableModelsSpy?.mockRestore();
	});

	function createExecutorContext(
		overrides?: Partial<ExecutorContext>,
	): ExecutorContext {
		return {
			client: {} as ExecutorContext["client"],
			manager: {} as ExecutorContext["manager"],
			directory: "/tmp/test",
			userCategories: {},
			sisyphusJuniorModel: undefined,
			...overrides,
		};
	}

	test("economy profile overrides ultrabrain category model", async () => {
		const args = {
			category: "ultrabrain",
			prompt: "Solve the hard problem",
			description: "Profile override test",
			run_in_background: false,
			load_skills: [],
		};
		const executorCtx = {
			...createExecutorContext(),
			modelProfile: "economy",
		} as ExecutorContext;

		availableModelsSpy?.mockResolvedValue(
			new Set(["openai/gpt-5.4", "openai/gpt-5.3-codex"]),
		);

		const result = await resolveCategoryExecution(
			args,
			executorCtx,
			undefined,
			"anthropic/claude-sonnet-4-6",
		);

		expect(result.error).toBeUndefined();
		expect(result.actualModel).toBe("openai/gpt-5.4");
		expect(result.categoryModel).toEqual({
			providerID: "openai",
			modelID: "gpt-5.4",
			variant: "medium",
		});
	});

	test("manual category config beats economy profile override", async () => {
		const args = {
			category: "ultrabrain",
			prompt: "Solve the hard problem",
			description: "Manual override test",
			run_in_background: false,
			load_skills: [],
		};
		const executorCtx = {
			...createExecutorContext({
				userCategories: {
					ultrabrain: {
						model: "anthropic/claude-opus-4-6",
						variant: "max",
					},
				},
			}),
			modelProfile: "economy",
		} as ExecutorContext;

		availableModelsSpy?.mockResolvedValue(
			new Set([
				"openai/gpt-5.4",
				"anthropic/claude-opus-4-6",
				"openai/gpt-5.3-codex",
			]),
		);

		const result = await resolveCategoryExecution(
			args,
			executorCtx,
			undefined,
			"anthropic/claude-sonnet-4-6",
		);

		expect(result.error).toBeUndefined();
		expect(result.actualModel).toBe("anthropic/claude-opus-4-6");
		expect(result.categoryModel).toEqual({
			providerID: "anthropic",
			modelID: "claude-opus-4-6",
			variant: "max",
		});
	});
});
