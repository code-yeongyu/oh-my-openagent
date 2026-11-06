import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { creamPalette } from "./cream-palette"

test("#given warm page fills and neutral or cool pages #then only cream grounds report", () => {
	for (const [color, expected] of [["#f5efe2", 1], ["#ffffff", 0], ["#e2eff5", 0], ["#222222", 0]] as const) {
		const snapshot = buildSnapshot([{ tag: "body", style: { "background-color": color } }])
		const body = snapshot.elements[1]
		if (!body) throw new Error("Fixture body missing")
		const page = { ...snapshot, elements: [{ ...body, index: 0, parent: null }] }
		expect(creamPalette.check({ snapshot: page, config: {} })).toHaveLength(expected)
	}
})

test("#given utility cream pages and covered grounds #then visible cream alone reports", () => {
	const page = (classes: string, covered: boolean) => {
		const snapshot = buildSnapshot([{ tag: "body", attributes: { class: classes }, style: { "background-color": "#f5efe2" }, children: covered ? [{ style: { "background-color": "#ffffff" }, rect: { width: 1280, height: 800 } }] : [] }])
		const root = snapshot.elements[0]
		if (!root) throw new Error("Fixture root missing")
		return { ...snapshot, elements: [{ ...root, tag: "html" }, ...snapshot.elements.slice(1)] }
	}
	expect(creamPalette.check({ snapshot: page("bg-amber-50", false), config: {} })).toHaveLength(1)
	expect(creamPalette.check({ snapshot: page("", true), config: {} })).toHaveLength(0)
})
