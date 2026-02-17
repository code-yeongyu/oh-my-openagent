declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")

import type { FallbackEntry } from "../../shared/model-requirements"
import { resetPoolState } from "./model-pool-state"
import { resolveModelForDelegateTask } from "./model-selection"

describe("resolveModelForDelegateTask (model pool)", () => {
	beforeEach(() => {
		resetPoolState()
	})

	afterEach(() => {
		resetPoolState()
	})

	test("pool=[haiku,sonnet], haiku available → returns haiku", () => {
		//#given
		const pool = ["haiku-4-5", "sonnet-4-5"]
		const availableModels = new Set(["haiku-4-5", "sonnet-4-5"])

		//#when
		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(result).toEqual({ model: "haiku-4-5" })
	})

	test("pool=[A,B,C], A unavailable, B available → returns B", () => {
		//#given
		const pool = ["p/A", "p/B", "p/C"]
		const availableModels = new Set(["p/B", "p/C"])

		//#when
		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(result).toEqual({ model: "p/B" })
	})

	test("pool=[A,B,C], all unavailable → falls back to fallbackChain", () => {
		//#given
		const pool = ["p/A", "p/B", "p/C"]
		const fallbackChain: FallbackEntry[] = [
			{ model: "fallback-1", providers: ["p"], variant: "v" },
		]
		const availableModels = new Set(["p/fallback-1"])

		//#when
		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(result).toEqual({ model: "p/fallback-1", variant: "v" })
	})

	test("pool=[A], A available → returns A", () => {
		//#given
		const pool = ["p/A"]
		const availableModels = new Set(["p/A"])

		//#when
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

	test("pool=[A], A unavailable → falls back to fallbackChain", () => {
		//#given
		const pool = ["p/A"]
		const fallbackChain: FallbackEntry[] = [
			{ model: "fallback-1", providers: ["p"], variant: "v" },
		]
		const availableModels = new Set(["p/fallback-1"])

		//#when
		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(result).toEqual({ model: "p/fallback-1", variant: "v" })
	})

	test("pool round-robin rotates across calls", () => {
		//#given
		const pool = ["p/A", "p/B", "p/C"]
		const availableModels = new Set(["p/A", "p/B", "p/C"])

		//#when
		const first = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})
		const second = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})
		const third = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: pool,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: undefined,
		})

		//#then
		expect(first).toEqual({ model: "p/A" })
		expect(second).toEqual({ model: "p/B" })
		expect(third).toEqual({ model: "p/C" })
	})
})

describe("resolveModelForDelegateTask (backward compatibility)", () => {
	test("categoryDefaultModel string keeps existing matching behavior", () => {
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

	test("categoryDefaultModel undefined keeps existing fallback behavior", () => {
		//#given
		const availableModels = new Set(["p/system"])

		//#when
		const result = resolveModelForDelegateTask({
			userModel: undefined,
			categoryDefaultModel: undefined,
			fallbackChain: undefined,
			availableModels,
			systemDefaultModel: "p/system",
		})

		//#then
		expect(result).toEqual({ model: "p/system" })
	})
})
