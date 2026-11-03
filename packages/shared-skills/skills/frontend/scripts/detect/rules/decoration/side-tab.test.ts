import { test } from "bun:test"
import { sideTab } from "./side-tab"
import { assertCases, round } from "./support/assert-cases"

test("#given rounded card accents and safe borders #then only the card stripes report", () => {
	const style = { ...round("12px"), "border-left-width": "2px", "border-left-style": "solid", "border-left-color": "rgb(0,150,130)" }
	assertCases(
		sideTab,
		[
			{ id: "flag", style },
			{ id: "square", style: { ...style, ...round("0px") } },
			{ id: "neutral", style: { ...style, "border-left-color": "rgb(30,30,30)" } },
			{ id: "ring", rect: { width: 64, height: 64 }, style: { ...style, ...round("50%") } },
			{ tag: "button", id: "button", style },
			{ id: "hidden", style: { ...style, opacity: "0" } },
		],
		["#flag"],
	)
})
test("#given far rounded corners #then the opposite pair controls a thin stripe", () => {
	const stripe = { "border-left-width": "2px", "border-left-style": "solid", "border-left-color": "rgb(0,150,130)" }
	assertCases(
		sideTab,
		[
			{ id: "flag", style: { ...stripe, "border-top-right-radius": "12px", "border-bottom-right-radius": "6px" } },
			{ id: "near", style: { ...stripe, "border-top-left-radius": "12px", "border-bottom-left-radius": "12px" } },
			{ id: "one-square", style: { ...stripe, "border-top-right-radius": "12px", "border-bottom-right-radius": "2px" } },
		],
		["#flag"],
	)
})
test("#given row status and selected states #then only nonselection stripes report", () => {
	const stripe = { "box-shadow": "inset 3px 0 0 rgb(220,30,40)" }
	assertCases(
		sideTab,
		[
			{ tag: "td", id: "flag", style: stripe },
			{ tag: "tr", attributes: { "aria-selected": "true" }, children: [{ tag: "td", id: "selected", style: stripe }] },
			{ tag: "td", id: "shaded", style: { ...stripe, "background-color": "rgb(240,240,240)" } },
			{ tag: "td", id: "divider", style: { "box-shadow": "inset 1px 0 0 rgb(220,30,40)" } },
		],
		["#flag"],
	)
})
test("#given pseudo and inset stripes #then square and colorless bands pass", () => {
	const band = { position: "absolute", left: "0px", bottom: "0px", width: "200px", height: "3px", "background-color": "rgb(220,30,40)" }
	assertCases(
		sideTab,
		[
			{ id: "flag", style: round("12px"), after: band },
			{ id: "square", after: band },
			{ id: "picture", style: round("12px"), after: { ...band, "background-color": "transparent", "background-image": "url(photo.jpg)" } },
		],
		["#flag"],
	)
})
test("#given flex stripe children #then only rounded nonselected hosts report", () => {
	const stripe = (id: string) => ({ id, rect: { width: 4, height: 100 }, style: { "background-color": "rgb(245,158,11)" } })
	assertCases(
		sideTab,
		[
			{ rect: { width: 320, height: 100 }, style: round("12px"), children: [stripe("flag")] },
			{ rect: { width: 320, height: 100 }, children: [stripe("square")] },
			{ rect: { width: 320, height: 100 }, attributes: { class: "is-active" }, style: round("12px"), children: [stripe("selected")] },
			{ tag: "h2", rect: { width: 320, height: 100 }, style: round("12px"), children: [stripe("heading")] },
		],
		["#flag"],
	)
})
test("#given modern accent colors #then chromatic Lab and LCH report but neutral variants pass", () => {
	const card = (id: string, color: string) => ({ id, style: { ...round("6px"), "border-left-width": "4px", "border-left-color": color } })
	assertCases(
		sideTab,
		[
			card("lab", "lab(50% 40 -30)"),
			card("lch", "lch(55% 60 250)"),
			card("neutral-lab", "lab(50% 0 0)"),
			card("neutral-oklch", "oklch(60% .01 250)"),
		],
		["#lab", "#lch"],
	)
})

test("#given wildcard waivers on stripe ancestors #then only unrelated waivers leave the stripe reportable", () => {
	const style = { ...round("12px"), "border-left-width": "4px", "border-left-style": "solid", "border-left-color": "rgb(0,150,130)" }
	assertCases(sideTab, [
		{ attributes: { "data-impeccable-ignore": "*" }, children: [{ id: "star", style }] },
		{ attributes: { "data-detect-ignore": "pulsing-dot,*" }, children: [{ id: "alias-star", style }] },
		{ attributes: { "data-impeccable-ignore": "pulsing-dot" }, children: [{ id: "unrelated", style }] },
	], ["#unrelated"])
})
