import { test } from "bun:test"
import { kickerAboveHeading } from "./kicker-above-heading"
import { assertCases, round } from "./support/assert-cases"
import type { NodeSpec } from "../../testing/build-snapshot"
const label = (id: string, text = "Platform notes"): NodeSpec => ({
	id,
	tag: "span",
	text,
	rect: { width: 200, height: 16, y: 0 },
	style: { "font-size": "12px", "letter-spacing": "0.96px", "text-transform": "uppercase" },
})
test("#given tracked labels outside the hero size ceiling #then fixed hero tracking still hands them off", () => {
	const wide = { ...label("wide"), style: { "font-size": "15px", "letter-spacing": "1.8px", "text-transform": "uppercase" } }
	assertCases(kickerAboveHeading, [
		{ children: [wide, heading("h1", "64px")] },
		{ children: [{ ...wide, id: "section" }, heading("h2", "44px")] },
	], ["#section"])
})
const heading = (tag = "h2", size = "32px"): NodeSpec => ({
	tag,
	text: "A useful section heading",
	style: { "font-size": size },
	rect: { y: 24 },
})
test("#given captured small caps above display titles #then shorthand and longhand remain kickers", () => {
	assertCases(kickerAboveHeading, ["font-variant", "font-variant-caps"].map((property, i) => ({
		children: [
			{ ...label(`caps-${i}`), text: "new in version four", style: {
				"font-size": "13px", "letter-spacing": "1.3px", "text-transform": "none", [property]: "small-caps",
			} },
			heading("h1", "56px"),
		],
	})), ["#caps-0", "#caps-1"])
})
test("#given one tracked kicker above a heading #then sentence case and metadata pass", () => {
	assertCases(
		kickerAboveHeading,
		[
			{ children: [label("flag"), heading()] },
			{ children: [label("date", "News Jan 12 2026"), heading()] },
			{ children: [label("path", "Home / Journal"), heading()] },
			{ children: [label("chapter", "Chapter Four"), heading()] },
			{ children: [label("section", "Section kicker"), heading()] },
			{ children: [{ ...label("sentence"), style: { "font-size": "12px", "letter-spacing": "1px" } }, heading()] },
		],
		["#flag", "#section"],
	)
})
test("#given larger headings and wrapped kickers #then relative ceilings and geometry apply", () => {
	assertCases(
		kickerAboveHeading,
		[
			{ children: [{ id: "flag", children: [label("inner")] }, { children: [heading()] }] },
			{
				children: [
					{ ...label("large"), style: { "font-size": "15px", "letter-spacing": "3px", "text-transform": "uppercase" } },
					heading("h2", "44px"),
				],
			},
			{
				children: [
					{ ...label("too-large"), style: { "font-size": "15px", "letter-spacing": "3px", "text-transform": "uppercase" } },
					heading("h3", "24px"),
				],
			},
			{
				children: [
					{ ...label("beside"), rect: { x: 0, y: 24, width: 100, height: 16 } },
					{ ...heading(), rect: { x: 150, y: 24 } },
				],
			},
		],
		["#flag", "#large"],
	)
})
test("#given semantic card and application labels #then section kickers alone report", () => {
	assertCases(
		kickerAboveHeading,
		[
			{ children: [label("flag"), heading()] },
			{ tag: "article", children: [label("article"), heading("h3")] },
			{ attributes: { role: "tabpanel" }, children: [label("app"), heading()] },
			{ tag: "nav", children: [label("nav"), heading()] },
			{ attributes: { "data-impeccable-allow-kickers": "" }, children: [label("waived"), heading()] },
			{
				children: [
					{ ...label("hero"), style: { "font-size": "12px", "letter-spacing": "2px", "text-transform": "uppercase" } },
					heading("h1", "64px"),
				],
			},
		],
		["#flag"],
	)
})
test("#given painted card labels and display titles #then only section scale titles retain kickers", () => {
	const card = { ...round("16px"), "background-color": "rgb(255,255,255)" }
	assertCases(
		kickerAboveHeading,
		[
			{ style: card, children: [label("flag"), heading("h3", "40px")] },
			{ style: card, children: [label("small-card"), heading("h3", "20px")] },
			{ style: card, children: [{ ...label("badge"), style: { ...label("badge").style, position: "absolute" } }, heading("h3", "24px")] },
		],
		["#flag"],
	)
})
test("#given normal tracking and small caps #then only tracked uppercase forms report", () => {
	assertCases(
		kickerAboveHeading,
		[
			{ children: [label("flag"), heading()] },
			{ children: [{ ...label("plain"), style: { ...label("plain").style, "letter-spacing": "normal" } }, heading()] },
			{
				children: [
					{
						...label("smallcaps"),
						text: "materials briefing",
						style: { "font-size": "12px", "letter-spacing": "1.44px", "font-variant-caps": "small-caps" },
					},
					heading(),
				],
			},
		],
		["#flag", "#smallcaps"],
	)
})
