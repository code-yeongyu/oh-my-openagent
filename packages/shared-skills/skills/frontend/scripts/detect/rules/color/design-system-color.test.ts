import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { designSystemColor } from "./design-system-color"

test("#given declared colors and visible drift #then only undocumented dimensions report once", () => {
	const snapshot = buildSnapshot([
		{ id: "allowed", text: "Declared", style: { color: "#151515", "background-color": "#ffffff" } },
		{ id: "text", text: "Drift", style: { color: "#ef4444" } },
		{ id: "repeat", text: "Repeat", style: { color: "#ef4444" } },
		{ id: "border", style: { "border-top-width": "1px", "border-top-color": "#ef4444" } },
		{ id: "outline", style: { "outline-width": "2px", "outline-color": "#3b82f6" } },
		{ id: "transparent", style: { "background-color": "rgba(255,0,0,0.01)" } },
		{ id: "hidden", text: "Hidden", style: { color: "#ef4444", display: "none" } },
	])
	const config = { designTokens: { colors: ["#111111", "#ffffff"] } }
	expect(designSystemColor.check({ snapshot, config }).map((h) => h.element?.selector)).toEqual(["#text", "#border", "#outline"])
	expect(designSystemColor.check({ snapshot, config: {} })).toEqual([])
})

test("#given transparent tokens and six channel units of tolerance #then larger drift still reports", () => {
	const snapshot = buildSnapshot([
		{ id: "near", text: "Near token", style: { color: "#171717" } },
		{ id: "far", text: "Outside token", style: { color: "#181818" } },
	])
	expect(designSystemColor.check({ snapshot, config: { designTokens: { colors: ["#111111"] } } }).map((h) => h.element?.selector)).toEqual(["#far"])
})
