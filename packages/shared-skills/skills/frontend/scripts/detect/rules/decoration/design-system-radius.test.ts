import { test } from "bun:test"
import { designSystemRadius } from "./design-system-radius"
import { assertCases, round } from "./support/assert-cases"

test("#given project radii #then off-scale corners report with tolerance", () => {
	assertCases(
		designSystemRadius,
		[
			{ id: "flag", style: round("18px") },
			{ id: "token", style: round("8px") },
			{ id: "tolerance", style: round("8.5px") },
			{ id: "percent", style: round("50%") },
			{ id: "zero", style: round("0px") },
		],
		["#flag"],
		{ config: { designTokens: { radii: [0, 8, 16] } } },
	)
})
test("#given a pill token #then large pill radii pass but other values report", () => {
	assertCases(
		designSystemRadius,
		[
			{ id: "flag", style: round("18px") },
			{ id: "pill", style: round("9999px") },
		],
		["#flag"],
		{ config: { designTokens: { radii: [8, 999] } } },
	)
})
test("#given tokens only on the configured run #then the unconfigured run stays silent", () => {
	const nodes = [
		{ id: "flag", style: round("18px") },
		{ id: "zero", style: round("0px") },
	]
	assertCases(designSystemRadius, nodes, ["#flag"], { config: { designTokens: { radii: [8] } } })
	assertCases(designSystemRadius, nodes, [])
})
