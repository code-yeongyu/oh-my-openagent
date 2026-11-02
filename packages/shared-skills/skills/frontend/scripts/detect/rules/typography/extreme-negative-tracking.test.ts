import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { extremeNegativeTracking } from "./extreme-negative-tracking"

test("#given crushed reading and display tracking with optical controls #then only crushed runs report", () => {
	const snapshot = buildSnapshot([
		{ id: "body", text: "Tracking crushed paragraph that still needs to read.", style: { "font-size": "16px", "letter-spacing": "-1.28px" } },
		{ id: "small", text: "Tracking crushed paragraph in a smaller face.", style: { "font-size": "14px", "letter-spacing": "-1.4px" } },
		{ id: "display", tag: "h2", text: "Tracking crushed display heading variant", style: { "font-size": "48px", "letter-spacing": "-4.8px" } },
		{ id: "optical", text: "Optically tightened display headline", style: { "font-size": "72px", "letter-spacing": "-4.32px" } },
		{ id: "body-floor", text: "Tracking at the exact reading-size limit", style: { "font-size": "16px", "letter-spacing": "-1.12px" } },
		{ id: "display-floor", text: "Tracking at the exact display-size limit", style: { "font-size": "40px", "letter-spacing": "-3.6px" } },
		{ id: "cjk", text: "この段落は日本語の文字組みで、字間を詰めても文字の形は崩れません。", style: { "font-size": "18px", "letter-spacing": "-1.8px" } },
	])
	expect(extremeNegativeTracking.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#body", "#small", "#display"])
})

test("#given short or hidden crushed text beside visible prose #then only prose reports", () => {
	const style = { "letter-spacing": "-2px" }
	const snapshot = buildSnapshot([{ id: "flag", text: "A visible paragraph longer than twenty characters.", style },
		{ text: "Short", style }, { text: "A hidden paragraph longer than twenty characters.", style: { ...style, opacity: "0" } }])
	expect(extremeNegativeTracking.check({ snapshot, config: {} }).map(h => h.element?.selector)).toEqual(["#flag"])
})
