declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")

import type { FallbackEntry } from "../../shared/model-requirements"
import { resetPoolState } from "./model-pool-state"
import { resolveModelForDelegateTask } from "./model-selection"

describe("model-pool E2E", () => {
	beforeEach(() => {
		resetPoolState()
	})

	afterEach(() => {
		resetPoolState()
	})

	test("round-robin: 3 calls return A, B, C in order", () => {
		//#given
		const pool = ["p/A", "p/B", "p/C"]
		const availableModels = new Set(["p/A", "p/B", "p/C"])

		//#when
		const results = [
			resolveModelForDelegateTask({
				userModel: undefined,
				categoryDefaultModel: pool,
				fallbackChain: undefined,
				availableModels,
				systemDefaultModel: undefined,
			}),
			resolveModelForDelegateTask({
				userModel: undefined,
				categoryDefaultModel: pool,
				fallbackChain: undefined,
				availableModels,
				systemDefaultModel: undefined,
			}),
			resolveModelForDelegateTask({
				userModel: undefined,
				categoryDefaultModel: pool,
				fallbackChain: undefined,
				availableModels,
				systemDefaultModel: undefined,
			}),
		]

		//#then
		expect(results[0]).toEqual({ model: "p/A" })
		expect(results[1]).toEqual({ model: "p/B" })
		expect(results[2]).toEqual({ model: "p/C" })
	})

	test("pool all unavailable → fallback chain used", () => {
		//#given
		const pool = ["p/A", "p/B"]
		const fallbackChain: FallbackEntry[] = [
			{ model: "fallback-model", providers: ["p"], variant: "v1" },
		]
		const availableModels = new Set(["p/fallback-model"])

		//#when
		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(result).toEqual({ model: "p/fallback-model", variant: "v1" })
	})

	test("backward compatibility: string model works as before", () => {
		//#given
		const availableModels = new Set(["haiku-4-5"])

		//#when
		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: "haiku-4-5",
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(result).toEqual({ model: "haiku-4-5" })
	})

	test("resetPoolState resets round-robin counter", () => {
		//#given
		const pool = ["p/A", "p/B"]
		const availableModels = new Set(["p/A", "p/B"])

		//#when
		resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		resetPoolState()

		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(result).toEqual({ model: "p/A" })
	})

	test("categories have independent round-robin counters", () => {
		//#given
		const pool = ["p/X", "p/Y"]
		const availableModels = new Set(["p/X", "p/Y"])

		//#when
		const quick1 = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		const deep1 = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(quick1!.model).toBe("p/X")
		expect(deep1!.model).toBe("p/Y")
	})
})
