import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { designSystemFontSize } from "./design-system-font-size"

test("#given a size ramp with near-token and duplicate sizes #then unique off-ramp sizes report", () => {
	const snapshot = buildSnapshot([
		{ text: "Token", style: { "font-size": "16px" } },
		{ text: "Tolerated", style: { "font-size": "16.5px" } },
		{ id: "off", text: "Off ramp", style: { "font-size": "17px" } },
		{ text: "Duplicate", style: { "font-size": "17px" } },
		{ text: "Hidden", style: { "font-size": "19px", visibility: "hidden" } },
	])
	expect(designSystemFontSize.check({ snapshot, config: { designTokens: { fontSizes: [16, 24] } } }).map(h => h.element?.selector)).toEqual(["#off"])
})

test("#given no size ramp #then sizes are not judged", () => {
	const snapshot = buildSnapshot([{ text: "Off ramp", style: { "font-size": "17px" } }])
	expect(designSystemFontSize.check({ snapshot, config: {} })).toEqual([])
	expect(designSystemFontSize.check({ snapshot, config: { designTokens: { fontSizes: [] } } })).toEqual([])
	expect(designSystemFontSize.check({ snapshot, config: { designTokens: { fontSizes: [16] } } })).toHaveLength(1)
})
