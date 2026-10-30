import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { grayOnColor } from "./gray-on-color"

test("#given gray inks on navy, teal and amber #then only chromatic non-pale surfaces report", () => {
	const snapshot = buildSnapshot([
		...Object.entries({ navy: "#1e3a8a", teal: "#115e59", darkNavy: "#001c47", nearBlack: "#04002d", cream: "#feeed4", tint: "#fef3c7", neutral: "#f3f4f6" }).map(([id, bg]) => ({ id, text: "Some gray copy", style: { color: "#d1d5db", "background-color": bg } })),
		{ id: "amber", text: "Gray six hundred", style: { color: "#4b5563", "background-color": "#fcd34d" } },
	])
	expect(grayOnColor.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#navy", "#teal", "#darkNavy", "#amber"])
})

test("#given neutral extremes and utility variants #then gray classes only report resting chromatic fills", () => {
	const snapshot = buildSnapshot([
		{ id: "gray", text: "Gray utility", attributes: { class: "text-gray-400 bg-blue-600" } },
		{ id: "hover", text: "Hover not resting", attributes: { class: "text-gray-500 bg-white hover:bg-emerald-400" } },
		{ id: "black", text: "Near black", style: { color: "#393939", "background-color": "#ffc224" } },
		{ id: "white", text: "Near white", style: { color: "#e5e7eb", "background-color": "#115e59" } },
		{ id: "near-black-class", text: "Dark utility", attributes: { class: "text-gray-800 bg-yellow-400" } },
	])
	expect(grayOnColor.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#gray"])
})

test("#given utility wrappers without direct text and bare inherited spans #then only the full color path reports", () => {
	const snapshot = buildSnapshot([
		{ id: "wrapper", attributes: { class: "text-gray-400 bg-blue-600" }, children: [{ text: "Wrapper copy" }] },
		{ style: { "background-color": "#1e3a8a" }, children: [
			{ id: "bare", tag: "span", text: "Bare gray text", style: { color: "#999999" } },
			{ id: "paragraph", tag: "p", text: "Gray paragraph", style: { color: "#999999" } },
		] },
	])
	expect(grayOnColor.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#wrapper", "#paragraph"])
})

test("#given both a gray utility and measured gray ink #then preserves both upstream forms on the same element", () => {
	const snapshot = buildSnapshot([{ id: "dual", attributes: { class: "text-gray-400 bg-blue-600" }, text: "Measured utility",
		style: { color: "#999999", "background-color": "#1e40af" } }])
	expect(grayOnColor.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#dual", "#dual"])
})
