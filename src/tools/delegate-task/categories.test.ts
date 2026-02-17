import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test"
import { resolveCategoryConfig } from "./categories"
import { resolveModel } from "../../shared/model-resolver"
import type { CategoriesConfig } from "../../config/schema"

// Mock resolveModel
vi.mock("../../shared/model-resolver", () => ({
	resolveModel: vi.fn((opts: { userModel?: string; inheritedModel?: string; systemDefault?: string }) => {
		// Simple mock: return userModel if provided, else inheritedModel, else systemDefault
		return opts.userModel ?? opts.inheritedModel ?? opts.systemDefault
	}),
}))

describe("resolveCategoryConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("model field handling", () => {
		it("returns array model as-is when model is string[]", () => {
			//#given
			const userCategories: CategoriesConfig = {
				quick: {
					model: ["haiku-4-5", "sonnet-4-5"],
				},
			}

			//#when
			const result = resolveCategoryConfig("quick", {
				userCategories,
				systemDefaultModel: "opus-4-6",
			})

			//#then
			expect(result).not.toBeNull()
			expect(result!.model).toEqual(["haiku-4-5", "sonnet-4-5"])
			expect(result!.config.model).toEqual(["haiku-4-5", "sonnet-4-5"])
			// resolveModel should NOT be called for array models
			expect(resolveModel).not.toHaveBeenCalled()
		})

		it("calls resolveModel when model is string", () => {
			//#given
			const userCategories: CategoriesConfig = {
				quick: {
					model: "haiku-4-5",
				},
			}

			//#when
			const result = resolveCategoryConfig("quick", {
				userCategories,
				systemDefaultModel: "opus-4-6",
			})

			//#then
			expect(result).not.toBeNull()
			expect(resolveModel).toHaveBeenCalledWith({
				userModel: "haiku-4-5",
				inheritedModel: expect.any(String),
				systemDefault: "opus-4-6",
			})
		})

		it("returns undefined model when model is undefined", () => {
			//#given
			const userCategories: CategoriesConfig = {
				quick: {
					// No model specified
					description: "Quick tasks",
				},
			}

			//#when
			const result = resolveCategoryConfig("quick", {
				userCategories,
				systemDefaultModel: "opus-4-6",
			})

			//#then
			expect(result).not.toBeNull()
			// resolveModel should still be called (for default model resolution)
			expect(resolveModel).toHaveBeenCalled()
		})

		it("returns array model as-is even with invalid model names", () => {
			//#given
			const userCategories: CategoriesConfig = {
				quick: {
					model: ["invalid-model-1", "invalid-model-2"],
				},
			}

			//#when
			const result = resolveCategoryConfig("quick", {
				userCategories,
				systemDefaultModel: "opus-4-6",
			})

			//#then
			expect(result).not.toBeNull()
			expect(result!.model).toEqual(["invalid-model-1", "invalid-model-2"])
			expect(resolveModel).not.toHaveBeenCalled()
		})

		it("preserves other category config fields with array model", () => {
			//#given
			const userCategories: CategoriesConfig = {
				quick: {
					model: ["haiku-4-5", "sonnet-4-5"],
					description: "Quick tasks",
					temperature: 0.5,
					variant: "low",
				},
			}

			//#when
			const result = resolveCategoryConfig("quick", {
				userCategories,
				systemDefaultModel: "opus-4-6",
			})

			//#then
			expect(result).not.toBeNull()
			expect(result!.config.model).toEqual(["haiku-4-5", "sonnet-4-5"])
			expect(result!.config.description).toBe("Quick tasks")
			expect(result!.config.temperature).toBe(0.5)
			expect(result!.config.variant).toBe("low")
		})
	})
})
