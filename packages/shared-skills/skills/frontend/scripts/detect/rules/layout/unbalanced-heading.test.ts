import { expect, test } from "bun:test"
import { unbalancedHeading } from "./unbalanced-heading"
import { lines, marked } from "./support/layout-cases"

const heading = { id: "heading", tag: "h2", text: "Design that holds up under real content and real people", rect: { x: 24, y: 24, width: 500, height: 60 }, lineRects: lines([500, 80]) }

test("#given two heading lines with a tiny tail #then only the unbalanced heading reports", () => {
	expect(marked(unbalancedHeading, [heading])).toEqual(["#heading"])
	expect(marked(unbalancedHeading, [{ ...heading, lineRects: lines([500, 400]) }])).toEqual([])
})

test("#given authored balance and deliberate breaks #then heading line intent is respected", () => {
	expect(marked(unbalancedHeading, [heading])).toEqual(["#heading"])
	expect(marked(unbalancedHeading, [{ ...heading, style: { "text-wrap": "balance" } }])).toEqual([])
	expect(marked(unbalancedHeading, [{ ...heading, children: [{ tag: "br" }] }])).toEqual([])
})

test("#given long statements and two word headings #then the balance rule stands down", () => {
	expect(marked(unbalancedHeading, [heading])).toEqual(["#heading"])
	expect(marked(unbalancedHeading, [{ ...heading, lineRects: lines([500, 500, 500, 80]) }])).toEqual([])
	expect(marked(unbalancedHeading, [{ ...heading, text: "Documentation hub" }])).toEqual([])
})
