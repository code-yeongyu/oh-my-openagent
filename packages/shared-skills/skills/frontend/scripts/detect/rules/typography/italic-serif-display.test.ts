import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { italicSerifDisplay } from "./italic-serif-display"

test("#given italic serif heroes and roman or sans controls #then only serif heroes report", () => {
	const snapshot = buildSnapshot([
		...["Fraunces", "Recoleta", "Playfair Display", "CustomSerifFace"].map((f, i) =>
			({ id: `flag-${i}`, tag: "h1", text: "Display heading", style: { "font-size": "56px", "font-style": "italic", "font-family": `"${f}", serif` } })),
		{ tag: "h1", text: "Sans Italic Display", style: { "font-family": "Karla, sans-serif", "font-size": "64px", "font-style": "italic" } },
		{ tag: "h1", text: "Roman Serif Display", style: { "font-family": "Fraunces, serif", "font-size": "88px" } },
		{ tag: "blockquote", text: "Pull quote", style: { "font-family": "Georgia, serif", "font-size": "64px", "font-style": "italic" } },
		{ tag: "h2", text: "Small italic heading", style: { "font-size": "32px", "font-style": "italic" } },
	])
	expect(italicSerifDisplay.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#flag-0", "#flag-1", "#flag-2", "#flag-3"])
})

test("#given several italic descendants in one roman heading #then one heading finding reports", () => {
	const style = { "font-size": "72px", "font-style": "italic", "font-family": "Georgia, serif" }
	const snapshot = buildSnapshot([
		{ id: "hero", tag: "h1", children: [{ tag: "em", text: "One", style }, { tag: "em", text: "Two", style }] },
		{ tag: "h1", children: [{ tag: "em", text: "Invisible", style: { ...style, display: "none" } }] },
	])
	expect(italicSerifDisplay.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#hero"])
})
