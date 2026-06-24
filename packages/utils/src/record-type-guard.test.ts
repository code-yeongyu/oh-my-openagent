import { describe, expect, test } from "bun:test"
import { isPlainRecord, isRecord } from "./record-type-guard"

describe("record type guards", () => {
	test("#given an array input #when using isRecord #then arrays remain record-like for legacy callers", () => {
		// given
		const value: unknown = []

		// when
		const result = isRecord(value)

		// then
		expect(result).toBe(true)
	})

	test("#given an array input #when using isPlainRecord #then arrays are rejected", () => {
		// given
		const value: unknown = []

		// when
		const result = isPlainRecord(value)

		// then
		expect(result).toBe(false)
	})
})
