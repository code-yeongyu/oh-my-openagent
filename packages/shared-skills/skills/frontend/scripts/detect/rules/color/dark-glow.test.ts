import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { darkGlow } from "./dark-glow"

test("#given colored halos, dark elevation and neutral shadows #then only perceptible colored light reports", () => {
	const snapshot = buildSnapshot([{ style: { "background-color": "#080808" }, children: [
		{ id: "halo", style: { "box-shadow": "rgba(0,169,255,0.6) 0px 0px 24px 0px" } },
		{ id: "offset", style: { "box-shadow": "rgba(0,169,255,0.6) 0px 4px 24px 0px" } },
		{ id: "neutral", style: { "box-shadow": "rgba(0,0,0,0.6) 0px 4px 24px 0px" } },
		{ id: "faint", style: { "box-shadow": "rgba(149,100,255,0.1) 0px 4px 20px 0px" } },
		{ id: "contracted", style: { "box-shadow": "rgba(52,211,153,0.4) 0px 0px 40px -22px" } },
		{ id: "indicator", rect: { width: 6, height: 6 }, style: { "box-shadow": "rgba(0,169,255,0.6) 0px 0px 24px 0px" } },
	] }])
	expect(darkGlow.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#halo", "#offset"])
})

test("#given light surfaces and inherited text shadows #then zero offset halos report once", () => {
	const snapshot = buildSnapshot([
		{ id: "light-halo", style: { "box-shadow": "rgba(59,130,246,0.8) 0px 0px 24px 0px" } },
		{ id: "light-offset", style: { "box-shadow": "rgba(59,130,246,0.8) 0px 4px 24px 0px" } },
		{ id: "text", text: "Glow", style: { "text-shadow": "rgb(255,90,120) 0px 0px 12px" }, children: [{ id: "inherited", text: "Child", style: { "text-shadow": "rgb(255,90,120) 0px 0px 12px" } }] },
	])
	expect(darkGlow.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#light-halo", "#text"])
})

test("#given pseudo shadows and keyframes absent from computed shadows #then the live page form reports once", () => {
	const snapshot = buildSnapshot([
		{ style: { "background-color": "#080808" }, children: [
			{ id: "orb", after: { "box-shadow": "rgba(34,197,94,0.7) 0px 0px 18px" } },
		] },
	])
	expect(darkGlow.check({ snapshot, config: {} }).map((h) => h.element)).toEqual([null])
	const cssText = ["@keyframes breathe { 50% { box-shadow: 0 0 14px rgba(255,0,200,0.5); } }"]
	const live = buildSnapshot([{ style: { "animation-name": "breathe", "animation-iteration-count": "infinite" } }], { cssText })
	const dead = buildSnapshot([{ style: { "animation-name": "breathe", display: "none" } }], { cssText })
	expect(darkGlow.check({ snapshot: live, config: {} }).map((h) => h.element)).toEqual([null])
	expect(darkGlow.check({ snapshot: dead, config: {} })).toEqual([])
})

test("#given an offset glow over the light end of a gradient #then the mean dark surface cannot create a glow", () => {
	const snapshot = buildSnapshot([
		{ rect: { width: 400, height: 400 }, style: { "background-image": "linear-gradient(#080808 0%, #080808 60%, #ffffff 70%)" }, children: [
			{ id: "light", rect: { x: 20, y: 320, width: 160, height: 44 }, style: { "box-shadow": "rgba(146,99,233,0.9) 0px 4px 24px" } },
		] },
	])
	expect(darkGlow.check({ snapshot, config: {} })).toEqual([])
})
