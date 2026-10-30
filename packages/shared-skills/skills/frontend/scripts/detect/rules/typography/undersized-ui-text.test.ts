import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { undersizedUiText } from "./undersized-ui-text"
test("#given captured opacity motion and held endpoints #then only permanent replacing fades leave size scoring", () => {
	const animation = {
		"font-size": "9px", "animation-name": "out", "animation-iteration-count": "1",
		"animation-duration": "10s", "animation-delay": "40s", "animation-fill-mode": "forwards",
		"animation-direction": "normal", "animation-play-state": "running", "animation-composition": "replace",
	}
	const cases = [
		{ id: "out", style: {} },
		{ id: "returns", style: { "animation-fill-mode": "none" } },
		{ id: "paused", style: { "animation-play-state": "paused" } },
		{ id: "endless", style: { "animation-iteration-count": "infinite" } },
		{ id: "fraction", style: { "animation-iteration-count": "1.5" } },
		{ id: "long", style: { "animation-delay": "51s" } },
		{ id: "reverse", style: { "animation-direction": "reverse" } },
		{ id: "alternate", style: { "animation-direction": "alternate", "animation-iteration-count": "2" } },
		{ id: "reverse-alternate", style: { "animation-direction": "alternate-reverse", "animation-iteration-count": "2" } },
		{ id: "add", style: { "animation-composition": "add" } },
		{ id: "scroll", style: { "animation-timeline": "scroll()" } },
		{ id: "unknown", style: { "animation-name": "out, unavailable" } },
		{ id: "competing", style: { "animation-name": "out, in" } },
		{ id: "no-endpoint", style: { "animation-name": "middle" } },
		{ id: "near-end", style: { "animation-name": "near" } },
	]
	const nodes = cases.map(({ id, style }) => ({
		id, tag: "a", text: "Calendar", attributes: { href: "#" }, style: { ...animation, ...style }, motion: ["opacity"],
	}))
	const snapshot = buildSnapshot([
		...nodes,
		{ id: "no-motion", tag: "a", text: "Calendar", attributes: { href: "#" }, style: animation },
		{ id: "missing-composition", tag: "a", text: "Calendar", attributes: { href: "#" }, style: {
			...animation, "animation-composition": "",
		}, motion: ["opacity"] },
		{ style: animation, motion: ["opacity"], children: [
			{ id: "child", tag: "a", text: "Calendar", attributes: { href: "#" }, style: { "font-size": "9px" } },
		] },
	], { cssText: [
		"@keyframes out { from {opacity:1} 35%, to {opacity:0} } @keyframes in {from {opacity:0}to {opacity:1}}" +
		"@keyframes middle {50% {opacity:0}} @keyframes near {from {opacity:1}to {opacity:1%}}",
	] })
	expect(undersizedUiText.check({ snapshot, config: {} }).map(hit => hit.element?.selector)).toEqual([
		"#returns", "#paused", "#endless", "#fraction", "#long", "#reverse", "#alternate",
		"#add", "#scroll", "#unknown", "#competing", "#no-endpoint", "#no-motion", "#missing-composition",
	])
})

test("#given functional text, legal floors and tolerant fluid sizes #then only undersized labels report", () => {
	const snapshot = buildSnapshot([
		{ id: "button", tag: "button", text: "Learn more", style: { "font-size": "10px" } },
		{ id: "floor", tag: "button", text: "Learn more", style: { "font-size": "10.9px" } },
		{ tag: "button", text: "Learn more", style: { "font-size": "10.9688px" } },
		{ tag: "button", text: "Learn more", style: { "font-size": "11px" } },
		{ tag: "footer", children: [
			{ text: "Copyright", style: { "font-size": "10px" } },
			{ id: "legal", text: "Copyright", style: { "font-size": "9.9px" } },
			{ id: "footer-link", tag: "a", text: "Privacy", attributes: { href: "#" }, style: { "font-size": "10px" } },
		] },
	])
	expect(undersizedUiText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#button", "#floor", "#legal", "#footer-link"])
})

test("#given footnote links, code and nonfunctional prose #then ordinary short labels alone report", () => {
	const style = { "font-size": "8px" }
	const snapshot = buildSnapshot([
		{ id: "label", text: "Short label", style },
		{ tag: "sup", children: [{ tag: "a", text: "[7]", style, attributes: { href: "#" } }] },
		{ tag: "code", text: "const x = 1", style },
		{ text: "A long paragraph of body copy belongs to the tiny-text check.", style },
		{ text: "const result = { count: 3 };", style: { ...style, "font-family": "IBM Plex Mono", "white-space": "pre-wrap" } },
		{ text: "Hidden label", style, attributes: { class: "sr-only" } },
	])
	expect(undersizedUiText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#label"])
})

test("#given furniture class parts and button groups #then only real furniture and button labels report", () => {
	const style = { "font-size": "9.5px" }
	const text = "A content-bearing label longer than twenty characters"
	const snapshot = buildSnapshot([
		...["taglist", "hero-tagline", "footer-subnav"].map((name, i) => ({ attributes: { class: name }, children: [{ id: `furniture-${i}`, text, style }] })),
		...["px-stage-compact", "instagram-feed", "pillars", "navy"].map(name => ({ attributes: { class: name }, children: [{ text, style }] })),
		{ id: "button", text, style, attributes: { class: "demo__btn" } },
		{ attributes: { class: "hero-btns btn-group" }, children: [
			{ text, style }, { text: "*Offer valid for new customers only. Terms and conditions apply to every plan.", style, attributes: { class: "offer-terms" } },
		] },
	])
	expect(undersizedUiText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#furniture-0", "#furniture-1", "#furniture-2", "#button"])
})

test("#given JSON runs and monospace pricing #then punctuation identifies code rather than prices", () => {
	const style = { "font-size": "8px", "font-family": "IBM Plex Mono", "white-space": "pre-wrap" }
	const snapshot = buildSnapshot([
		{ text: '"data": {', style }, { text: '"id": 7,', style }, { text: '"title": "Introducing Directus",', style }, { text: "},", style },
		{ id: "price", text: "$50/seat", style }, { id: "count", text: "200+", style },
	])
	expect(undersizedUiText.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#price", "#count"])
})
