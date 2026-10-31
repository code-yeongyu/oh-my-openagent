import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { oversizedH1 } from "./oversized-h1"

test("#given long dominant headlines and contained short controls #then only dominant long headings report", () => {
	const text = "A sweeping product headline that sprawls across the whole viewport and keeps going"
	const snapshot = buildSnapshot([
		{ id: "hero", tag: "h1", text, style: { "font-size": "104px" }, rect: { width: 1040, height: 240 } },
		{ id: "area", tag: "h1", text, style: { "font-size": "72px" }, rect: { width: 1280, height: 210 } },
		{ tag: "h1", text, style: { "font-size": "83px" }, rect: { width: 1120, height: 90 } },
		{ tag: "h1", text: "Bold.", style: { "font-size": "168px" }, rect: { height: 300 } },
		{ tag: "h1", text, style: { "font-size": "40px" }, rect: { height: 300 } },
		{ tag: "h1", text, style: { "font-size": "104px" }, rect: { y: 800, height: 300 } },
	])
	expect(oversizedH1.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#hero", "#area"])
})

test("#given a rotator with hidden alternatives beside a long hero #then only painted words count", () => {
	const snapshot = buildSnapshot([
		{ tag: "h1", text: "Picked you.", style: { "font-size": "120px" }, rect: { height: 300 }, children: [
			{ text: "Claude AI" }, { text: "Every alternative word in the rotator", style: { opacity: "0" } },
		] },
		{ id: "long", tag: "h1", text: "A genuinely long heading that remains on screen.", style: { "font-size": "120px" }, rect: { height: 300 } },
	])
	expect(oversizedH1.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#long"])
})
