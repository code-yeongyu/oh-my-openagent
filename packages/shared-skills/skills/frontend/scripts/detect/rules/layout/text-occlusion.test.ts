import { expect, test } from "bun:test"
import type { NodeSpec } from "../../testing/build-snapshot"
import { textOcclusion } from "./text-occlusion"
import { lines, marked } from "./support/layout-cases"

const text: NodeSpec = { id: "text", tag: "p", text: "Root cause identified in four minutes", style: { position: "absolute" }, rect: { x: 40, y: 40, width: 300, height: 24 }, lineRects: lines([300], 40, 40) }
const cover: NodeSpec = { id: "cover", style: { position: "absolute", "z-index": "5", "background-color": "#222" }, rect: { x: 40, y: 40, width: 240, height: 60 } }

test("#given an opaque overlap and a transparent control #then only painted coverage reports", () => {
	expect(marked(textOcclusion, [text, cover])).toEqual(["#text"])
	expect(marked(textOcclusion, [text, { ...cover, style: { ...cover.style, opacity: "0" } }])).toEqual([])
	expect(marked(textOcclusion, [text, { ...cover, style: { position: "absolute", "z-index": "5" } }])).toEqual([])
})

test("#given pinned overlays and text above its background #then neither is occlusion", () => {
	expect(marked(textOcclusion, [text, cover])).toEqual(["#text"])
	expect(marked(textOcclusion, [text, { ...cover, style: { ...cover.style, position: "fixed" } }])).toEqual([])
	expect(marked(textOcclusion, [{ ...text, style: { position: "absolute", "z-index": "10" } }, cover])).toEqual([])
})

test("#given a short overlap and a clipping scrollbox #then unseen or tiny coverage does not count", () => {
	expect(marked(textOcclusion, [text, cover])).toEqual(["#text"])
	expect(marked(textOcclusion, [text, { ...cover, rect: { x: 40, y: 40, width: 40, height: 60 } }])).toEqual([])
	expect(marked(textOcclusion, [{ style: { "overflow-y": "auto" }, rect: { x: 20, y: 0, width: 400, height: 30 }, children: [text] }, cover])).toEqual([])
})

test("#given one pixel type scaled to readable geometry #then it collides while a one pixel dot does not", () => {
	const caption = { ...text, id: "caption", style: {}, lineRects: lines([240], 40, 40) }
	const label = { ...text, id: "label", text: "Limited offer today", style: { position: "absolute", "font-size": "1px" }, rect: { x: 40, y: 40, width: 165, height: 16 }, lineRects: lines([165], 40, 40, 16) }
	expect(marked(textOcclusion, [caption, label])).toEqual(["#caption", "#label"])
	expect(marked(textOcclusion, [caption, { ...label, rect: { x: 40, y: 40, width: 10, height: 1 }, lineRects: lines([10], 40, 40, 1) }])).toEqual([])
})

test("#given a single emoji or an edge sliver #then neither is a readable occlusion victim", () => {
	expect(marked(textOcclusion, [{ ...text, text: "\u{1f600}" }, cover])).toEqual([])
	expect(marked(textOcclusion, [{ ...text, rect: { x: -250, y: 40, width: 300, height: 24 }, lineRects: lines([300], -250, 40) }, cover])).toEqual([])
})
