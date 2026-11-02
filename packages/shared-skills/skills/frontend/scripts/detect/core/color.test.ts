import { describe, expect, test } from "bun:test"
import { colorsIn, parseColor } from "./color"

const rgb = (s: string): readonly number[] | null => {
	const c = parseColor(s)
	return c ? [c.r, c.g, c.b].map(Math.round) : null
}

describe("parseColor modern color spaces", () => {
	test.each([
		["color(display-p3 0.2 0.5 0.7)", [0, 130, 183]],
		["color(display-p3 1 0 0)", [255, 0, 0]],
		["color(srgb-linear 0.2 0.3 0.4)", [124, 149, 170]],
		["lab(60 -20 30)", [123, 154, 90]],
		["lab(29.2345% 39.3825 20.0664)", [125, 35, 41]],
		["lch(50 30 120)", [105, 126, 73]],
		["oklch(0.7 0.1 200)", [64, 177, 183]],
	])("#given %s as getComputedStyle reports it #then it converts to the sRGB Chrome paints", (input, expected) => {
		expect(rgb(input)).toEqual(expected)
	})

	test("#given an unsupported predefined space #then the color is unknown, not black", () => {
		expect(parseColor("color(rec2020 0.5 0.5 0.5)")).toBeNull()
	})

	test("#given a gradient with lab and lch stops #then colorsIn finds every stop", () => {
		expect(colorsIn("linear-gradient(lab(60 -20 30), lch(50 30 120) 50%, oklab(0.5 0 0))").length).toBe(3)
	})
})
