import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { skippedHeading } from "./skipped-heading"

test("#given a skipped rank followed by a descending rank #then only the forward skip reports", () => {
	const snapshot = buildSnapshot([
		{ tag: "h1", text: "Title" }, { tag: "h3", id: "skip", text: "Section" }, { tag: "h2", id: "back", text: "Next section" },
		{ tag: "h3", id: "ordinary", text: "Subsection" },
	])
	expect(skippedHeading.check({ snapshot, config: {} }).map((hit) => hit.element?.selector)).toEqual(["#skip"])
})

test("#given hidden panels and screen reader headings #then hidden panels leave the outline", () => {
	const snapshot = buildSnapshot([
		{ tag: "h1", text: "Title" },
		{ style: { display: "none" }, children: [{ tag: "h4", id: "hidden", text: "Closed menu" }] },
		{ tag: "h2", text: "Section" },
		{ style: { visibility: "hidden" }, children: [{ tag: "h5", id: "hidden-widget", text: "Widget" }] },
		{ tag: "h4", id: "sr", text: "Screen reader title", attributes: { class: "sr-only" }, rect: { width: 1, height: 1 } },
		{ tag: "h5", id: "faded", text: "Reveal", style: { opacity: "0" } },
	])
	expect(skippedHeading.check({ snapshot, config: {} }).map((hit) => hit.element?.selector)).toEqual(["#sr"])
})

test("#given footer columns and closing calls to action #then later internal skips still report", () => {
	const snapshot = buildSnapshot([
		{ tag: "h1", text: "Title" }, { tag: "h2", text: "Last section" },
		{ tag: "footer", children: [
			{ tag: "h2", text: "Join us" }, { tag: "h4", id: "column", text: "Company" },
			{ tag: "h6", id: "footer-skip", text: "Bad nested title" },
		] },
		{ tag: "h2", text: "Content resumes" }, { tag: "h4", id: "content-skip", text: "Bad content title" },
	])
	expect(skippedHeading.check({ snapshot, config: {} }).map((hit) => hit.element?.selector)).toEqual(["#footer-skip", "#content-skip"])
})

test("#given a declared mockup beside real content #then only the real content enters the outline", () => {
	const check = (hidden: string) => skippedHeading.check({ snapshot: buildSnapshot([
		{ tag: "h1", text: "The product overview" },
		{ tag: "p", text: "This paragraph explains the actual product and its concrete capabilities for a visitor. ".repeat(8) },
		{ tag: "h2", text: "Content section" },
		{ attributes: { "aria-hidden": hidden }, rect: { width: 320, height: 180 }, children: [
			{ tag: "h4", id: "mock-title", text: "Window" }, { tag: "span", text: "Inbox" }, { tag: "span", text: "Messages" },
		] },
		{ tag: "h3", text: "Content subsection" },
	]), config: {} })
	expect(check("true")).toHaveLength(0)
	expect(check("false").map((hit) => hit.element?.selector)).toEqual(["#mock-title"])
})
