import { expect, test } from "bun:test"
import type { NodeSpec } from "../../testing/build-snapshot"
import { firstViewportColumnOverflow } from "./first-viewport-column-overflow"
import { marked } from "./support/layout-cases"

const opening = (short: Partial<NodeSpec> = {}, tall: Partial<NodeSpec> = {}): NodeSpec => ({
	id: "opening", style: { display: "grid" }, rect: { x: 20, y: 20, width: 1200, height: 1600 }, children: [
		{ id: "short", rect: { x: 40, y: 40, width: 500, height: 1500 }, children: [{ tag: "p", text: "Short opening copy", rect: { x: 40, y: 40, width: 500, height: 200 } }], ...short },
		{ rect: { x: 640, y: 40, width: 500, height: 1500 }, children: [{ text: "A tall block", rect: { x: 640, y: 40, width: 500, height: 1500 } }], ...tall },
	],
})

test("#given stretched grid cells with unequal content #then measured content exposes the tall opening", () => {
	expect(marked(firstViewportColumnOverflow, [opening()])).toEqual(["#opening"])
	expect(marked(firstViewportColumnOverflow, [opening({}, { children: [{ text: "Fits", rect: { x: 640, y: 40, width: 500, height: 600 } }] })])).toEqual([])
})

test("#given stacked columns or navigation rails #then intentional short regions are excluded", () => {
	expect(marked(firstViewportColumnOverflow, [opening()])).toEqual(["#opening"])
	expect(marked(firstViewportColumnOverflow, [opening({ tag: "nav" })])).toEqual([])
	expect(marked(firstViewportColumnOverflow, [opening({ style: { position: "sticky" } })])).toEqual([])
	expect(marked(firstViewportColumnOverflow, [opening({}, { rect: { x: 40, y: 300, width: 500, height: 1500 } })])).toEqual([])
})

test("#given tall content cut inside its own scrolling column #then only visible content is measured", () => {
	expect(marked(firstViewportColumnOverflow, [opening()])).toEqual(["#opening"])
	expect(marked(firstViewportColumnOverflow, [opening({}, { style: { "overflow-y": "auto" }, rect: { x: 640, y: 40, width: 500, height: 500 } })])).toEqual([])
})
