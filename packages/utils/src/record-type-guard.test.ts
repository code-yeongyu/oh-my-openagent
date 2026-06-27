import { describe, expect, test } from "bun:test"
import { isPlainRecord, isRecord } from "./record-type-guard"

describe("record type guards", () => {
	test("#given a plain object input #when using record guards #then both guards accept it", () => {
		// given
		const value: unknown = { key: "value" }

		// when
		const recordResult = isRecord(value)
		const plainRecordResult = isPlainRecord(value)

		// then
		expect(recordResult).toBe(true)
		expect(plainRecordResult).toBe(true)
	})

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

	test("#given null and primitive inputs #when using record guards #then both guards reject them", () => {
		// given
		const values: unknown[] = [null, undefined, "text", 1, true, Symbol("record")]

		// when
		const results = values.map((value) => ({
			isPlainRecord: isPlainRecord(value),
			isRecord: isRecord(value),
		}))

		// then
		expect(results).toEqual(
			values.map(() => ({
				isPlainRecord: false,
				isRecord: false,
			}))
		)
	})

	test("#given object instances #when using isPlainRecord #then non-array objects are still accepted", () => {
		// given
		const value: unknown = new Date("2026-06-27T00:00:00.000Z")

		// when
		const result = isPlainRecord(value)

		// then
		expect(result).toBe(true)
	})
})
