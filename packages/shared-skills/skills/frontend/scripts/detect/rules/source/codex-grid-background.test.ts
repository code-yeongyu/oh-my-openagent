import { expect, test } from "bun:test"
import { codexGridBackground } from "./codex-grid-background"
import { checkSource } from "./support/check-source"

test.each([
	[".grid{background:linear-gradient(red 1px, transparent 1px),linear-gradient(90deg, red 1px, transparent 1px);background-size:24px 24px}", 1],
	[".line{background:linear-gradient(red 1px, transparent 1px);background-size:24px 24px}", 0],
	[".grid{background:linear-gradient(red 1px, transparent 1px),linear-gradient(90deg, red 1px, transparent 1px)}", 0],
])("#given background source %s #then returns %i findings", (source, count) => {
	expect(checkSource(codexGridBackground, source, { path: "a.css" })).toHaveLength(count)
})
