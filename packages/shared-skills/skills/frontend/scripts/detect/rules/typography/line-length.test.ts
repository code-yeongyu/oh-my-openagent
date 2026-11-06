import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { lineLength } from "./line-length"

const text = "Reading copy across a column this wide makes the eye travel far back to the start of every line. ".repeat(3)
const lines = (widths: readonly number[]) => widths.map((width, i) => ({ x: 0, y: i * 24, width, height: 18 }))

test("#given actual rendered line widths and short tails #then two long lines are required", () => {
	const snapshot = buildSnapshot([
		{ id: "wide", tag: "p", text, lineRects: lines([1000, 1000, 900]) },
		{ tag: "p", text: "An ordinary note that only renders on one line.", lineRects: lines([1100]) },
		{ tag: "p", text, lineRects: lines([1000, 100]) },
		{ tag: "p", text, lineRects: lines([500, 500, 500, 500, 500]) },
		{ tag: "p", text, lineRects: [] },
	])
	expect(lineLength.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#wide"])
})

test("#given inline children, nested lists and hidden source #then only each block's rendered text is counted", () => {
	const snapshot = buildSnapshot([
		{ id: "inline", tag: "p", children: [
			{ tag: "b", text: text.slice(0, 140), style: { display: "inline" }, lineRects: lines([1000, 300]) },
			{ tag: "i", text: text.slice(140), style: { display: "inline" }, lineRects: [{ x: 300, y: 24, width: 700, height: 18 }, { x: 0, y: 48, width: 900, height: 18 }] },
		] },
		{ id: "heading-item", tag: "li", text: "Fast Refresh Fixes", children: [{ tag: "ul", children: [
			{ tag: "li", text: "One nested item with a single line", lineRects: lines([600]) },
		] }] },
		{ tag: "p", text: "A comfortable measure with fewer than eighty characters per line. ".repeat(2), lineRects: lines([500, 500]), children: [
			{ tag: "span", text: text.repeat(3), style: { display: "none" }, lineRects: lines([1000, 1000]) },
			{ tag: "style", text: text.repeat(3) },
		] },
		{ id: "generic", text, lineRects: lines([1000, 1000, 900]) },
	])
	expect(lineLength.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#inline", "#generic"])
})

test("#given legal blocks and long own list prose #then only the list's own long lines report", () => {
	const snapshot = buildSnapshot([
		{ id: "list", tag: "li", text, lineRects: lines([1000, 1000, 900]), children: [{ tag: "ul", children: [{ tag: "li", text: "Nested short item" }] }] },
		{ tag: "p", text, style: { "font-size": "14px" }, lineRects: lines([1000, 1000, 900]), attributes: { class: "legal" } },
	])
	expect(lineLength.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#list"])
})
