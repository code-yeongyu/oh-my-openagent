import { expect, test } from "bun:test"
import { aphoristicCadence } from "./aphoristic-cadence"
import { checkSource } from "./support/check-source"

test.each([
	[`<html><p>${"Not a tool. A whole new world. ".repeat(3)}</p></html>`, 1],
	[`<html><p>${"Not a tool. A whole new world. ".repeat(2)}</p></html>`, 0],
	["<html><p>Export invoices, send reports, and compare totals.</p></html>", 0],
	["Not a tool. A whole new world. ".repeat(3), 0],
])("#given clipped page copy #then returns %i findings", (source, count) => {
	expect(checkSource(aphoristicCadence, source, { path: "a.svelte" })).toHaveLength(count)
})
