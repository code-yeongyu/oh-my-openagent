import { expect, test } from "bun:test"
import { lintSnapshot } from "../../lint"
import { buildSnapshot } from "../../testing/build-snapshot"
import { lowContrast } from "./low-contrast"

const ink = (color: string): Readonly<Record<string, string>> => ({ color, "-webkit-text-fill-color": color })

test("#given small, large and bold text around AA thresholds #then only failures report", () => {
	const snapshot = buildSnapshot([
		{ id: "small-fail", text: "Faint body", style: ink("#777777") },
		{ id: "small-pass", text: "Readable body", style: ink("#767676") },
		{ id: "large-fail", text: "Faint heading", style: { ...ink("#9b9b9b"), "font-size": "24px" } },
		{ id: "large-pass", text: "Readable heading", style: { ...ink("#949494"), "font-size": "24px" } },
		{ id: "bold-fail", text: "Faint bold", style: { ...ink("#9c9c9c"), "font-size": "19px", "font-weight": "700" } },
		{ id: "bold-pass", text: "Readable bold", style: { ...ink("#949494"), "font-size": "19px", "font-weight": "700" } },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#small-fail", "#large-fail", "#bold-fail"])
	expect(lintSnapshot(snapshot, { rules: [lowContrast] }).every((h) => h.severity === "error")).toBe(true)
})

test("#given repeated pairs and an ignored first copy #then one readable claimant counts unwaived copies", () => {
	const snapshot = buildSnapshot([
		{ id: "waived", text: "Waived copy", style: ink("#bbbbbb"), attributes: { "data-detect-ignore": "low-contrast" } },
		{ id: "glyph", text: "𝕏", style: ink("#bbbbbb") },
		{ id: "word", text: "Share this idea", style: ink("#bbbbbb") },
		{ id: "repeat", text: "Share another idea", style: ink("#bbbbbb") },
		{ id: "pass", text: "Readable ink", style: ink("#333333") },
	])
	const hits = lowContrast.check({ snapshot, config: {} })
	expect(hits.map((h) => h.element?.selector)).toEqual(["#word"])
	expect(hits[0]?.message.endsWith("(and 2 more)")).toBe(true)
})

test("#given named heavy cuts and ordinary family names #then only bold cuts get the large text bar", () => {
	const snapshot = buildSnapshot(["ProximaNovaBold", "EMprint Semibold", "Gotham-Black", "Blackletter Text", 'Georgia, "Arial Black"'].map((family, i) => ({
		id: `face-${i}`, text: "Family weight", style: { ...ink("#ffffff"), "background-color": "#ff5757", "font-size": "19px", "font-family": family },
	})))
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#face-3"])
})

test("#given scrims, pseudo faces and parked underlines #then contrast uses the painted surface", () => {
	const snapshot = buildSnapshot([
		{ style: { position: "relative" }, rect: { width: 500, height: 200 }, children: [
			{ style: { position: "absolute", "background-color": "rgba(0,0,0,0.8)" }, rect: { width: 500, height: 200 } },
			{ style: { position: "absolute", "background-color": "rgba(235,230,224,0.3)" }, rect: { width: 500, height: 200 }, children: [
				{ id: "scrim-pass", text: "White title on scrim", style: ink("#f7f5f3") },
			] },
		] },
		{ id: "pseudo-fail", text: "Dark label", rect: { y: 300 }, style: ink("#333333"), before: { "background-color": "#1a1a1a" } },
		{ id: "parked-pass", text: "Readable dark label", rect: { y: 400 }, style: ink("#333333"), before: { "background-color": "#1a1a1a", transform: "matrix(1, 0, 0, 1, -300, 0)" } },
		{ id: "drawn-fail", text: "Ink on itself", rect: { y: 500 }, style: { ...ink("#5d666d"), "background-image": "linear-gradient(#5d666c, #5d666c)", "background-size": "100% 100%" } },
		{ id: "underline-pass", text: "Ink with parked underline", rect: { y: 600 }, style: { ...ink("#5d666c"), "background-image": "linear-gradient(#5d666c, #5d666c)", "background-size": "0px 1px" } },
		{ style: { position: "relative", "background-color": "#ffffff" }, rect: { y: 700, width: 420, height: 100 },
			before: { "background-color": "#312e81", "z-index": "-1" }, children: [
				{ id: "ring-fail", text: "Faint copy inside a border ring", rect: { y: 724 }, style: ink("#b8bcc4") },
			] },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#pseudo-fail", "#drawn-fail", "#ring-fail"])
})

test("#given stacked opaque panels and a mask fade #then hidden text cannot claim a pair", () => {
	const snapshot = buildSnapshot([
		{ rect: { width: 600, height: 200 }, children: [
			{ style: { "z-index": "2", "background-color": "#ffffff" }, rect: { width: 600, height: 200 }, children: [{ id: "active", text: "Faint active copy", style: ink("#a0a0a0") }] },
			{ style: { "z-index": "0", "background-color": "#ffffff" }, rect: { width: 600, height: 200 }, children: [{ id: "covered", text: "Faint covered copy", style: ink("#a1a1a1") }] },
		] },
		{ rect: { y: 300, width: 400, height: 160 }, style: { "mask-image": "linear-gradient(#000000 100px, transparent 140px)" }, children: [
			{ id: "clear", rect: { y: 320 }, text: "Clear zone", style: ink("#a2a2a2") },
			{ id: "masked", rect: { y: 440 }, text: "Masked zone", style: ink("#a3a3a3") },
		] },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#active", "#clear"])
})

test("#given a delayed entrance and a fading loop #then final entrance text reports but loop frames do not", () => {
	const snapshot = buildSnapshot([
		{ style: { opacity: "0", "animation-name": "enter", "animation-iteration-count": "1" }, children: [
			{ id: "enter", tag: "a", text: "Get started", style: ink("#bbbbbb") },
		] },
		{ style: { opacity: "0.2", "animation-name": "cycle", "animation-iteration-count": "infinite" }, children: [
			{ id: "cycle", text: "A loop frame", style: ink("#bbbbbb") },
		] },
		{ id: "readable", text: "Readable copy", style: ink("#111111") },
		{ style: { position: "fixed" }, rect: { x: 1400 }, children: [{ id: "drawer", text: "Parked drawer copy", rect: { x: 1400 }, style: ink("#cccccc") }] },
		{ id: "font-zero", text: "Invisible text", style: { ...ink("#cccccc"), "font-size": "0px" } },
		{ tag: "video", children: [{ id: "fallback", text: "Unpainted fallback", style: ink("#cccccc") }] },
	], { cssText: ["@keyframes enter { from { opacity: 0; } to { opacity: 1; } } @keyframes cycle { 0% { opacity: 0; } 40% { opacity: 1; } 100% { opacity: 0; } }"] })
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#enter"])
})

test("#given alpha ink, inherited surfaces, gradients and disabled controls #then painted failures report", () => {
	const snapshot = buildSnapshot([
		{ style: { "background-color": "#000000" }, children: [
			{ id: "alpha-fail", text: "Faint alpha", style: ink("rgba(255,255,255,0.1)") },
			{ id: "alpha-pass", text: "Readable alpha", style: ink("rgba(255,255,255,0.9)") },
		] },
		{ tag: "button", attributes: { disabled: "" }, children: [{ id: "disabled", text: "Disabled", style: ink("#cccccc") }] },
		{ id: "gradient-fail", text: "Faint gradient", style: { "background-image": "linear-gradient(#dddddd, #eeeeee)", ...ink("#bbbbbb") } },
		{ id: "transparent", text: "Hidden fill", style: ink("transparent") },
		{ id: "photo", text: "Unknown background", style: { ...ink("#cccccc"), "background-image": "url(photo.jpg)" } },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#alpha-fail", "#gradient-fail"])
})

test("#given pale clipped text and waived plain text #then only unwaived failures report", () => {
	const snapshot = buildSnapshot([
		{ id: "clip-fail", text: "Pale glyphs", style: { "background-clip": "text", "background-image": "linear-gradient(#dddddd, #eeeeee)", ...ink("transparent") } },
		{ id: "clip-pass", text: "Dark glyphs", style: { "background-clip": "text", "background-image": "linear-gradient(#111111, #333333)", ...ink("transparent") } },
		{ id: "waived", text: "Waived faint text", style: ink("#cccccc"), attributes: { "data-detect-ignore": "low-contrast" } },
	])
	expect(lintSnapshot(snapshot, { rules: [lowContrast] }).map((h) => h.location.kind === "element" ? h.location.selector : "")).toEqual(["#clip-fail"])
})

test("#given gradient bands and an underline tile #then contrast reads only the paint beneath the text", () => {
	const band = "linear-gradient(#fde68a 0%, #fde68a 30%, #1e3a8a 50%, #1e3a8a 100%)"
	const snapshot = buildSnapshot([
		{ id: "light-band", text: "Label", rect: { width: 240, height: 64 }, lineRects: [{ x: 16, y: 2, width: 120, height: 20 }],
			style: { ...ink("#fffdf7"), "background-image": band } },
		{ id: "dark-band", text: "Label", rect: { y: 100, width: 240, height: 64 }, lineRects: [{ x: 16, y: 140, width: 120, height: 20 }],
			style: { ...ink("#fffdf8"), "background-image": band } },
		{ id: "underline", text: "A readable link", rect: { y: 200, width: 160, height: 31 }, lineRects: [{ x: 0, y: 200, width: 120, height: 20 }],
			style: { ...ink("#1e293b"), "background-image": "linear-gradient(#1e293b, #1e293b)", "background-repeat": "no-repeat", "background-size": "100% 2px", "background-position": "0% 100%" } },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#light-band"])
})

test("#given safe text repeated across vendors and wordless prices #then only eligible word claimants replace glyphs", () => {
	const snapshot = buildSnapshot([
		{ id: "glyph", tag: "a", text: "𝕏", style: ink("#bbbbbb") },
		{ attributes: { id: "taboola-feed" }, children: [{ id: "vendor-word", tag: "a", text: "Sponsored words", style: ink("#bbbbbb") }] },
		{ id: "price", tag: "span", text: "R$ 89,90", style: ink("#aaaaaa") },
		{ id: "name", text: "Linen shirt", style: ink("#aaaaaa") },
		{ id: "tiny", tag: "span", text: "A tiny mark", style: { ...ink("#cccccc"), "font-size": "8px" } },
		{ attributes: { class: "slick-dots" }, children: [
			{ id: "dot", tag: "button", text: "1", style: { ...ink("#333333"), "background-color": "#888888" } },
		] },
		{ id: "site-button", tag: "button", text: "Get started", style: { ...ink("#333333"), "background-color": "#888888" } },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#glyph", "#name", "#dot", "#site-button"])
})

test("#given decorative and reading text on identical pairs #then both roles report with project error severity", () => {
	const snapshot = buildSnapshot([
		{ id: "stamp", tag: "p", text: "v2.4.1 · 2024-03-01", style: ink("#bbbbbb") },
		{ id: "heading", tag: "h3", text: "v2.4.1", style: ink("#bbbbbb") },
		{ id: "initial", tag: "span", text: "A", rect: { y: 100, width: 32, height: 32 }, style: { ...ink("#ffffff"), "background-color": "#93c5fd" } },
		{ id: "letter-link", tag: "a", text: "A", rect: { y: 150, width: 32, height: 32 }, style: { ...ink("#ffffff"), "background-color": "#93c5fd" } },
	])
	const findings = lintSnapshot(snapshot, { rules: [lowContrast] })
	expect(findings.map((h) => h.location.kind === "element" ? h.location.selector : "")).toEqual(["#stamp", "#heading", "#initial", "#letter-link"])
	expect(findings.every((h) => h.severity === "error")).toBe(true)
})

test("#given clipped copies and scroll-sized frames #then whole claimants and reachable lower copy report", () => {
	const snapshot = buildSnapshot([
		{ rect: { width: 200, height: 50 }, style: { "overflow-x": "hidden" }, children: [
			{ id: "cut", rect: { x: -80, width: 160, height: 24 }, text: "Repeated label", style: ink("#aaaaaa") },
			{ id: "whole", rect: { width: 160, height: 24 }, text: "Repeated label", style: ink("#aaaaaa") },
			{ id: "sliver", rect: { x: -150, width: 160, height: 24 }, text: "A sliver of another label", style: ink("#bbbbbb") },
		] },
		{ rect: { y: 100, width: 500, height: 800 }, style: { "overflow-y": "hidden" }, scroll: { scrollHeight: 1500, clientHeight: 800 }, children: [
			{ rect: { y: 100, height: 1500 }, children: [
				{ id: "below-fold", rect: { y: 1400 }, text: "Reachable faint copy", style: ink("#cccccc") },
			] },
		] },
		{ tag: "details", rect: { y: 1700 }, children: [{ id: "closed", rect: { y: 1700 }, text: "Closed panel", style: ink("#dddddd") }] },
		{ attributes: { hidden: "until-found" }, rect: { y: 1800 }, children: [{ id: "findable", rect: { y: 1800 }, text: "Findable panel", style: ink("#eeeeee") }] },
		{ rect: { y: 1900, width: 1280, height: 60 }, style: { "overflow-x": "hidden" }, children: [
			{ id: "shell-layout", rect: { x: 1220, y: 1900, width: 280 }, text: "A clipped desktop column", style: ink("#ababab") },
		] },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#whole", "#below-fold", "#shell-layout"])
	const base = buildSnapshot([
		{ rect: { width: 1280, height: 800 }, style: { position: "fixed", "overflow-y": "hidden" }, scroll: { clientHeight: 800, scrollHeight: 1800 }, children: [
			{ id: "frame-foot", rect: { y: 1500 }, text: "Faint frame footer", style: ink("#cccccc") },
		] },
	])
	const framed = { ...base, document: { ...base.document, scrollHeight: 800 },
		elements: base.elements.map((el) => el.tag === "body" ? { ...el, style: { ...el.style, "overflow-y": "hidden" } } : el) }
	expect(lowContrast.check({ snapshot: framed, config: {} }).map((h) => h.element?.selector)).toEqual(["#frame-foot"])
})

test("#given a declared mockup and labelled screenshot #then hidden drawings claim no pair and screenshot pairs stay separate", () => {
	const snapshot = buildSnapshot([
		{ attributes: { inert: "", class: "demo-frame" }, rect: { width: 420, height: 190 }, children: [
			{ id: "hidden-one", text: "Draft", style: ink("#cccccc") },
			{ text: "Saved", style: ink("#cccccc") },
			{ text: "Ready", style: ink("#cccccc") },
		] },
		{ id: "outside", text: "Your subscription renews on the first day of every month", style: ink("#cccccc") },
		{ attributes: { "aria-label": "A screenshot of the billing screen", class: "shot-frame" }, rect: { y: 300, width: 420, height: 190 }, children: [
			{ id: "shot", rect: { y: 320 }, text: "Billing", style: ink("#bbbbbb") },
		] },
		{ id: "after-shot", rect: { y: 600 }, text: "Your plan renews next month", style: ink("#bbbbbb") },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#outside", "#shot", "#after-shot"])
})

test("#given captured opacity motion and a paused vanishing loop #then only steady or held-end ink is scored", () => {
	const snapshot = buildSnapshot([
		{ id: "transition", text: "A reveal in progress", motion: ["opacity"], style: { ...ink("#bbbbbb"), opacity: "0.3" } },
		{ id: "finite", text: "The held entrance label", motion: ["opacity"], style: { ...ink("#bbbbbb"), opacity: "0.3",
			"animation-name": "enter", "animation-duration": "1s", "animation-iteration-count": "1", "animation-fill-mode": "forwards", "animation-play-state": "running" } },
		{ id: "paused", text: "A parked loop label", style: { ...ink("#bbbbbb"), opacity: "0.4",
			"animation-name": "cycle", "animation-iteration-count": "infinite", "animation-play-state": "paused" } },
		{ id: "steady", text: "Deliberately faded copy", style: { ...ink("#cccccc"), opacity: "0.4" } },
	], { cssText: ["@keyframes enter { from { opacity: 0; } to { opacity: 1; } } @keyframes cycle { 0% { opacity: 0; } 100% { opacity: 1; } }"] })
	expect(lowContrast.check({ snapshot, config: {} }).map((h) => h.element?.selector)).toEqual(["#finite", "#steady"])
})
