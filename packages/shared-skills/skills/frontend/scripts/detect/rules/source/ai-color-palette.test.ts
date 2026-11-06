import { expect, test } from "bun:test"
import { aiColorPalette } from "./ai-color-palette"
import { checkSource } from "./support/check-source"

test.each([
	['<h1 className="text-purple-500" />', 1],
	['<div className="text-purple-500 text-3xl" />', 1],
	['<div className="from-purple-500 to-cyan-400" />', 1],
	['<p className="text-purple-500" />', 0],
	['<div className="from-red-500 to-orange-400" />', 0],
])("#given palette source %s #then returns %i findings", (source, count) => {
	expect(checkSource(aiColorPalette, source)).toHaveLength(count)
})
