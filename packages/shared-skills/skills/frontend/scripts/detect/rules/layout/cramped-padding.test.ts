import { expect, test } from "bun:test"
import { crampedPadding } from "./cramped-padding"
import { border, lines, marked } from "./support/layout-cases"

const card = {
	id: "card", text: "Substantial text that needs space beside its container boundary.",
	style: { ...border, "padding-top": "2px", "padding-left": "2px", "padding-bottom": "2px", "padding-right": "2px" },
	rect: { x: 24, y: 24, width: 300, height: 80 }, lineRects: lines([294, 200], 27, 27),
}

test("#given tight measured text and generous padding #then only the tight boundary reports", () => {
	expect(marked(crampedPadding, [card])).toEqual(["#card"])
	expect(marked(crampedPadding, [{ ...card, style: { ...border, "padding-top": "16px", "padding-bottom": "16px", "padding-left": "16px", "padding-right": "16px" } }])).toEqual([])
})

test("#given centered labels despite zero padding #then measured breathing room clears the rule", () => {
	expect(marked(crampedPadding, [card])).toEqual(["#card"])
	expect(marked(crampedPadding, [{ ...card, lineRects: lines([200], 74, 50) }])).toEqual([])
})

test("#given transparent borders and inline highlights #then no container boundary is charged", () => {
	expect(marked(crampedPadding, [card])).toEqual(["#card"])
	expect(marked(crampedPadding, [{ ...card, style: { ...card.style, display: "inline" } }])).toEqual([])
	const transparent = { ...card.style, "border-top-color": "transparent", "border-right-color": "transparent", "border-bottom-color": "transparent", "border-left-color": "transparent" }
	expect(marked(crampedPadding, [{ ...card, style: transparent }])).toEqual([])
})

test("#given child text flush against a wrapper #then the wrapper owns the missing inset", () => {
	const child = { tag: "p", text: "Child text that meets the outer frame.", rect: { x: 25, y: 25, width: 298, height: 50 }, lineRects: lines([298], 25, 25) }
	expect(marked(crampedPadding, [{ id: "wrapper", style: border, rect: card.rect, children: [child] }])).toEqual(["#wrapper"])
	expect(marked(crampedPadding, [{ id: "wrapper", style: border, rect: card.rect, children: [{ ...child, rect: { x: 40, y: 40, width: 260, height: 30 }, lineRects: lines([260], 40, 40) }] }])).toEqual([])
})

test("#given shifted transparent shells and pinned labels #then measured in-flow text decides", () => {
	const paragraph = { tag: "p", text: "Text carried onto the left rule by its shell.", style: { "padding-left": "24px" }, rect: { x: 1, y: 40, width: 298, height: 40 }, lineRects: lines([250], 25, 40) }
	const wrapper = { id: "wrapper", style: border, rect: { x: 24, y: 24, width: 300, height: 160 }, children: [
		{ style: { position: "relative", left: "-24px" }, rect: { x: 1, y: 25, width: 298, height: 150 }, children: [paragraph] },
	] }
	expect(marked(crampedPadding, [wrapper])).toEqual(["#wrapper"])
	expect(marked(crampedPadding, [{ ...wrapper, children: [{ children: [
		{ ...paragraph, rect: { x: 25, y: 40, width: 298, height: 40 }, lineRects: lines([250], 49, 40) },
		{ ...paragraph, style: { position: "absolute" }, lineRects: lines([250], 25, 80) },
	] }] }])).toEqual([])
})

test("#given gradient ink without a filled background #then it does not bound the text", () => {
	expect(marked(crampedPadding, [{ ...card, style: { "background-image": "linear-gradient(red, blue)", "background-clip": "text" } }])).toEqual([])
})

test("#given lines below a fixed height band #then only intersecting glyph bands set its insets", () => {
	expect(marked(crampedPadding, [{ ...card, style: { "background-color": "#333", "padding-left": "16px", "padding-right": "16px" },
		rect: { x: 24, y: 24, width: 300, height: 66 }, lineRects: [{ x: 40, y: 45, width: 240, height: 22 }, { x: 40, y: 111, width: 240, height: 22 }] }])).toEqual([])
})

test("#given abutting equal fills #then the shared edge does not need padding", () => {
	const panel = { id: "panel", style: { "background-color": "#eee" }, rect: { x: 24, y: 24, width: 300, height: 60 },
		children: [{ tag: "p", text: "The text closes at the bottom of this band.", rect: { x: 40, y: 45, width: 260, height: 39 }, lineRects: lines([240], 40, 64) }] }
	const next = { style: { "background-color": "#eee" }, rect: { x: 24, y: 84, width: 300, height: 60 } }
	expect(marked(crampedPadding, [panel, next])).toEqual([])
	expect(marked(crampedPadding, [panel, { ...next, style: { "background-color": "#ccd" } }])).toEqual(["#panel"])
})
