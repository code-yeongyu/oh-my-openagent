import { expect, test } from "bun:test"
import { radialHalo } from "./radial-halo"
import { checkSource } from "./support/check-source"

test.each([
	["body{background:#000}.a{background:radial-gradient(#a855f7,transparent 70%)}", 1],
	["body{background:#fff}.a{background:radial-gradient(#a855f7,transparent 70%)}", 0],
	["body{background:#000}.a{background:radial-gradient(#777,transparent 70%)}", 0],
	["body{background:#000}.a{background:radial-gradient(#a855f7 2px,transparent 4px)}", 0],
	["body{background:#000}.a{background:repeating-radial-gradient(#a855f7,transparent 70%)}", 0],
	["body{background:#fff}.glass{background:rgba(18,20,26,0.86)}.a{background:radial-gradient(#a855f7,transparent 70%)}", 0],
	["body{background:rgba(18,20,26,0.86)}.a{background:radial-gradient(#a855f7,transparent 70%)}", 1],
	[":root{--background:#000}.a{background:radial-gradient(#a855f7,transparent 70%)}", 0],
])("#given radial source %s #then returns %i findings", (source, count) => {
	expect(checkSource(radialHalo, `<html><style>${source}</style></html>`, { path: "a.astro" })).toHaveLength(count)
})
