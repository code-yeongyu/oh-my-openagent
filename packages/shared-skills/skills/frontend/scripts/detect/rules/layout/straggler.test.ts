import { expect, test } from "bun:test"
import { straggler } from "./straggler"
import { lines, marked } from "./support/layout-cases"

const text = "Line breaks decide how a block of text sits on the page, and one word alone on the last line leaves a hole under the text."
const paragraph = { id: "copy", tag: "p", text, rect: { x: 24, y: 24, width: 390, height: 96 }, lineRects: lines([390, 390, 350, 50]) }

test("#given a short one word tail and a filled final line #then only the straggler reports", () => {
	expect(marked(straggler, [paragraph])).toEqual(["#copy"])
	expect(marked(straggler, [{ ...paragraph, lineRects: lines([390, 390, 350, 250]) }])).toEqual([])
})

test("#given authored breaks and chosen wrapping #then paragraph wrap is not second guessed", () => {
	expect(marked(straggler, [paragraph])).toEqual(["#copy"])
	expect(marked(straggler, [{ ...paragraph, style: { "text-wrap": "pretty" } }])).toEqual([])
	expect(marked(straggler, [{ ...paragraph, style: { "text-wrap": "balance" } }])).toEqual([])
	expect(marked(straggler, [{ ...paragraph, children: [{ tag: "br" }] }])).toEqual([])
})

test("#given narrow columns and inline pictures #then the one face estimate is not applied", () => {
	expect(marked(straggler, [paragraph])).toEqual(["#copy"])
	expect(marked(straggler, [{ ...paragraph, text: "Billing settings and invoice history", lineRects: lines([150, 150, 40]) }])).toEqual([])
	expect(marked(straggler, [{ ...paragraph, children: [{ tag: "img" }] }])).toEqual([])
})

test("#given lines hidden by a clamp #then the hidden tail is not called a straggler", () => {
	expect(marked(straggler, [paragraph])).toEqual(["#copy"])
	expect(marked(straggler, [{ ...paragraph, style: { "overflow-y": "hidden" }, rect: { x: 24, y: 24, width: 390, height: 40 } }])).toEqual([])
})

test("#given an auto scrolling ancestor #then a reachable last line is still measured", () => {
	expect(marked(straggler, [{ style: { "overflow-y": "auto" }, rect: { x: 24, y: 24, width: 400, height: 40 }, children: [paragraph] }])).toEqual(["#copy"])
})
