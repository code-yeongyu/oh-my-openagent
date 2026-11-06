import { expect, test } from "bun:test"
import { monotonousSpacing } from "./monotonous-spacing"
import { checkSource } from "./support/check-source"

test.each([
	[`<html>${'<div class="p-4"></div>'.repeat(10)}</html>`, 1],
	[`<html>${'<div class="p-0"></div>'.repeat(10)}</html>`, 0],
	[`<html>${'<div class="p-4"></div>'.repeat(9)}</html>`, 0],
	[`<html>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<div class="p-${n}"></div>`).join("")}</html>`, 0],
	['<div class="p-4"></div>'.repeat(10), 0],
])("#given page spacing source #then returns %i findings", (source, count) => {
	expect(checkSource(monotonousSpacing, source, { path: "a.astro" })).toHaveLength(count)
})
