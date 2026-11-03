import { expect, test } from "bun:test"
import type { NodeSpec } from "../../testing/build-snapshot"
import { clippedOverflowContainer } from "./clipped-overflow-container"
import { marked } from "./support/layout-cases"

const popup: NodeSpec = { id: "popup", attributes: { role: "menu" }, style: { position: "absolute" }, rect: { x: 30, y: 160, width: 200, height: 80 }, text: "Menu contents" }
const host = (child: NodeSpec, style = "hidden"): NodeSpec => ({
	id: "host", style: { position: "relative", "overflow-x": style, "overflow-y": style }, rect: { x: 20, y: 20, width: 200, height: 120 }, children: [child],
})

test("#given escaped popup layers and decorative crops #then only popup clipping reports", () => {
	expect(marked(clippedOverflowContainer, [host(popup)])).toEqual(["#host"])
	expect(marked(clippedOverflowContainer, [host({ ...popup, attributes: { "aria-hidden": "true" }, text: "", id: "crop" })])).toEqual([])
	expect(marked(clippedOverflowContainer, [host(popup, "auto")])).toEqual([])
})

test("#given nested clipping hosts #then the nearest clipping box owns the popup", () => {
	const inner = { ...host(popup), id: "inner" }
	expect(marked(clippedOverflowContainer, [host(inner)])).toEqual(["#inner"])
	expect(marked(clippedOverflowContainer, [host({ ...popup, rect: { x: 30, y: 30, width: 100, height: 60 } })])).toEqual([])
})

test("#given fixed popups without and with transformed containment #then only the trapped fixed layer reports", () => {
	const fixed = { ...popup, style: { position: "fixed" } }
	expect(marked(clippedOverflowContainer, [host(fixed)])).toEqual([])
	const transformed = { ...host(fixed), style: { position: "relative", transform: "matrix(1, 0, 0, 1, 0, 0)", "overflow-x": "hidden", "overflow-y": "hidden" } }
	expect(marked(clippedOverflowContainer, [transformed])).toEqual(["#host"])
})

test("#given class named dropdowns and camel case slider tracks #then neither is an escaping popup", () => {
	expect(marked(clippedOverflowContainer, [host({ ...popup, attributes: { class: "dropdown-panel" } })])).toEqual([])
	expect(marked(clippedOverflowContainer, [{ ...host(popup), attributes: { class: "slickViewport" } }])).toEqual([])
	expect(marked(clippedOverflowContainer, [host({ ...popup, attributes: { role: "menu", "aria-hidden": "true" } })])).toEqual([])
})

test("#given modal and nonmodal open dialogs #then only the nonmodal dialog can be trapped by a clip", () => {
	const dialog = { ...popup, tag: "dialog", attributes: { open: "" }, modal: true }
	expect(marked(clippedOverflowContainer, [host(dialog)])).toEqual([])
	expect(marked(clippedOverflowContainer, [host({ ...dialog, modal: false })])).toEqual(["#host"])
})
