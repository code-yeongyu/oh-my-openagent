import { describe, expect, test } from "bun:test"

import { similarity } from "./text-similarity.mjs"

describe("similarity", () => {
	test("#given identical strings #when compared #then similarity is exactly 1", () => {
		// when / then
		expect(similarity("a", "a")).toBe(1)
		expect(similarity("", "")).toBe(1)
	})

	test("#given an OCR-noisy copy of a sentence #when compared #then similarity is at least 0.95", () => {
		// given
		const clean = "The company reported revenue of 100 billion won in the third quarter of 2025."
		const noisy = "The  cornpany reported revenue of 100 bi1lion won in the third quarter of 2025. "
		// when
		const score = similarity(clean, noisy)
		// then
		expect(score).toBeGreaterThanOrEqual(0.95)
		expect(score).toBeLessThan(1)
	})

	test("#given NFD vs NFC and curly vs straight quotes #when compared #then normalization makes them equal", () => {
		// when / then
		expect(similarity("\u201C매출은 늘었다\u201D".normalize("NFD"), "\"매출은 늘었다\"")).toBe(1)
	})

	test("#given a different sentence #when compared #then similarity is below 0.8", () => {
		// given
		const a = "The company reported revenue of 100 billion won in the third quarter of 2025."
		const b = "Analysts expect margins to shrink next year as input costs keep rising."
		// when
		const score = similarity(a, b)
		// then
		expect(score).toBeLessThan(0.8)
		expect(score).toBeGreaterThanOrEqual(0)
	})
})
