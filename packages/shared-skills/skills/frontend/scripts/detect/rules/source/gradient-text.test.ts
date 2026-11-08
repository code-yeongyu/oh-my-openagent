import { expect, test } from "bun:test"
import { gradientText } from "./gradient-text"
import { checkSource } from "./support/check-source"

test.each([
	['<h1 className="bg-gradient-to-r bg-clip-text" />', 1],
	['<h1 className="bg-clip-text bg-blue-500" />', 0],
	[".a {background:linear-gradient(red,blue);\nbackground-clip:text;\n-webkit-background-clip:text}", 1],
	[".a{background:blue;background-clip:text}", 0],
])("#given gradient source %s #then returns %i findings", (source, count) => {
	expect(checkSource(gradientText, source, { path: "a.css" })).toHaveLength(count)
})
