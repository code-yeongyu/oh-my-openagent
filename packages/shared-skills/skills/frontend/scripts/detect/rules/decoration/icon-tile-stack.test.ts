import { test } from "bun:test"
import { iconTileStack } from "./icon-tile-stack"
import { assertCases, round } from "./support/assert-cases"
import type { NodeSpec } from "../../testing/build-snapshot"
const tile = (id: string): NodeSpec => ({
	id,
	rect: { width: 64, height: 64, y: 0 },
	style: { ...round("16px"), "background-color": "rgba(40,85,189,.1)" },
	children: [{ tag: "svg", rect: { width: 24, height: 24 } }],
})
const heading = (id: string, y = 80): NodeSpec => ({ id, tag: "h3", text: "Fast useful feature", rect: { y } })
test("#given framed icons stacked above headings #then avatars and inline tiles pass", () => {
	assertCases(
		iconTileStack,
		[
			{ children: [tile("tile"), heading("flag")] },
			{ children: [{ ...tile("avatar"), style: { ...tile("avatar").style, ...round("50%") } }, heading("avatar-heading")] },
			{ children: [tile("inline"), heading("inline-heading", 20)] },
			{ children: [{ ...tile("tiny"), rect: { width: 24, height: 24 } }, heading("tiny-heading")] },
		],
		["#flag"],
	)
})
test("#given wrapped tiles masks and emoji #then words and hidden emoji pass", () => {
	assertCases(
		iconTileStack,
		[
			{ children: [{ rect: { width: 64, height: 64 }, children: [tile("tile")] }, { children: [{ children: [heading("wrapped")] }] }] },
			{
				children: [
					{ ...tile("emoji"), children: [{ tag: "span", text: "\u{1F4DD}", rect: { width: 24, height: 24 } }] },
					heading("emoji-heading"),
				],
			},
			{
				children: [{ ...tile("word"), children: [{ tag: "span", text: "AI", rect: { width: 24, height: 24 } }] }, heading("word-heading")],
			},
			{
				children: [
					{
						...tile("hidden"),
						children: [{ tag: "span", text: "\u{1F4DD}", style: { display: "none" }, rect: { width: 24, height: 24 } }],
					},
					heading("hidden-heading"),
				],
			},
			{ children: [tile("far"), { children: [heading("far-heading", 240)] }] },
		],
		["#wrapped", "#emoji-heading"],
	)
})
test("#given shadow rings and masked glyphs #then empty tiles pass", () => {
	assertCases(
		iconTileStack,
		[
			{ children: [{ ...tile("ring"), style: { ...round("14px"), "box-shadow": "0 0 0 1px rgb(203,213,225)" } }, heading("flag")] },
			{
				children: [
					{ ...tile("mask"), children: [{ rect: { width: 30, height: 30 }, style: { "mask-image": "url(icon.svg)" } }] },
					heading("masked"),
				],
			},
			{ children: [{ ...tile("empty"), children: [] }, heading("empty-heading")] },
		],
		["#flag", "#masked"],
	)
})
