import { expect, test } from "bun:test"
import { buildSnapshot, type NodeSpec } from "../../testing/build-snapshot"
import { numberedSectionLabels } from "./numbered-section-labels"

const section = (id: string, text: string, style: Readonly<Record<string, string>> = {}): NodeSpec => ({
	tag: "section", children: [
		{ id, tag: "span", text, style: { "font-size": "11px", "font-family": "monospace", ...style } },
		{ tag: "h2", text: `Section ${id}`, style: { "font-size": "28px" } },
	],
})
const flagged = (nodes: readonly NodeSpec[]) => numberedSectionLabels.check({ snapshot: buildSnapshot(nodes), config: {} }).map((hit) => hit.element?.selector)

test("#given distinct tiny indices and false positive shapes #then only styled section numbers report", () => {
	expect(flagged([
		section("first", "01"), section("second", "02 / ROLLOUT"),
		section("large", "03", { "font-size": "16px" }),
		section("plain", "12 · minute read", { "font-size": "12px", "font-family": "Georgia", color: "rgb(100, 100, 100)" }),
		section("step", "Step 6"), section("single", "7"), section("rank", "#1 Rated"), section("over-limit", "41"),
		{ tag: "nav", children: [section("navigation", "08")] },
		{ tag: "ol", children: [section("list", "09")] },
		{ tag: "article", style: { "background-color": "rgb(240, 240, 240)" }, children: [section("card", "10")] },
	])).toEqual(["#first", "#second"])
})

test("#given a single index or repeated equal indices #then no section scaffold is inferred", () => {
	expect(flagged([section("first", "01"), section("second", "02")])).toEqual(["#first", "#second"])
	expect(flagged([section("only", "01")])).toEqual([])
	expect(flagged([section("first", "01"), section("same", "01")])).toEqual([])
})

test("#given wrapper labels and large headings #then relative label sizing follows the actual text node", () => {
	const wrapped = (id: string, text: string): NodeSpec => ({
		children: [
			{ children: [{ id, tag: "span", text, style: { "font-family": "monospace", "font-size": "15px" } }] },
			{ children: [{ children: [{ tag: "h3", text: "Large feature", style: { "font-size": "44px" } }] }] },
		],
	})
	const snapshot = buildSnapshot([wrapped("first", "01"), wrapped("second", "02"), section("too-large", "03", { "font-size": "17px" })])
	expect(numberedSectionLabels.check({ snapshot, config: {} }).map((hit) => hit.snippet.split(" / ")[0])).toEqual(["01", "02"])
})

test("#given hash sections bare articles and hidden labels #then ranks cards and hidden scaffolds pass", () => {
	expect(flagged([
		{ tag: "article", children: [section("first", "#1 Connect")] },
		{ tag: "article", children: [section("second", "#2 Remember")] },
		{ style: { display: "none" }, children: [section("hidden", "03")] },
		{ tag: "a", children: [{ tag: "article", children: [section("linked-card", "04")] }] },
		section("rank", "#2 Best seller"),
	])).toEqual(["#first", "#second"])
})

test("#given same-surface articles and page-scale frames #then only real cards are exempt", () => {
	expect(flagged([
		{ tag: "article", style: { "background-color": "rgb(255, 255, 255)" }, children: [section("same-surface", "01")] },
		{ tag: "article", rect: { height: 2000 }, style: { "background-color": "rgb(240, 240, 240)" }, children: [section("page-frame", "02")] },
		{ tag: "article", style: { "background-color": "rgb(240, 240, 240)" }, children: [section("card", "03")] },
	])).toEqual(["#same-surface", "#page-frame"])
})
