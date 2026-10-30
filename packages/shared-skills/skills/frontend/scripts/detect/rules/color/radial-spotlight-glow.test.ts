import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { radialSpotlightGlow } from "./radial-spotlight-glow"

test("#given colored translucent spotlights and faint or opaque cousins #then only prominent low alpha glows report", () => {
	const snapshot = buildSnapshot([{ style: { "background-color": "#0b0d13" }, children: Object.entries({
		blue: "radial-gradient(circle, rgba(80,111,255,0.26), transparent 44%)",
		rose: "radial-gradient(circle, rgba(255,90,120,0.12), rgba(255,90,120,0.28), transparent)",
		hex: "radial-gradient(circle, #506fff66, transparent)",
		faint: "radial-gradient(circle, rgba(26,189,226,0.1), transparent)",
		opaque: "radial-gradient(circle, rgba(80,111,255,0.85), transparent)",
		neutral: "radial-gradient(circle, rgba(255,255,255,0.35), transparent)",
		linear: "linear-gradient(rgba(80,111,255,0.28), transparent)",
	}).map(([id, image], i) => ({ id, text: "Section headline", rect: { width: 900, height: 600, y: i * 700 }, style: { "background-image": image } })) }])
	expect(radialSpotlightGlow.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#blue", "#rose", "#hex"])
})

test("#given pale layers, small badges, bare panels and photo heroes #then only a bright photo overlay reports", () => {
	const image = "radial-gradient(circle, rgba(139,92,246,0.42), transparent)"
	const snapshot = buildSnapshot([
		{ id: "photo", text: "Hero headline", rect: { width: 900, height: 600 }, style: { "background-image": `${image}, url(photo.jpg)` } },
		{ id: "small", text: "Badge", rect: { width: 40, height: 40, y: 700 }, style: { "background-image": image } },
		{ id: "bare", rect: { width: 900, height: 600, y: 800 }, style: { "background-image": image } },
		{ id: "pale", text: "Pale headline", rect: { width: 900, height: 600, y: 1500 }, style: { "background-image": "radial-gradient(circle, rgba(63,227,223,0.2), transparent), linear-gradient(#ecf4f8, #ffffff)" } },
	])
	expect(radialSpotlightGlow.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#photo"])
})
