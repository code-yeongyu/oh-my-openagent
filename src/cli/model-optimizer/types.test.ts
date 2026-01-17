import { describe, expect, it } from "bun:test"
import {
	ModelInfoSchema,
	ModelTierSchema,
} from "./types"

describe("ModelTierSchema", () => {
	it("should accept valid tiers", () => {
		// #given valid tier values
		const validTiers = ["flagship", "standard", "lite"]

		// #when parsing each tier
		// #then all should succeed
		for (const tier of validTiers) {
			expect(ModelTierSchema.safeParse(tier).success).toBe(true)
		}
	})

	it("should reject invalid tiers", () => {
		// #given an invalid tier value
		const invalidTier = "premium"

		// #when parsing
		const result = ModelTierSchema.safeParse(invalidTier)

		// #then it should fail
		expect(result.success).toBe(false)
	})
})

describe("ModelInfoSchema", () => {
	it("should accept valid model info", () => {
		// #given a valid model info object
		const validModelInfo = {
			id: "anthropic/claude-opus-4-5",
			provider: "anthropic",
			name: "claude-opus-4-5",
			family: "claude",
			version: "4.5",
			tier: "flagship",
		}

		// #when parsing
		const result = ModelInfoSchema.safeParse(validModelInfo)

		// #then it should succeed
		expect(result.success).toBe(true)
	})

	it("should accept model info without optional fields", () => {
		// #given model info with only required fields
		const minimalModelInfo = {
			id: "openai/gpt-4o",
			provider: "openai",
			name: "gpt-4o",
			tier: "standard",
		}

		// #when parsing
		const result = ModelInfoSchema.safeParse(minimalModelInfo)

		// #then it should succeed
		expect(result.success).toBe(true)
	})

	it("should reject model info with invalid tier", () => {
		// #given model info with invalid tier
		const invalidModelInfo = {
			id: "anthropic/claude-opus-4-5",
			provider: "anthropic",
			name: "claude-opus-4-5",
			tier: "ultra",
		}

		// #when parsing
		const result = ModelInfoSchema.safeParse(invalidModelInfo)

		// #then it should fail
		expect(result.success).toBe(false)
	})

	it("should reject model info missing required fields", () => {
		// #given model info missing id
		const incompleteModelInfo = {
			provider: "anthropic",
			name: "claude-opus-4-5",
			tier: "flagship",
		}

		// #when parsing
		const result = ModelInfoSchema.safeParse(incompleteModelInfo)

		// #then it should fail
		expect(result.success).toBe(false)
	})
})
