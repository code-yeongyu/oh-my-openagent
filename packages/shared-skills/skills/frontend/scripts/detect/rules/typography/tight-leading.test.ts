import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { tightLeading } from "./tight-leading"

const text = "This card description is reading copy long enough to wrap over several lines in a narrow column."
const lines = (count: number, height = 20) => Array.from({ length: count }, (_, i) => ({ x: 0, y: i * height, width: 240, height: 18 }))

test("#given multiline body copy, bold titles and heading wrappers #then only crowded body runs report", () => {
	const style = { "font-size": "16px", "line-height": "20px" }
	const snapshot = buildSnapshot([
		{ id: "body", tag: "p", text, style, lineRects: lines(4) },
		{ id: "bold-body", tag: "p", text, style: { ...style, "font-weight": "700" }, lineRects: lines(4) },
		{ id: "medium-title", text, style: { ...style, "font-weight": "500" }, lineRects: lines(2) },
		{ text, style: { ...style, "font-weight": "600" }, lineRects: lines(2) },
		{ text, style: { "font-size": "32px", "line-height": "36px" }, lineRects: lines(3, 36) },
		{ tag: "h2", children: [{ text, style, lineRects: lines(4) }] },
		{ tag: "h3", children: [{ id: "nested-prose", tag: "p", text, style, lineRects: lines(4) }] },
		{ text, style, lineRects: lines(1) },
	])
	expect(tightLeading.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#body", "#bold-body", "#medium-title", "#nested-prose"])
})

test("#given lead text and capital labels with long-run controls #then exemption limits are enforced", () => {
	const snapshot = buildSnapshot([
		{ text, style: { "font-size": "22px", "line-height": "26.4px" }, lineRects: lines(3, 26.4) },
		{ id: "long-lead", text, style: { "font-size": "22px", "line-height": "26.4px" }, lineRects: lines(4, 26.4) },
		{ id: "solid-lead", text, style: { "font-size": "22px", "line-height": "22px" }, lineRects: lines(2, 22) },
		{ text, style: { "font-size": "12px", "line-height": "13.2px", "text-transform": "uppercase" }, lineRects: lines(3, 13.2) },
		{ id: "caps-paragraph", text, style: { "font-size": "12px", "line-height": "13.2px", "text-transform": "uppercase" }, lineRects: lines(4, 13.2) },
		{ id: "caps-overlap", text, style: { "font-size": "12px", "line-height": "10.8px", "text-transform": "uppercase" }, lineRects: lines(3, 10.8) },
		{ text, style: { "font-size": "18px", "line-height": "23.4px" }, lineRects: lines(3, 23.4) },
	])
	expect(tightLeading.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#long-lead", "#solid-lead", "#caps-paragraph", "#caps-overlap"])
})

test("#given inline struts and preformatted text #then actual block pitch and code exemptions apply", () => {
	const snapshot = buildSnapshot([
		{ style: { "line-height": "22px" }, children: [{ tag: "span", text, style: { "font-size": "12px", "line-height": "11.4px" }, lineRects: lines(3, 22) }] },
		{ id: "proportional-pre", tag: "pre", text, style: { "font-family": "Inter", "font-size": "12px", "line-height": "15px", "white-space": "pre-wrap" }, lineRects: lines(4, 15) },
		{ tag: "pre", text, style: { "font-family": "monospace", "font-size": "12px", "line-height": "15px", "white-space": "pre-wrap" }, lineRects: lines(4, 15) },
	])
	expect(tightLeading.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#proportional-pre"])
})

test("#given wrapping flex rows of text runs #then only a row whose run wraps inside its own item reports", () => {
	const row = { display: "flex", "flex-wrap": "wrap", "font-size": "12px", "line-height": "14px" }
	const long = "The first item of this flex row is a whole sentence of reading copy, long enough to wrap inside its own box"
	const snapshot = buildSnapshot([
		{ id: "long-run", tag: "p", text: `${long} Short note`, textRuns: [long, "Short note"], style: row, rect: { width: 260 }, scroll: { clientWidth: 260 }, lineRects: lines(4, 14) },
		{ id: "short-runs", tag: "p", text: "100 free lead searches 14-day trial No card needed Cancel anytime", textRuns: ["100 free lead searches", "14-day trial", "No card needed", "Cancel anytime"], style: row, rect: { width: 260 }, scroll: { clientWidth: 260 }, lineRects: lines(3, 14) },
		{ id: "nowrap-runs", tag: "p", text: "100 free lead searches 14-day trial No card needed Cancel anytime", textRuns: ["100 free lead searches", "14-day trial", "No card needed", "Cancel anytime"], style: { ...row, "flex-wrap": "nowrap" }, rect: { width: 260 }, scroll: { clientWidth: 260 }, lineRects: lines(3, 14) },
	])
	expect(tightLeading.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#long-run", "#nowrap-runs"])
})
