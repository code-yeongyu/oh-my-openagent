import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { radialHalo } from "./radial-halo"

test("#given dark radial washes and alternate gradients #then only saturated wide halos report", () => {
	const snapshot = buildSnapshot([{ style: { "background-color": "#080808" }, children: [
		...Object.entries({
			halo: "radial-gradient(circle, rgba(80,111,255,0.85), transparent 70%)",
			second: "radial-gradient(circle, rgba(255,90,120,0.85), transparent 70%)",
			soft: "radial-gradient(circle, rgba(80,111,255,0.3), transparent)",
			neutral: "radial-gradient(circle, rgba(255,255,255,0.85), transparent)",
			opaque: "radial-gradient(circle, #1e3a8a, #0f172a)",
			linear: "linear-gradient(#506fff, transparent)",
			small: "radial-gradient(circle, #506fff 0px, transparent 20px)",
			repeat: "repeating-radial-gradient(circle, #506fff, transparent)",
			vignette: "radial-gradient(circle, #020408, transparent)",
		}).map(([id, image]) => ({ id, style: { "background-image": image } })),
	] }])
	expect(radialHalo.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#halo"])
})

test("#given pseudo halos on dark and light grounds #then only dark visible hosts report", () => {
	const before = { "background-image": "radial-gradient(circle, #506fff, transparent)" }
	const snapshot = buildSnapshot([
		{ id: "dark", style: { "background-color": "#080808" }, before },
		{ id: "light", style: { "background-color": "#ffffff" }, before },
		{ id: "hidden", style: { "display": "none", "background-color": "#080808" }, before },
	])
	expect(radialHalo.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#dark"])
})

test("#given a light page with a local translucent panel #then the panel does not turn on the dark-page source form", () => {
	const base = buildSnapshot([
		{ style: { "background-color": "rgba(18,20,26,0.86)" }, children: [
			{ style: { "background-image": "radial-gradient(circle, #a855f7, transparent 70%)" } },
		] },
	], { cssText: ["body { background: #fff; } .glass { background: rgba(18,20,26,0.86); }"] })
	const snapshot = { ...base, elements: base.elements.map((el) => el.tag === "body" ? { ...el, style: { ...el.style, "background-color": "#ffffff" } } : el) }
	expect(radialHalo.check({ snapshot, config: {} })).toEqual([])
})
