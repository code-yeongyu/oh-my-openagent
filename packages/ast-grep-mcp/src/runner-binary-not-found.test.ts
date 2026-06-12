import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test"

import * as resolutionModule from "./cli-binary-path-resolution"
import * as constantsModule from "./constants"

const originalConstants = { ...constantsModule }
const originalResolution = { ...resolutionModule }

beforeAll(() => {
	mock.module("./constants", () => ({
		...originalConstants,
		getSgCliPath: () => null,
	}))
	mock.module("./cli-binary-path-resolution", () => ({
		...originalResolution,
		getAstGrepPath: async () => null,
	}))
})

afterAll(() => {
	mock.module("./constants", () => originalConstants)
	mock.module("./cli-binary-path-resolution", () => originalResolution)
})

describe("runner binary-not-found contract", () => {
	it("surfaces the ENOENT-style not-found error when every resolution step misses", async () => {
		const { runSg } = await import("./runner")

		const result = await runSg({ pattern: "console.log($A)", lang: "typescript" })

		expect(result.matches).toEqual([])
		expect(result.totalMatches).toBe(0)
		expect(result.error).toStartWith("ast-grep (sg) binary not found.")
	})
})
