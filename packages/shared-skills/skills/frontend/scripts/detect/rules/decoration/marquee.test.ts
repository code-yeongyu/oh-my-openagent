import { test } from "bun:test"
import { marquee } from "./marquee"
import { assertCases } from "./support/assert-cases"

test("#given infinite crawling content and empty ornaments #then only content tracks report", () => {
	const style = { "animation-name": "crawl", "animation-iteration-count": "infinite" }
	assertCases(
		marquee,
		[
			{ id: "words", text: "New arrivals every Friday", style },
			{ id: "logos", style, children: [{ tag: "svg", attributes: { role: "img" } }] },
			{ id: "wave", tag: "svg", style, attributes: { "aria-hidden": "true" }, children: [{ tag: "path" }] },
			{ id: "sweep", style },
		],
		["#words", "#logos"],
		{ cssText: ["@keyframes crawl {from{transform:translateX(0)}to{transform:translateX(-50%)}}"] },
	)
})
test("#given moving pseudo content #then host words do not make empty sheens marquees", () => {
	const pseudo = { "animation-name": "flow", "animation-iteration-count": "infinite" }
	assertCases(
		marquee,
		[
			{ id: "ticker", before: { ...pseudo, content: '"Sale New arrivals"' } },
			{ id: "sheen", text: "Release news", before: { ...pseudo, content: '""' } },
			{ id: "plain", text: "Still content" },
		],
		["#ticker"],
		{ cssText: ["@keyframes flow {from{transform:translateX(-48%)}to{transform:translateX(48%)}}"] },
	)
})
test("#given nested and native marquees #then each moving content strip reports once", () => {
	assertCases(
		marquee,
		[
			{
				id: "flag",
				tag: "marquee",
				text: "Sale",
				children: [{ id: "nested", text: "Sale", style: { "animation-name": "ticker", "animation-iteration-count": "infinite" } }],
			},
			{ id: "still", text: "Calm" },
		],
		["#flag"],
	)
})

test("#given measured keyframes #then only percentage travel of at least twenty points is a marquee", () => {
	const track = (id: string, name: string) => ({ id, text: "Moving content", style: { "animation-name": name, "animation-iteration-count": "infinite" } })
	assertCases(marquee, [
		track("pixels", "slide"),
		track("short", "ticker-short"),
		track("offset", "ticker-offset"),
		track("pulse", "pulse-x"),
		track("percent", "loop"),
	], ["#percent"], { cssText: [
		"@keyframes slide { from { transform: translateX(-96px); } to { transform: translateX(-1496px); } }",
		"@keyframes ticker-short { from { transform: translateX(0%); } to { transform: translateX(-19%); } }",
		"@keyframes ticker-offset { from { transform: translateX(-49%); } to { transform: translateX(-50%); } }",
		"@keyframes pulse-x { from { transform: translateX(50%); opacity: 0; } to { opacity: 1; } }",
		"@keyframes loop { from { transform: translateX(0%); } to { transform: translateX(calc(-20% + 1rem)); } }",
	] })
})
