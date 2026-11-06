import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { gradientText } from "./gradient-text"

test("#given multicolor, alpha-only and flat text fills #then only visible ramps report", () => {
	const snapshot = buildSnapshot([
		...Object.entries({ ramp: "linear-gradient(#db2777, #7c3aed)", sheen: "linear-gradient(rgb(255,255,255), rgba(255,255,255,0.5))", flat: "linear-gradient(#111111, #111111)" }).map(([id, image]) => ({ id, text: "A headline", style: { "background-clip": "text", "background-image": image } })),
		{ id: "faint", text: "A watermark", style: { opacity: "0.08", "background-clip": "text", "background-image": "linear-gradient(#db2777, #7c3aed)" } },
		{ id: "solid", text: "A normal headline" },
		{ id: "layered", text: "Two clipped layers", style: { "background-clip": "text, text", "-webkit-background-clip": "text, text", "background-image": "linear-gradient(#db2777, #7c3aed), linear-gradient(#2563eb, #06b6d4)" } },
		{ id: "utility", tag: "h2", text: "An uncompiled utility heading", attributes: { class: "bg-clip-text bg-gradient-to-r" } },
	])
	expect(gradientText.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#ramp", "#sheen", "#utility"])
})

test("#given a sweeping shimmer, paused shimmer and rainbow fallback #then only the loading shimmer passes", () => {
	const base = { "background-clip": "text", "background-size": "200% 100%", "animation-name": "shimmer", "animation-iteration-count": "infinite", color: "rgba(0,0,0,0.38)", "background-image": "linear-gradient(90deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.38) 30%, rgba(36,35,28,0.92) 55%, rgba(0,0,0,0.38) 70%, rgba(0,0,0,0.38) 100%)" }
	const snapshot = buildSnapshot([
		{ id: "shimmer", text: "Working", style: base },
		{ id: "paused", text: "Working", style: { ...base, "animation-play-state": "paused" } },
		{ id: "rainbow", text: "A sweeping rainbow", style: { ...base, color: "#ff0080", "background-image": "linear-gradient(#ff0080 0%, #7928ca 30%, #2563eb 70%, #ff0080 100%)" } },
	], { cssText: ["@keyframes shimmer { from { background-position-x: 200%; } to { background-position-x: -200%; }}"] })
	expect(gradientText.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#paused", "#rainbow"])
})
