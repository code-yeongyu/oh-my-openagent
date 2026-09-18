import { describe, expect, test } from "bun:test"

import { diffImages } from "./image-diff"
import { solidRgba } from "./png-synth"
import type { DecodedImage } from "./types"

function makeImage(width: number, height: number, rgba: Uint8Array, transparent = false): DecodedImage {
	return { width, height, rgba, hasAlphaChannel: true, hasTransparentPixels: transparent }
}

describe("diffImages", () => {
	test("#given two identical images #when diffed #then similarity is 100 with no hotspots", () => {
		// given
		const ref = makeImage(4, 4, solidRgba(4, 4, [10, 20, 30, 255]))
		const act = makeImage(4, 4, solidRgba(4, 4, [10, 20, 30, 255]))
		// when
		const result = diffImages(ref, act)
		// then
		expect(result.diffPixels).toBe(0)
		expect(result.similarityScore).toBe(100)
		expect(result.hotspots.length).toBe(0)
		expect(result.dimensionsMatch).toBe(true)
	})

	test("#given two fully different images #when diffed #then similarity is 0 with hotspots", () => {
		// given
		const ref = makeImage(4, 4, solidRgba(4, 4, [0, 0, 0, 255]))
		const act = makeImage(4, 4, solidRgba(4, 4, [255, 255, 255, 255]))
		// when
		const result = diffImages(ref, act)
		// then
		expect(result.diffPixels).toBe(16)
		expect(result.similarityScore).toBe(0)
		expect(result.hotspots.length).toBeGreaterThan(0)
	})

	test("#given images of different sizes #when diffed #then dimensionsMatch is false", () => {
		// given
		const ref = makeImage(4, 4, solidRgba(4, 4, [0, 0, 0, 255]))
		const act = makeImage(2, 2, solidRgba(2, 2, [0, 0, 0, 255]))
		// when
		const result = diffImages(ref, act)
		// then
		expect(result.dimensionsMatch).toBe(false)
	})

	test("#given a transparent reference and an opaque actual #when diffed #then alpha is flagged", () => {
		// given
		const ref = makeImage(2, 2, solidRgba(2, 2, [0, 0, 0, 128]), true)
		const act = makeImage(2, 2, solidRgba(2, 2, [0, 0, 0, 255]), false)
		// when
		const result = diffImages(ref, act)
		// then
		expect(result.alphaChannelIntact).toBe(false)
	})

	test("#given a single changed pixel #when diffed #then one hotspot marks its grid cell", () => {
		// given
		const base = solidRgba(8, 8, [0, 0, 0, 255])
		const changed = solidRgba(8, 8, [0, 0, 0, 255])
		changed[0] = 255
		// when
		const result = diffImages(makeImage(8, 8, base), makeImage(8, 8, changed))
		// then
		expect(result.diffPixels).toBe(1)
		expect(result.hotspots.length).toBe(1)
		expect(result.hotspots[0]?.gridX).toBe(0)
		expect(result.hotspots[0]?.gridY).toBe(0)
	})
})
