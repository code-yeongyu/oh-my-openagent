declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")

import { isModelPool, normalizeModelToPool, extractSingleModel } from "./model-pool-utils"

describe("isModelPool", () => {
	test("returns true for string array", () => {
		// given
		const model = ["claude-sonnet-4-5", "gpt-5.3-codex"]

		// when
		const result = isModelPool(model)

		// then
		expect(result).toBe(true)
	})

	test("returns false for string", () => {
		// given
		const model = "claude-sonnet-4-5"

		// when
		const result = isModelPool(model)

		// then
		expect(result).toBe(false)
	})

	test("returns false for undefined", () => {
		// given
		const model = undefined

		// when
		const result = isModelPool(model)

		// then
		expect(result).toBe(false)
	})
})

describe("normalizeModelToPool", () => {
	test("converts string to single-element array", () => {
		// given
		const model = "claude-sonnet-4-5"

		// when
		const result = normalizeModelToPool(model)

		// then
		expect(result).toEqual(["claude-sonnet-4-5"])
	})

	test("returns array as-is", () => {
		// given
		const model = ["claude-sonnet-4-5", "gpt-5.3-codex"]

		// when
		const result = normalizeModelToPool(model)

		// then
		expect(result).toEqual(["claude-sonnet-4-5", "gpt-5.3-codex"])
	})

	test("returns undefined for undefined input", () => {
		// given
		const model = undefined

		// when
		const result = normalizeModelToPool(model)

		// then
		expect(result).toBeUndefined()
	})
})

describe("extractSingleModel", () => {
	test("returns string for single-element array", () => {
		// given
		const model = ["claude-sonnet-4-5"]

		// when
		const result = extractSingleModel(model)

		// then
		expect(result).toBe("claude-sonnet-4-5")
	})

	test("returns undefined for multi-element array", () => {
		// given
		const model = ["claude-sonnet-4-5", "gpt-5.3-codex"]

		// when
		const result = extractSingleModel(model)

		// then
		expect(result).toBeUndefined()
	})

	test("returns undefined for empty array", () => {
		// given
		const model: string[] = []

		// when
		const result = extractSingleModel(model)

		// then
		expect(result).toBeUndefined()
	})

	test("returns undefined for undefined input", () => {
		// given
		const model = undefined

		// when
		const result = extractSingleModel(model)

		// then
		expect(result).toBeUndefined()
	})
})
