import { expect, test } from "bun:test"
import { buildSnapshot, type NodeSpec } from "../../../testing/build-snapshot"
import { tinyText } from "../tiny-text"
import { undersizedUiText } from "../undersized-ui-text"

test("#given closed disclosure content #then tiny text only reports in open disclosures", () => {
	const text = "A sentence long enough to be considered running copy."
	const small: NodeSpec = { tag: "span", text, style: { "font-size": "10px" } }
	const snapshot = buildSnapshot([
		{ tag: "details", children: [{ tag: "summary", text: "More" }, { ...small, id: "closed" }] },
		{ tag: "details", attributes: { open: "" }, children: [{ tag: "summary", text: "More" }, { ...small, id: "open" }] },
	])
	expect(tinyText.check({ snapshot, config: {} }).map(hit => hit.element?.selector)).toEqual(["#open"])
})

test("#given one pixel labels and enlarged glyphs #then only readable undersized labels report", () => {
	const built = buildSnapshot([
		{ id: "dot", tag: "a", text: "Profile", attributes: { href: "#" }, style: { "font-size": "1px" } },
		{ id: "scaled", tag: "a", text: "Profile", attributes: { href: "#" }, style: { "font-size": "1px", transform: "matrix(8,0,0,8,0,0)" } },
		{ id: "stretched", tag: "a", text: "Profile", attributes: { href: "#" }, style: { "font-size": "1px", transform: "matrix(8,0,0,1,0,0)" } },
		{ id: "two", tag: "a", text: "Profile", attributes: { href: "#" }, style: { "font-size": "2px" } },
	])
	const snapshot = { ...built, elements: built.elements.map(e => ({ ...e, style: { ...e.style, scale: "none", rotate: "none" } })) }
	expect(undersizedUiText.check({ snapshot, config: {} }).map(hit => hit.element?.selector)).toEqual(["#scaled", "#two"])
})
test("#given one pixel text without individual transform capture #then uncertain paint remains measurable", () => {
	const snapshot = buildSnapshot([{ id: "uncertain", tag: "a", text: "Profile", attributes: { href: "#" }, style: { "font-size": "1px" } }])
	expect(undersizedUiText.check({ snapshot, config: {} }).map(hit => hit.element?.selector)).toEqual(["#uncertain"])
})
test("#given individual transforms on one pixel labels #then both axes and ancestor rotation determine enlargement", () => {
	const label = (id: string, style: Readonly<Record<string, string>>): NodeSpec => ({
		id, tag: "a", text: "Profile", attributes: { href: "#" }, style: { "font-size": "1px", ...style },
	})
	const built = buildSnapshot([
		label("dot", { rotate: "90deg" }),
		label("uniform", { scale: "1600%", rotate: "z 100grad" }),
		label("one-axis", { scale: "16 1", rotate: ".25turn" }),
		{ style: { scale: "16 1" }, children: [label("composed", { scale: "16 1", rotate: "0 0 1 90deg" })] },
		label("unknown-axis", { rotate: "x 90deg" }),
	])
	const snapshot = { ...built, elements: built.elements.map(e => ({
		...e, style: { scale: "none", rotate: "none", ...e.style },
	})) }
	expect(undersizedUiText.check({ snapshot, config: {} }).map(hit => hit.element?.selector)).toEqual(["#uniform", "#composed", "#unknown-axis"])
})

test("#given declared inert mockups and live content #then the mockup alone leaves typography scoring", () => {
	const frame = (prefix: string, inert: boolean): NodeSpec => ({
		id: prefix, rect: { width: 420, height: 190 }, attributes: inert ? { inert: "" } : {},
		children: [
			{ text: "Drafts" }, { text: "Weekly users" }, { text: "Compared with last week" },
			{ id: prefix + "-link", tag: "a", text: "Open report", attributes: { href: "#" }, style: { "font-size": "10px" } },
			{ id: prefix + "-dot", tag: "a", text: "Profile", attributes: { href: "#" }, style: { "font-size": "1px" } },
			{ id: prefix + "-copy", tag: "p", text: "A ten pixel sentence a visitor would have to read here.", style: { "font-size": "10px" } },
		],
	})
	const snapshot = buildSnapshot([
		{ children: [frame("drawing", true)] }, { children: [frame("live", false)] },
		{ tag: "p", text: "Ordinary reading copy remains most of this page. ".repeat(20) },
	])
	expect(tinyText.check({ snapshot, config: {} }).map(hit => hit.element?.selector)).toEqual(["#live-copy"])
	expect(undersizedUiText.check({ snapshot, config: {} }).map(hit => hit.element?.selector)).toEqual(["#live-link", "#live-dot"])
})
