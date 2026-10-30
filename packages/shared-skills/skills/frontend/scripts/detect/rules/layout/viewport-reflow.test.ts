import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { viewportReflow } from "./viewport-reflow"
import { selectors } from "./support/layout-cases"

for (const width of [320, 375, 768, 1024, 1440]) {
	test(`#given an overflowing document at ${width}px #then a page finding names the furthest element`, () => {
		const base = buildSnapshot([
			{ id: "offender", rect: { x: 20, width: width + 40 } },
			{ id: "scroll", style: { "overflow-x": "auto" }, children: [{ id: "track", rect: { width: width * 3 } }] },
			{ id: "hidden", style: { opacity: "0" }, rect: { width: width * 4 } },
		], { viewport: { width, height: 800 } })
		const snapshot = { ...base, document: { ...base.document, scrollWidth: width + 60 } }
		expect(selectors(viewportReflow, snapshot)).toEqual(["page"])
		expect(viewportReflow.check({ snapshot, config: {} })[0]?.message).toContain("#offender")
		expect(selectors(viewportReflow, base)).toEqual([])
	})
}

test("#given overflow without a measured offender #then the document still fails reflow", () => {
	const base = buildSnapshot([])
	const snapshot = { ...base, document: { ...base.document, scrollWidth: 1300 } }
	expect(selectors(viewportReflow, snapshot)).toEqual(["page"])
	expect(selectors(viewportReflow, base)).toEqual([])
})

test("#given overflowing words and a wider clipped track #then the real uncontained text owns the overflow", () => {
	const base = buildSnapshot([
		{ id: "words", text: "Unbroken text", rect: { x: 20, width: 200 }, lineRects: [{ x: 20, y: 0, width: 1400, height: 20 }] },
		{ id: "window", style: { "overflow-x": "hidden" }, rect: { width: 1280 }, children: [{ id: "track", rect: { width: 6000 } }] },
	])
	const snapshot = { ...base, document: { ...base.document, scrollWidth: 1420 } }
	expect(viewportReflow.check({ snapshot, config: {} })[0]?.message).toContain("#words")
})
