import { expect, test } from "bun:test"
import { emDashOveruse } from "./em-dash-overuse"
import { checkSource } from "./support/check-source"

test.each([
	[`<html><p>${"a &mdash; b ".repeat(8)}</p></html>`, 1],
	[`<html><p>${"a -- b ".repeat(8)}</p></html>`, 1],
	[`<html><p>${"a --- b ".repeat(8)}</p></html>`, 0],
	[`<html><p>${"a &mdash; b ".repeat(7)}</p></html>`, 0],
	[`<html><p>${"a &mdash; b ".repeat(8)}${"x".repeat(5000)}</p></html>`, 0],
])("#given page dash source #then returns %i findings", (source, count) => {
	expect(checkSource(emDashOveruse, source, { path: "a.astro" })).toHaveLength(count)
})
