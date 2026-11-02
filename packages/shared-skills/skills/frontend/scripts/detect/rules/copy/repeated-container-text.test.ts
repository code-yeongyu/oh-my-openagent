import { expect, test } from "bun:test"
import { buildSnapshot, type NodeSpec } from "../../testing/build-snapshot"
import { repeatedContainerText } from "./repeated-container-text"

const card = (id: string, children: readonly NodeSpec[]): NodeSpec => ({
	id, style: { "border-top-width": "1px", "border-right-width": "1px", "border-bottom-width": "1px", "border-top-left-radius": "10px" }, children,
})
const slots = (text: string): readonly NodeSpec[] => [
	{ tag: "span", text }, { tag: "em", text }, { tag: "strong", text },
]
const flagged = (nodes: readonly NodeSpec[]) => repeatedContainerText.check({ snapshot: buildSnapshot(nodes), config: {} }).map((hit) => hit.element?.selector)

test("#given repeated text in distinct slots versus templated rows #then only redundant slots report", () => {
	expect(flagged([
		card("flag", slots("Suspended")),
		card("parallel", Array.from({ length: 3 }, () => ({ tag: "div", attributes: { class: "row" }, children: [{ tag: "span", text: "Suspended" }] }))),
		card("short", slots("Off")), card("numbers", slots("2026")), card("two", slots("Unavailable").slice(0, 2)),
		card("table", [{ tag: "table", children: slots("Suspended") }]),
		card("nav", [{ tag: "nav", children: slots("Suspended") }]),
		card("grid", [{ attributes: { role: "grid" }, children: slots("Suspended") }]),
	])).toEqual(["#flag"])
})

test("#given nested cards and unbounded containers #then the nearest bounded card owns its repeats", () => {
	expect(flagged([
		card("outer", [card("inner", slots("Unavailable"))]),
		{ id: "unbounded", children: slots("Unavailable") },
		...["one", "two", "three"].map((id) => card(id, [{ tag: "span", text: "Standby mode" }])),
	])).toEqual(["#inner"])
})

test("#given carousel id classes and clipped slides #then parked or structurally identical copies pass", () => {
	const slides = (generated: boolean): readonly NodeSpec[] => [0, 1, 2].map((n) => ({
		attributes: { class: generated ? `slide post-${43000 + n}` : `slide slot-${n}` },
		rect: { x: n * 320, width: 320 },
		children: [{ tag: "a", text: "Servidor VPS", rect: { x: n * 320, width: 100 } }],
	}))
	expect(flagged([
		card("visible", slots("Servidor VPS")),
		card("generated", slides(true)),
		card("parked", [{ style: { "overflow-x": "hidden" }, rect: { width: 320 }, children: slides(false) }]),
	])).toEqual(["#visible"])
})
