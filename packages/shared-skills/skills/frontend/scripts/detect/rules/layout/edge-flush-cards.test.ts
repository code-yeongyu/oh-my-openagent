import { expect, test } from "bun:test"
import type { NodeSpec } from "../../testing/build-snapshot"
import { edgeFlushCards } from "./edge-flush-cards"
import { marked } from "./support/layout-cases"

const row = (end = 604, extra: Partial<NodeSpec> = {}): NodeSpec => ({
	id: "row", style: { "overflow-x": "auto", "background-color": "#ddd" }, rect: { x: 24, y: 24, width: 600, height: 160 },
	scroll: { scrollWidth: 1200, clientWidth: 600 }, children: [
		{ id: "card", style: { "background-color": "#fff" }, rect: { x: 40, y: 40, width: end - 16, height: 90 } },
		{ style: { "background-color": "#fff" }, rect: { x: 660, y: 40, width: 560, height: 90 } },
	], ...extra,
})

test("#given asymmetric card edges beside even gutters #then only the cut edge reports", () => {
	expect(marked(edgeFlushCards, [row()])).toEqual(["#row"])
	expect(marked(edgeFlushCards, [row(584)])).toEqual([])
	expect(marked(edgeFlushCards, [row(700)])).toEqual([])
})

test("#given lone cards and vertical only scrollers #then no horizontal row is charged", () => {
	expect(marked(edgeFlushCards, [row()])).toEqual(["#row"])
	expect(marked(edgeFlushCards, [row(604, { children: [{ style: { "background-color": "#fff" }, rect: { x: 40, y: 40, width: 588, height: 90 } }] })])).toEqual([])
	expect(marked(edgeFlushCards, [row(604, { style: { "overflow-x": "hidden", "overflow-y": "auto" } })])).toEqual([])
})

test("#given table cells in a scroll region #then table geometry is not treated as cards", () => {
	expect(marked(edgeFlushCards, [row()])).toEqual(["#row"])
	expect(marked(edgeFlushCards, [row(604, { children: [
		{ tag: "td", style: { "background-color": "#fff" }, rect: { x: 40, y: 40, width: 588, height: 90 } },
		{ tag: "td", style: { "background-color": "#fff" }, rect: { x: 660, y: 40, width: 560, height: 90 } },
	] })])).toEqual([])
})

test("#given a transparent scroller in a centered column #then its inset is not a page gutter", () => {
	const transparent = (x: number): NodeSpec => row(604, {
		style: { "overflow-x": "auto" }, rect: { x, y: 24, width: 600, height: 160 }, children: [
			{ style: { "background-color": "#fff" }, rect: { x: x + 4, y: 40, width: 560, height: 90 } },
			{ style: { "background-color": "#fff" }, rect: { x: x + 620, y: 40, width: 560, height: 90 } },
		],
	})
	expect(marked(edgeFlushCards, [transparent(24)])).toEqual([])
	expect(marked(edgeFlushCards, [transparent(200)])).toEqual(["#row"])
})
