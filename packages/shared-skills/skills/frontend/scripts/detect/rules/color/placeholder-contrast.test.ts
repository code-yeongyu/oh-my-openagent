import { expect, test } from "bun:test"
import { lintSnapshot } from "../../lint"
import { buildSnapshot } from "../../testing/build-snapshot"
import { lowContrast } from "./low-contrast"
import { textBackgrounds } from "./support/text-colors"

test("#given shown placeholders beside readable host ink #then each field reports its own placeholder without pair dedupe", () => {
	const snapshot = buildSnapshot([
		{ id: "first", tag: "input", attributes: { placeholder: "Name" }, style: { color: "#111111", "background-color": "#ffffff" }, placeholder: { color: "#bbbbbb" } },
		{ id: "second", tag: "textarea", attributes: { placeholder: "Notes" }, style: { color: "#111111", "background-color": "#ffffff" }, placeholder: { color: "#bbbbbb" } },
		{ id: "alpha", tag: "input", attributes: { placeholder: "Email" }, style: { color: "#111111", "background-color": "#f5f5f5" }, placeholder: { color: "rgba(255,255,255,0.4)" } },
		{ tag: "label", text: "Team", children: [
			{ id: "labelled", tag: "input", attributes: { placeholder: "Team name" }, style: { "background-color": "#ffffff" }, placeholder: { color: "#bbbbbb" } },
		] },
	])
	const hits = lintSnapshot(snapshot, { rules: [lowContrast] })
	expect(hits.map((hit) => hit.location.kind === "element" ? hit.location.selector : "")).toEqual(["#first", "#second", "#alpha", "#labelled"])
	expect(hits.every((hit) => hit.severity === "error")).toBe(true)
})

test("#given absent hidden transparent disabled and readable placeholders #then none reports", () => {
	const snapshot = buildSnapshot([
		{ tag: "input", attributes: { placeholder: "Filled", value: "Existing value" } },
		{ tag: "input", attributes: { placeholder: "Transparent" }, placeholder: { color: "rgba(255,255,255,0.02)" } },
		{ tag: "input", attributes: { placeholder: "" }, placeholder: { color: "#bbbbbb" } },
		{ tag: "input", attributes: { placeholder: "Disabled", disabled: "" }, placeholder: { color: "#bbbbbb" } },
		{ tag: "input", attributes: { placeholder: "Readable" }, placeholder: { color: "#111111" } },
		{ tag: "input", attributes: { type: "range", placeholder: "Not text" }, placeholder: { color: "#bbbbbb" } },
		{ style: { display: "none" }, children: [{ tag: "textarea", attributes: { placeholder: "Hidden" }, placeholder: { color: "#bbbbbb" } }] },
		{ tag: "input", attributes: { placeholder: "Waived", "data-detect-ignore": "low-contrast" }, placeholder: { color: "#bbbbbb" } },
	])
	expect(lintSnapshot(snapshot, { rules: [lowContrast] })).toEqual([])
})

test("#given large bold placeholders and translucent field layers #then thresholds use the host size and composited surface", () => {
	const snapshot = buildSnapshot([
		{ id: "small", tag: "input", attributes: { placeholder: "Small" }, style: { "font-size": "16px" }, placeholder: { color: "#888888" } },
		{ id: "large", tag: "input", attributes: { placeholder: "Large" }, style: { "font-size": "24px" }, placeholder: { color: "#888888" } },
		{ id: "bold", tag: "input", attributes: { placeholder: "Bold" }, style: { "font-size": "18.66px", "font-family": "Brand-SemiBold" }, placeholder: { color: "#888888" } },
		{ style: { "background-color": "#0f0f11" }, children: [
			{ style: { "background-color": "rgba(255,255,255,0.15)" }, children: [
				{ id: "frosted", tag: "input", attributes: { placeholder: "Frosted" }, style: { "background-color": "rgba(255,255,255,0.2)" }, placeholder: { color: "#bbbbbb" } },
			] },
		] },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((hit) => hit.element?.selector)).toEqual(["#small", "#frosted"])
})

test("#given supported modern colors and an unreadable nearer surface #then valid surfaces score and unknown paint stops the walk", () => {
	const snapshot = buildSnapshot([
		{ id: "p3", text: "Dim copy", rect: { y: 0 }, style: { color: "color(display-p3 0.35 0.35 0.36)", "background-color": "color(display-p3 0.07 0.07 0.08)" } },
		{ id: "lch", text: "Warm dim copy", rect: { y: 200 }, style: { color: "lch(35 3 80)", "background-color": "lch(8 3 80)" } },
		{ rect: { y: 400, width: 600, height: 200 }, style: { "background-color": "#ffffff" }, children: [
			{ rect: { y: 420, width: 500, height: 100 }, style: { "background-color": "color(rec2020 0.05 0.05 0.05)" }, children: [
				{ id: "unknown", rect: { y: 440 }, text: "Do not borrow the farther white", style: { color: "#eeeeee" } },
			] },
		] },
	])
	expect(lowContrast.check({ snapshot, config: {} }).map((hit) => hit.element?.selector)).toEqual(["#p3", "#lch"])
	const unknown = snapshot.elements.find((el) => el.attributes["id"] === "unknown")
	expect(unknown === undefined ? null : textBackgrounds(snapshot, unknown)).toEqual([])
})
