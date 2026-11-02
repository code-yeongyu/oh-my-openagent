import { test } from "bun:test"
import { gptThinBorderWideShadow } from "./gpt-thin-border-wide-shadow"
import { assertCases, border } from "./support/assert-cases"
import type { NodeSpec } from "../../testing/build-snapshot"
const card = (id: string, shadow = "0 0 40px rgba(15,23,42,0.18)"): NodeSpec => ({
	id,
	style: { ...border("1px"), "box-shadow": shadow },
	rect: { width: 180, height: 88 },
})
test("#given three repeated card treatments #then lone panels and pairs pass", () => {
	assertCases(
		gptThinBorderWideShadow,
		[
			{ children: [card("a"), card("b"), card("c")] },
			{ tag: "section", children: [card("pair-a"), card("pair-b")] },
			{ tag: "aside", children: [card("lone")] },
		],
		["#a", "#b", "#c"],
	)
})
test("#given tight negative spread and inset shadows #then only broad external halos report", () => {
	assertCases(
		gptThinBorderWideShadow,
		[
			{ children: [card("a"), card("b"), card("c")] },
			...["0 0 24px rgba(0,0,0,.2)", "0 18px 40px -26px rgba(0,0,0,.95)", "inset 0 0 40px rgba(0,0,0,.2)"].map((shadow, i) => ({
				children: [card("p" + i + "a", shadow), card("p" + i + "b", shadow), card("p" + i + "c", shadow)],
			})),
		],
		["#a", "#b", "#c"],
	)
})
test("#given repeated cards behind two wrappers #then comparable sizes still form a row", () => {
	assertCases(
		gptThinBorderWideShadow,
		[
			{ children: ["a", "b", "c"].map((id) => ({ tag: "article", children: [{ children: [card(id)] }] })) },
			{ children: [card("mismatch-a"), { ...card("mismatch-b"), rect: { width: 40, height: 200 } }, card("mismatch-c")] },
		],
		["#a", "#b", "#c"],
	)
})
test("#given dark invisible halos and hidden flyouts #then only visible cards report", () => {
	assertCases(
		gptThinBorderWideShadow,
		[
			{ children: [card("a"), card("b"), card("c")] },
			{
				style: { "background-color": "rgb(10,10,11)" },
				children: ["x", "y", "z"].map((id) => ({
					...card(id, "0 0 40px rgba(0,0,0,.18)"),
					style: { ...border("1px", "rgb(28,28,31)"), "background-color": "rgb(24,24,27)", "box-shadow": "0 0 40px rgba(0,0,0,.18)" },
				})),
			},
			{ children: ["f1", "f2", "f3"].map((id) => ({ ...card(id), style: { ...card(id).style, position: "absolute", opacity: "0" } })) },
		],
		["#a", "#b", "#c"],
	)
})
