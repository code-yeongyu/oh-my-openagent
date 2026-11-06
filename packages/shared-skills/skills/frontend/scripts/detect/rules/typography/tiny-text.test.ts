import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { tinyText } from "./tiny-text"

test("#given tiny prose beside labels, code and fine print #then only running prose reports", () => {
	const text = "This is a longer sentence of ordinary reading copy."
	const style = { "font-size": "11px" }
	const snapshot = buildSnapshot([
		{ id: "body", tag: "p", text, style },
		{ tag: "p", text, style: { "font-size": "12px" } },
		{ tag: "button", text, style },
		{ tag: "sup", text, style },
		{ tag: "p", text, style: { ...style, "text-transform": "uppercase" } },
		{ text: "ANIMATION AND CINEMATIC THREE DIMENSIONS", style },
		{ tag: "p", text, style: { ...style, "font-family": "IBM Plex Mono", "white-space": "pre-wrap" } },
		{ text, style, attributes: { class: "legal" } },
	])
	expect(tinyText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#body"])
})

test("#given SVG text scaled by viewBox and uniform transforms #then drawn sizes control findings", () => {
	const text = "Cited report with sources for every claim"
	const snapshot = buildSnapshot([
		{ tag: "svg", attributes: { viewBox: "0 0 400 200" }, rect: { width: 200, height: 100 }, children: [
			{ id: "shrunk", tag: "text", text, style: { "font-size": "14px" } },
		] },
		{ tag: "svg", attributes: { viewBox: "0 0 200 100" }, rect: { width: 400, height: 200 }, children: [
			{ tag: "text", text, style: { "font-size": "10px" } },
		] },
		{ tag: "svg", attributes: { viewBox: "0 0 400 100" }, rect: { width: 400, height: 100 }, children: [
			{ id: "group", tag: "text", text, style: { "font-size": "14px", transform: "matrix(0.5, 0, 0, 0.5, 0, 0)" } },
			{ tag: "text", text, style: { "font-size": "10px", transform: "matrix(1.5, 0, 0, 1.5, 0, 0)" } },
		] },
	])
	expect(tinyText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#shrunk", "#group"])
})

test("#given fine-print markers at different depths #then only actual small legal blocks are exempt", () => {
	const text = "Requires a qualifying plan and a new account. Restrictions apply to every purchase."
	const style = { "font-size": "11px" }
	const snapshot = buildSnapshot([
		{ text, style, attributes: { id: "disclaimer-2" } },
		{ attributes: { class: "disclaimers" }, children: [{ tag: "li", children: [{ text, style }] }] },
		{ attributes: { class: "legal-page" }, children: [{ children: [{ children: [{ children: [{ id: "deep", text, style }] }] }] }] },
		{ id: "type", text, style, attributes: { class: "text-footnote" } },
		{ tag: "details", attributes: { open: "", class: "footnote-accordion" }, children: [{ id: "accordion", text, style }] },
		{ id: "terms", text, style, attributes: { class: "offer-terms" } },
	])
	expect(tinyText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#deep", "#type", "#accordion", "#terms"])
})

test("#given overflowing text on zero-size anchors #then visible glyphs report while clipped glyphs do not", () => {
	const text = "Harbour office, open nine to five"
	const style = { "font-size": "10px" }
	const snapshot = buildSnapshot([
		{ id: "pin", tag: "span", text, style, rect: { width: 0, height: 0 }, lineRects: [{ x: 0, y: 0, width: 150, height: 12 }] },
		{ text, style: { ...style, "overflow-x": "hidden", "overflow-y": "hidden" }, rect: { width: 0, height: 0 }, lineRects: [{ x: 0, y: 0, width: 150, height: 12 }] },
	])
	expect(tinyText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#pin"])
})
