import { expect, test } from "bun:test"
import type { NodeSpec } from "../../testing/build-snapshot"
import { nestedCards } from "./nested-cards"
import { border, marked, rounded } from "./support/layout-cases"

const inner: NodeSpec = { id: "inner", style: { ...border, ...rounded }, rect: { x: 40, y: 40, width: 240, height: 140 }, children: [
	{ tag: "p", text: "An inner group with a paragraph of copy." }, { tag: "p", text: "A second paragraph makes this a content surface." },
] }
const outer = (child: NodeSpec): NodeSpec => ({ id: "outer", style: { ...border, ...rounded }, rect: { x: 20, y: 20, width: 400, height: 300 }, children: [child] })

test("#given bordered inner cards beside fill-only and hidden groups #then only a visible framed card reports", () => {
	expect(marked(nestedCards, [outer(inner)])).toEqual(["#inner"])
	expect(marked(nestedCards, [outer({ ...inner, style: { ...rounded, "background-color": "#eee" } })])).toEqual([])
	expect(marked(nestedCards, [outer({ ...inner, style: { ...border, ...rounded, opacity: "0" } })])).toEqual([])
})

test("#given labels and popups inside cards #then they are not nested surfaces", () => {
	expect(marked(nestedCards, [outer(inner)])).toEqual(["#inner"])
	for (const change of [{ attributes: { role: "menu" } }, { style: { ...border, ...rounded, position: "absolute" } }, { text: "Small label", children: [], rect: { x: 40, y: 40, width: 180, height: 32 } }]) {
		expect(marked(nestedCards, [outer({ ...inner, ...change })])).toEqual([])
	}
})

test("#given a card header sharing three edges #then it is part of its outer card", () => {
	expect(marked(nestedCards, [outer(inner)])).toEqual(["#inner"])
	expect(marked(nestedCards, [outer({ ...inner, rect: { x: 21, y: 21, width: 398, height: 140 } })])).toEqual([])
})

test("#given an embedded figure or a dialog panel #then its framing is not a nested card", () => {
	expect(marked(nestedCards, [outer(inner)])).toEqual(["#inner"])
	expect(marked(nestedCards, [outer({ ...inner, children: [{ tag: "canvas", rect: { width: 220, height: 120 } }, { tag: "p", text: "Chart caption." }] })])).toEqual([])
	expect(marked(nestedCards, [{ attributes: { role: "dialog" }, children: [outer(inner)] }])).toEqual([])
})

test("#given a hidden audio source with visible player controls #then player chrome is not a nested surface", () => {
	expect(marked(nestedCards, [outer(inner)])).toEqual(["#inner"])
	expect(marked(nestedCards, [outer({ ...inner, children: [
		{ tag: "audio", rect: { width: 0, height: 0 } },
		{ tag: "p", text: "Sample audio speaker A" },
		{ tag: "button", attributes: { "aria-label": "Play" } },
		{ attributes: { role: "slider", "aria-label": "Audio progress" } },
	] })])).toEqual([])
})

test("#given repeated inner cards in one panel #then only the first visible card reports", () => {
	const second = { ...inner, id: "second", rect: { x: 40, y: 200, width: 240, height: 140 } }
	expect(marked(nestedCards, [{ ...outer(inner), children: [inner, second] }])).toEqual(["#inner"])
	expect(marked(nestedCards, [{ ...outer(inner), children: [{ ...inner, attributes: { "data-detect-ignore": "nested-cards" } }, second] }])).toEqual(["#second"])
})

test("#given a one line content box with block children #then it is a label rather than a card", () => {
	expect(marked(nestedCards, [outer({ ...inner, rect: { x: 40, y: 40, width: 240, height: 32 }, children: [{ tag: "p", text: "One line of label text" }] })])).toEqual([])
})

test("#given a declared mockup with three runs #then its nested cards leave the page content", () => {
	const drawing = { ...outer(inner), attributes: { inert: "" }, children: [{ tag: "p", text: "Preview interface" }, inner] }
	const page = { tag: "p", text: "Readable page content. ".repeat(40) }
	expect(marked(nestedCards, [page, drawing])).toEqual([])
	expect(marked(nestedCards, [page, { ...drawing, attributes: {} }])).toEqual(["#inner"])
})
