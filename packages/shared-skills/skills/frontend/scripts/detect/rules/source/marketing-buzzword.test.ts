import { expect, test } from "bun:test"
import { marketingBuzzword } from "./marketing-buzzword"
import { checkSource } from "./support/check-source"

test.each([
	["<html><p>Streamline your work.</p></html>", 1],
	["<html><p>Export invoices as CSV.</p></html>", 0],
	["<html><script>const label='Streamline your work'</script><p>Export invoices.</p></html>", 0],
	["<p>Streamline your work.</p>", 0],
])("#given marketing page source #then returns %i findings", (source, count) => {
	expect(checkSource(marketingBuzzword, source, { path: "a.vue" })).toHaveLength(count)
})
