import { expect, test } from "bun:test"
import { grayOnColor } from "./gray-on-color"
import { checkSource } from "./support/check-source"

test.each([
	['<div className="text-gray-400 bg-blue-500" />', 1],
	['<div className="text-gray-700 bg-blue-500" />', 0],
	['<div className="text-gray-400 bg-blue-100" />', 0],
	['<div className="text-gray-400 bg-blue-500/10" />', 0],
	['<div className="text-gray-400 hover:bg-blue-500" />', 0],
	['<div className="text-gray-400" /><div className="bg-blue-500" />', 0],
	['<div className={active ? "text-gray-400" : "bg-blue-500"} />', 0],
	['<div className={active ? "text-gray-400 bg-blue-500" : "text-white"} />', 1],
	['<button className={`px-4 ${mode === "a" ? "bg-amber-600 text-white" : "text-slate-400"}`}>Mode</button>', 0],
	['<div className={a ? "bg-red-500" : b ? "text-slate-400" : "bg-blue-600"} />', 0],
	['<button className={cn("text-slate-400", mode === "a" ? "bg-amber-600" : "bg-white")}>Go</button>', 1],
	['<div className={cn(a ? "bg-red-500" : "bg-blue-600", "text-slate-400")} />', 1],
])("#given utility scope %s #then returns %i findings", (source, count) => {
	expect(checkSource(grayOnColor, source)).toHaveLength(count)
})
