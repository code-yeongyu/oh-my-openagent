import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { aiColorPalette } from "./ai-color-palette"

test("#given stock ramps, flat fills, faint washes and blurred ancestors #then visible palette ramps report", () => {
	const ramp = "linear-gradient(#8526fe, #82fff7)"
	const snapshot = buildSnapshot([
		{ id: "stock", style: { "background-image": ramp } },
		{ id: "teal", style: { "background-image": "linear-gradient(#14b8a6, #06b6d4)" } },
		{ id: "emerald", style: { "background-image": "linear-gradient(#059669, #065f46)" } },
		{ id: "sky", style: { "background-image": "linear-gradient(#0ea5e9, #38bdf8)" } },
		{ id: "flat", style: { "background-image": "linear-gradient(#4d148c, #4d148c)" } },
		{ id: "faint", style: { "background-image": "linear-gradient(rgba(133,38,254,0.05), rgba(130,255,247,0.05))" } },
		{ id: "rail", rect: { height: 1 }, style: { "background-image": ramp } },
		{ style: { filter: "blur(120px)" }, children: [{ id: "blur", style: { "background-image": ramp } }] },
		{ id: "covered", style: { "background-image": ramp }, children: [{ tag: "img", style: { "object-fit": "cover" } }] },
	])
	expect(aiColorPalette.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#stock", "#teal"])
})

test("#given violet headings, muted subtitles and brand surfaces #then only unchosen heading colors report", () => {
	const snapshot = buildSnapshot([
		{ id: "subtitle", text: "Violet subtitle", style: { color: "#7c3aed", "font-size": "20px" } },
		{ id: "muted", text: "Muted subtitle", style: { color: "#7a6699", "font-size": "20px" } },
		{ id: "heading", tag: "h2", text: "Muted heading", style: { color: "#7a6699" } },
		{ id: "bare-span", tag: "span", text: "Bare violet label", style: { color: "#7c3aed", "font-size": "24px" } },
	])
	expect(aiColorPalette.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#subtitle", "#heading"])
	const branded = buildSnapshot([
		{ tag: "nav", style: { "background-color": "#5c2d91" }, rect: { width: 1280, height: 50 } },
		{ id: "heading", tag: "h2", text: "Brand heading", style: { color: "#5c2d91" } },
		{ id: "other", tag: "h2", text: "Other violet", style: { color: "#c026d3" } },
	])
	expect(aiColorPalette.check({ snapshot: branded, config: {} }).map((h) => h.element?.selector)).toEqual(["#other"])
})

test("#given two neon hues and a declared palette #then only undeclared paired inks report", () => {
	const snapshot = buildSnapshot([{ style: { "background-color": "#050b0f" }, children: [
		{ id: "cyan", text: "Download", style: { color: "#82fff7" } },
		{ id: "purple", text: "Design", style: { color: "#8526fe" } },
		{ id: "bit", text: "1", style: { color: "#82fff7" } },
		{ id: "neutral", text: "Body copy", style: { color: "#cbd5e1" } },
	] }])
	expect(aiColorPalette.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#cyan", "#purple"])
	expect(aiColorPalette.check({ snapshot, config: { designTokens: { colors: ["#82fff7", "#8526fe"] } } })).toEqual([])
})

test("#given six role colors and an isolated violet heading #then category ink passes but lone ink reports", () => {
	const snapshot = buildSnapshot([
		...["#dc2626", "#ea580c", "#16a34a", "#2563eb", "#7c3aed", "#9333ea"].map((color, i) => ({ id: `category-${i}`, tag: "h3", text: "Category", style: { color, "font-size": "22px", "font-weight": "700" } })),
		{ id: "lone", tag: "h3", text: "Feature", style: { color: "#7c3aed", "font-size": "28px", "font-weight": "700" } },
	])
	expect(aiColorPalette.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#lone"])
})

test("#given a stock accent declaration and a painted carrier #then the page form reports without charging dead tokens", () => {
	const cssText = [".accent { color: #7c3aed; } .unused { color: #9333ea; }"]
	const painted = buildSnapshot([{ tag: "p", attributes: { class: "accent" }, text: "Accent copy", style: { color: "#7c3aed" } }], { cssText })
	expect(aiColorPalette.check({ snapshot: painted, config: {} }).map((h) => h.element)).toEqual([null])
	const dead = buildSnapshot([{ text: "Plain copy" }], { cssText })
	expect(aiColorPalette.check({ snapshot: dead, config: {} })).toEqual([])
	expect(aiColorPalette.check({ snapshot: painted, config: { designTokens: { colors: ["#7c3aed"] } } })).toEqual([])
})

test("#given a parked wipe and an ignored cyan vote #then neither contributes a palette tell", () => {
	const snapshot = buildSnapshot([
		{ id: "wipe", style: { "background-image": "linear-gradient(90deg, #7c3aed 50%, #06b6d4 50%)", "background-size": "200% 100%" } },
		{ style: { "background-color": "#050b0f" }, children: [
			{ id: "purple", text: "Design", style: { color: "#8526fe" } },
			{ id: "waived", text: "Download", attributes: { "data-detect-ignore": "ai-color-palette" }, style: { color: "#82fff7" } },
		] },
	])
	expect(aiColorPalette.check({ snapshot, config: {} })).toEqual([])
})
