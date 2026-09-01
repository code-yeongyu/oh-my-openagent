/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { loadBuiltinCommands } from "./commands"

describe("init-deep skill migration", () => {
	test("#given builtin commands #when loaded #then init-deep no longer ships as a command", () => {
		// given

		// when
		const commands = loadBuiltinCommands()

		// then
		expect(commands["init-deep"]).toBeUndefined()
	})
})
