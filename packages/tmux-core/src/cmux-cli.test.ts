/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { resolveCmuxCliExecutable } from "./cmux-cli"

describe("resolveCmuxCliExecutable", () => {
	it("#given CMUX_OMO_CMUX_BIN set #when resolveCmuxCliExecutable called #then returns that path", () => {
		// given
		const environment = {
			CMUX_OMO_CMUX_BIN: "/Applications/cmux.app/Contents/Resources/bin/cmux",
			CMUX_BUNDLED_CLI_PATH: "/ignored/cmux",
		}

		// when
		const result = resolveCmuxCliExecutable(environment)

		// then
		expect(result).toBe("/Applications/cmux.app/Contents/Resources/bin/cmux")
	})

	it("#given only CMUX_BUNDLED_CLI_PATH set #when resolveCmuxCliExecutable called #then falls back to it", () => {
		// given
		const environment = { CMUX_BUNDLED_CLI_PATH: "/Applications/cmux.app/Contents/Resources/bin/cmux" }

		// when
		const result = resolveCmuxCliExecutable(environment)

		// then
		expect(result).toBe("/Applications/cmux.app/Contents/Resources/bin/cmux")
	})

	it("#given no cmux path variables #when resolveCmuxCliExecutable called #then falls back to bare cmux", () => {
		// given
		const environment = {}

		// when
		const result = resolveCmuxCliExecutable(environment)

		// then
		expect(result).toBe("cmux")
	})

	it("#given empty CMUX_OMO_CMUX_BIN #when resolveCmuxCliExecutable called #then skips it instead of returning an empty executable", () => {
		// given
		const environment = { CMUX_OMO_CMUX_BIN: "", CMUX_BUNDLED_CLI_PATH: "/opt/cmux" }

		// when
		const result = resolveCmuxCliExecutable(environment)

		// then
		expect(result).toBe("/opt/cmux")
	})
})
