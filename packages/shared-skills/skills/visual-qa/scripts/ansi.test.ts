import { describe, expect, test } from "bun:test"

import { hasAnsi, stripAnsi } from "./ansi"

const ESC = String.fromCharCode(0x1b)

describe("stripAnsi", () => {
	test("#given an ANSI-wrapped string #when stripped #then escape codes are removed", () => {
		// given
		const input = `${ESC}[31mred${ESC}[0m`
		// when
		const stripped = stripAnsi(input)
		// then
		expect(stripped).toBe("red")
	})

	test("#given a plain string #when stripped #then it is unchanged", () => {
		// given
		const input = "plain text"
		// when
		const stripped = stripAnsi(input)
		// then
		expect(stripped).toBe("plain text")
	})
})

describe("hasAnsi", () => {
	test("#given a string with ANSI codes #when checked #then it is true", () => {
		// given
		const input = `${ESC}[1mbold${ESC}[0m`
		// when
		const detected = hasAnsi(input)
		// then
		expect(detected).toBe(true)
	})

	test("#given a plain string #when checked #then it is false", () => {
		// given
		const input = "no ansi here"
		// when
		const detected = hasAnsi(input)
		// then
		expect(detected).toBe(false)
	})
})
