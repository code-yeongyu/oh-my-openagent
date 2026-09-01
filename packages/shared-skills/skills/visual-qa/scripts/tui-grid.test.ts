import { describe, expect, test } from "bun:test"

import { checkTui } from "./tui-grid"

const ESC = String.fromCharCode(0x1b)

describe("checkTui", () => {
	test("#given ASCII lines within the width #when checked #then there is no overflow", () => {
		// given / when
		const result = checkTui("hello\nworld", 80)
		// then
		expect(result.lineCount).toBe(2)
		expect(result.lineWidths).toEqual([5, 5])
		expect(result.maxWidth).toBe(5)
		expect(result.overflowLines.length).toBe(0)
		expect(result.hasAnsi).toBe(false)
	})

	test("#given a line wider than the expected columns #when checked #then it is flagged as overflow", () => {
		// given / when
		const result = checkTui("short\nthis line is definitely too long", 10)
		// then
		expect(result.overflowLines.length).toBe(1)
		expect(result.overflowLines[0]?.line).toBe(2)
		expect(result.maxWidth).toBeGreaterThan(10)
	})

	test("#given CJK text #when checked #then wide characters count as two columns", () => {
		// given / when
		const result = checkTui("가나다", 80)
		// then
		expect(result.lineWidths).toEqual([6])
		expect(result.wideCharColumns).toEqual([0, 2, 4])
	})

	test("#given a box whose CJK content is wider than its border #when checked #then borders are misaligned", () => {
		// given / when
		const result = checkTui("┌──┐\n│가가│\n└──┘", 80)
		// then
		expect(result.borderMisaligned).toBe(true)
	})

	test("#given a well-formed box #when checked #then borders are aligned", () => {
		// given / when
		const result = checkTui("┌──┐\n│ab│\n└──┘", 80)
		// then
		expect(result.borderMisaligned).toBe(false)
	})

	test("#given text with ANSI color codes #when checked #then ANSI is detected and ignored for width", () => {
		// given / when
		const result = checkTui(`${ESC}[31mred${ESC}[0m`, 80)
		// then
		expect(result.hasAnsi).toBe(true)
		expect(result.lineWidths).toEqual([3])
	})
})
