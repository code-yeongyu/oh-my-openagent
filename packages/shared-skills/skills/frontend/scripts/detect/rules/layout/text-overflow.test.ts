import { expect, test } from "bun:test"
import type { NodeSpec } from "../../testing/build-snapshot"
import { textOverflow } from "./text-overflow"
import { lines, marked } from "./support/layout-cases"

const spill: NodeSpec = { id: "spill", tag: "p", text: "A long unbroken line of text spills outside this box.", rect: { x: 40, y: 40, width: 120, height: 40 }, scroll: { clientWidth: 120, scrollWidth: 300 }, lineRects: lines([300], 40, 40) }
const clip = (node: NodeSpec): NodeSpec => ({ style: { "overflow-x": "hidden" }, rect: { x: 20, y: 20, width: 200, height: 200 }, children: [node] })

test("#given spilled text under a clip and text in free space #then only harmful spill reports", () => {
	expect(marked(textOverflow, [clip(spill)])).toEqual(["#spill"])
	expect(marked(textOverflow, [spill])).toEqual([])
	expect(marked(textOverflow, [clip({ ...spill, lineRects: lines([100], 40, 40) })])).toEqual([])
})

test("#given explicit scroll and ellipsis affordances #then intentional containment is exempt", () => {
	expect(marked(textOverflow, [clip(spill)])).toEqual(["#spill"])
	expect(marked(textOverflow, [clip({ ...spill, style: { "overflow-x": "auto" } })])).toEqual([])
	expect(marked(textOverflow, [clip({ ...spill, style: { "overflow-x": "hidden", "text-overflow": "ellipsis" } })])).toEqual([])
})

test("#given inline text with ineffective ellipsis #then its block container determines the spill", () => {
	const inline = { ...spill, tag: "span", style: { display: "inline", "overflow-x": "hidden", "text-overflow": "ellipsis" }, scroll: { clientWidth: 0, scrollWidth: 0 } }
	expect(marked(textOverflow, [clip(inline)])).toEqual(["#spill"])
	expect(marked(textOverflow, [{ ...clip(inline), style: { "overflow-x": "hidden", "text-overflow": "ellipsis" } }])).toEqual([])
})

test("#given hidden or vertically clipped replacement text #then no invisible width spill reports", () => {
	expect(marked(textOverflow, [clip(spill)])).toEqual(["#spill"])
	expect(marked(textOverflow, [clip({ ...spill, style: { opacity: "0" } })])).toEqual([])
	expect(marked(textOverflow, [{ ...clip(spill), rect: { x: 20, y: 0, width: 200, height: 30 }, style: { "overflow-y": "hidden" } }])).toEqual([])
})

test("#given code in a scrolling page shell #then only a component scroller exempts it", () => {
	const code = { ...spill, tag: "pre", rect: { x: 1100, y: 40, width: 120, height: 40 }, lineRects: lines([500], 1100, 40) }
	expect(marked(textOverflow, [{ style: { "overflow-x": "auto" }, rect: { x: 0, y: 0, width: 1280, height: 800 }, children: [code] }])).toEqual(["#spill"])
	expect(marked(textOverflow, [{ style: { "overflow-x": "auto" }, rect: { x: 1100, y: 40, width: 120, height: 80 }, children: [code] }])).toEqual([])
})

test("#given code clipped in a terminal window #then its intentional crop is not harmful overflow", () => {
	expect(marked(textOverflow, [clip(spill)])).toEqual(["#spill"])
	expect(marked(textOverflow, [clip({ ...spill, tag: "pre" })])).toEqual([])
})

test("#given a generated suffix and an image replacement #then only painted overflow reports", () => {
	const suffix = { ...spill, lineRects: lines([50], 40, 40), after: { content: '" and a very long generated suffix"' } }
	expect(marked(textOverflow, [clip(suffix)])).toEqual(["#spill"])
	expect(marked(textOverflow, [clip({ ...spill, lineRects: lines([300], -9999, 40) })])).toEqual([])
})

test("#given an SVG text node #then HTML overflow rules do not judge its graphics coordinate space", () => {
	expect(marked(textOverflow, [clip({ tag: "svg", children: [{ ...spill, tag: "text" }] })])).toEqual([])
})

test("#given a clamped overflow box #then the intentional truncation is not a spill", () => {
	const clamped = { ...spill, style: { "overflow-x": "hidden", "-webkit-line-clamp": "2" } }
	expect(marked(textOverflow, [clip(clamped)])).toEqual([])
	expect(marked(textOverflow, [clip({ ...clamped, style: { ...clamped.style, "-webkit-line-clamp": "none" } })])).toEqual(["#spill"])
})

test("#given text in the overflow clip margin #then that visible spill is still reported", () => {
	const label = { ...spill, rect: { x: 40, y: 62, width: 120, height: 20 }, lineRects: lines([300], 40, 62) }
	const host = { style: { "overflow-x": "clip", "overflow-y": "clip", "overflow-clip-margin": "24px" },
		rect: { x: 20, y: 20, width: 200, height: 40 }, children: [label] }
	expect(marked(textOverflow, [host])).toEqual(["#spill"])
	expect(marked(textOverflow, [{ ...host, style: { ...host.style, "overflow-clip-margin": "0px" } }])).toEqual([])
	expect(marked(textOverflow, [{ ...host, style: { ...host.style, "overflow-x": "hidden", "overflow-y": "hidden" } }])).toEqual([])
})

test("#given a running finite width animation #then its temporary opening spill is not reported", () => {
	const css = "@keyframes type { from { width: 0 } to { width: 100% } }"
	const style = { "animation-name": "type", "animation-iteration-count": "1", "animation-play-state": "running" }
	const moving = { ...spill, motion: ["width"], style }
	expect(marked(textOverflow, [clip(moving)], { cssText: [css] })).toEqual([])
	expect(marked(textOverflow, [clip({ ...moving, motion: [] })], { cssText: [css] })).toEqual(["#spill"])
	expect(marked(textOverflow, [clip({ ...moving, style: { ...style, "animation-iteration-count": "infinite" } })], { cssText: [css] })).toEqual(["#spill"])
	expect(marked(textOverflow, [clip(moving)])).toEqual(["#spill"])
})

test("#given a running inline size transition #then a finite named transition can explain the opening box", () => {
	const moving = { ...spill, motion: ["inline-size"], style: { "transition-property": "inline-size", "transition-duration": "200ms" } }
	expect(marked(textOverflow, [clip(moving)])).toEqual([])
	expect(marked(textOverflow, [clip({ ...moving, style: { ...moving.style, "transition-duration": "0s" } })])).toEqual(["#spill"])
})
