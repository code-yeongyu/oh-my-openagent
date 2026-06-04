import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"

import { decodePng } from "./png-decode"
import { encodeRgbaPng, solidRgba } from "./png-synth"

describe("decodePng", () => {
	test("#given an encoded RGBA image #when decoded #then dimensions and first pixel round-trip", () => {
		// given
		const png = encodeRgbaPng(3, 2, solidRgba(3, 2, [10, 20, 30, 255]))
		// when
		const decoded = decodePng(png)
		// then
		expect(decoded.width).toBe(3)
		expect(decoded.height).toBe(2)
		expect(Array.from(decoded.rgba.subarray(0, 4))).toEqual([10, 20, 30, 255])
	})

	test("#given a fully opaque image #when decoded #then it has no transparent pixels", () => {
		// given
		const png = encodeRgbaPng(2, 2, solidRgba(2, 2, [0, 0, 0, 255]))
		// when
		const decoded = decodePng(png)
		// then
		expect(decoded.hasAlphaChannel).toBe(true)
		expect(decoded.hasTransparentPixels).toBe(false)
	})

	test("#given a semi-transparent image #when decoded #then it reports transparent pixels", () => {
		// given
		const png = encodeRgbaPng(2, 2, solidRgba(2, 2, [255, 255, 255, 128]))
		// when
		const decoded = decodePng(png)
		// then
		expect(decoded.hasTransparentPixels).toBe(true)
	})

	test("#given a non-PNG buffer #when decoded #then it throws", () => {
		// given
		const notPng = Buffer.from("this is not a png file")
		// when / then
		expect(() => decodePng(notPng)).toThrow("not a PNG")
	})
})
