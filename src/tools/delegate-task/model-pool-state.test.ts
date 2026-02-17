declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import {
	getNextModel,
	resetPoolState,
	resetCategoryState,
} from "./model-pool-state"

describe("model-pool-state", () => {
	beforeEach(() => {
		resetPoolState()
	})

	afterEach(() => {
		resetPoolState()
	})

	test("round-robin cycles through pool", () => {
		//#given
		const pool = ["model-A", "model-B", "model-C"]

		//#when
		const results = [
			getNextModel("quick", pool),
			getNextModel("quick", pool),
			getNextModel("quick", pool),
			getNextModel("quick", pool),
			getNextModel("quick", pool),
			getNextModel("quick", pool),
		]

		//#then
		expect(results).toEqual(["model-A", "model-B", "model-C", "model-A", "model-B", "model-C"])
	})

	test("categories have independent counters", () => {
		//#given
		const pool = ["model-X", "model-Y"]

		//#when
		const quickResults = [getNextModel("quick", pool), getNextModel("quick", pool)]
		const deepResults = [getNextModel("deep", pool), getNextModel("deep", pool)]

		//#then
		expect(quickResults).toEqual(["model-X", "model-Y"])
		expect(deepResults).toEqual(["model-X", "model-Y"])
	})

	test("resetPoolState resets all counters", () => {
		//#given
		const pool = ["model-A", "model-B"]
		getNextModel("quick", pool)
		getNextModel("quick", pool)
		getNextModel("deep", pool)

		//#when
		resetPoolState()
		const quickResult = getNextModel("quick", pool)
		const deepResult = getNextModel("deep", pool)

		//#then
		expect(quickResult).toBe("model-A")
		expect(deepResult).toBe("model-A")
	})

	test("resetCategoryState resets only specified category", () => {
		//#given
		const pool = ["model-A", "model-B"]
		getNextModel("quick", pool)
		getNextModel("deep", pool)

		//#when
		resetCategoryState("quick")
		const quickResult = getNextModel("quick", pool)
		const deepResult = getNextModel("deep", pool)

		//#then
		expect(quickResult).toBe("model-A")
		expect(deepResult).toBe("model-B")
	})

	test("handles pool size changes safely", () => {
		//#given
		const pool1 = ["model-A", "model-B", "model-C"]
		getNextModel("quick", pool1)
		getNextModel("quick", pool1)

		//#when - pool shrinks
		const pool2 = ["model-X", "model-Y"]
		const result = getNextModel("quick", pool2)

		//#then - should wrap safely with modulo
		expect(result).toBe("model-X")
	})

	test("handles empty pool gracefully", () => {
		//#given
		const emptyPool: string[] = []

		//#when
		const result = getNextModel("quick", emptyPool)

		//#then
		expect(result).toBe("")
	})
})
