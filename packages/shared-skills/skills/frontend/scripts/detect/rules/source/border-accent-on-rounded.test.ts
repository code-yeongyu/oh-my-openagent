import { expect, test } from "bun:test"
import { borderAccentOnRounded } from "./border-accent-on-rounded"
import { checkSource } from "./support/check-source"

test.each([
	['<div className="rounded-lg border-t-2" />', "a.tsx", 1],
	['<div className="rounded-none border-t-2" />', "a.tsx", 0],
	['<div className="rounded-full border-t-2 animate-spin" />', "a.tsx", 0],
	[".a{border-bottom:3px solid red}\n\n\n\n\n.a{border-radius:12px}", "a.css", 1],
	[".a{border-bottom:3px solid red}\n.b{border-radius:12px}", "a.css", 0],
	[".a{border-bottom:2px solid red;border-radius:12px}", "a.css", 0],
])("#given border source %s #then returns expected findings", (source, path, count) => {
	expect(checkSource(borderAccentOnRounded, source, { path })).toHaveLength(count)
})
