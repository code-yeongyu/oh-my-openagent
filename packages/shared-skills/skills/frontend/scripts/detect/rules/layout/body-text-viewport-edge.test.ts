import { expect, test } from "bun:test"
import type { NodeSpec } from "../../testing/build-snapshot"
import { bodyTextViewportEdge } from "./body-text-viewport-edge"
import { lines, marked } from "./support/layout-cases"

const prose = "This paragraph contains substantial reading text that needs a gutter at either side of the page."

test("#given full width prose with and without a gutter #then only edge touching text reports", () => {
	expect(marked(bodyTextViewportEdge, [
		{ id: "flush", tag: "p", text: prose, rect: { width: 1280, height: 80 }, lineRects: lines([1280, 100], 0, 0) },
		{ id: "inset", tag: "p", text: prose, rect: { width: 1280, height: 80 }, lineRects: lines([1200], 40, 100) },
	])).toEqual(["#flush"])
})

test("#given a phone gutter of twelve pixels #then phone and desktop floors differ", () => {
	const node = { id: "copy", tag: "p", text: prose, rect: { x: 12, width: 296 }, lineRects: lines([296], 12, 0) }
	expect(marked(bodyTextViewportEdge, [node], { viewport: { width: 320, height: 800 } })).toEqual([])
	expect(marked(bodyTextViewportEdge, [{ ...node, rect: { x: 12, width: 1256 }, lineRects: lines([1256], 12, 0) }])).toEqual(["#copy"])
})

test("#given navigation and scrollable tracks beside body content #then only body content keeps the gutter requirement", () => {
	const node = { id: "copy", tag: "p", text: prose, rect: { width: 1280 }, lineRects: lines([1280], 0, 0) }
	expect(marked(bodyTextViewportEdge, [node])).toEqual(["#copy"])
	expect(marked(bodyTextViewportEdge, [{ tag: "nav", children: [node] }])).toEqual([])
	expect(marked(bodyTextViewportEdge, [{ style: { "overflow-x": "auto" }, children: [node] }])).toEqual([])
})

test("#given body text past the window #then overflow is reported once at page level", () => {
	const node = { tag: "p", text: prose, rect: { x: 40, width: 1600 }, lineRects: lines([1600], 40, 0) }
	expect(marked(bodyTextViewportEdge, [node, node])).toEqual(["page"])
	expect(marked(bodyTextViewportEdge, [{ ...node, rect: { x: 1400, width: 1600 }, lineRects: lines([1600], 1400, 0) }])).toEqual([])
})

test("#given overflow on one side and a narrow gutter opposite #then both forms report", () => {
	const node = { id: "copy", tag: "p", text: prose, rect: { x: 8, width: 1400 }, lineRects: lines([1400], 8, 0) }
	expect(marked(bodyTextViewportEdge, [node])).toEqual(["#copy", "page"])
})

test("#given prose inside a whole card link #then its label is not body reading text", () => {
	const node = { id: "copy", text: prose, rect: { width: 1280 }, lineRects: lines([1280], 0, 0) }
	expect(marked(bodyTextViewportEdge, [{ tag: "a", children: [node] }])).toEqual([])
})

test("#given a genuinely running endless row #then its current text position is not a page gutter", () => {
	const css = "@keyframes slide { from { transform: translateX(0) } to { transform: translateX(-50%) } }"
	const track = (motion: readonly string[], state = "running", name = "slide", count = "infinite"): NodeSpec => ({
		style: { transform: "matrix(1, 0, 0, 1, -1, 0)", "animation-name": name, "animation-iteration-count": count, "animation-play-state": state },
		motion, rect: { x: -1, y: 0, width: 2560, height: 100 }, scroll: { scrollWidth: 2560, clientWidth: 2560 },
		children: [
			{ rect: { x: -1, y: 0, width: 1280, height: 100 }, children: [{ id: "copy", tag: "p", text: prose,
				rect: { x: 8, y: 0, width: 1260, height: 48 }, lineRects: lines([1200, 800], 8, 0) }] },
			{ rect: { x: 1279, y: 0, width: 1280, height: 100 } },
		],
	})
	const host = (node: NodeSpec): NodeSpec => ({ style: { "overflow-x": "hidden" },
		rect: { width: 1280, height: 100 }, scroll: { clientWidth: 1280 }, children: [node] })
	expect(marked(bodyTextViewportEdge, [host(track(["transform"]))], { cssText: [css] })).toEqual([])
	expect(marked(bodyTextViewportEdge, [host(track([], "paused"))], { cssText: [css] })).toEqual(["#copy"])
	const scale = "@keyframes pulse { from { transform: scale(.9) } to { transform: scale(1) } }"
	expect(marked(bodyTextViewportEdge, [host(track(["transform"], "running", "pulse"))], { cssText: [scale] })).toEqual(["#copy"])
	const fade = "@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
	expect(marked(bodyTextViewportEdge, [host(track(["opacity", "transform"], "running, running", "fade, slide", "infinite, 1"))],
		{ cssText: [fade, css] })).toEqual(["#copy"])
})
