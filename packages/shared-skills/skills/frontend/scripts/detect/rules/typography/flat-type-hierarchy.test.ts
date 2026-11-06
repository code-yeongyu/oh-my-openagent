import { expect, test } from "bun:test"
import { buildSnapshot } from "../../testing/build-snapshot"
import { flatTypeHierarchy } from "./flat-type-hierarchy"

const nodes = (tag: string, size: number, count = 1) => Array.from({ length: count }, () => ({
	tag, text: "Ordinary visible text for this role", style: { "font-size": `${size}px` },
}))
const check = (specs: Parameters<typeof buildSnapshot>[0]) => flatTypeHierarchy.check({ snapshot: buildSnapshot(specs), config: {} })

test("#given compressed roles and a strong ramp #then only the compressed hierarchy reports", () => {
	expect(check([...nodes("h1", 18), ...nodes("h2", 16), ...nodes("h3", 15), ...nodes("p", 14)])).toHaveLength(1)
	expect(check([...nodes("h1", 48), ...nodes("h2", 30), ...nodes("h3", 22), ...nodes("p", 16)])).toEqual([])
	expect(check([...nodes("h1", 16), ...nodes("p", 16)])).toEqual([])
})

test("#given tied h1 sizes and an h1 label #then neither flattens the visible ladder", () => {
	expect(check([...nodes("h1", 66.56), ...nodes("h1", 48.64), ...nodes("h2", 18.4, 4), ...nodes("h3", 20.8, 4), ...nodes("p", 17, 3)])).toEqual([])
	expect(check([...nodes("h1", 14), ...nodes("h2", 15, 3), ...nodes("p", 16, 3)])).toEqual([])
	expect(check([...nodes("h1", 16), ...nodes("h2", 15, 3), ...nodes("p", 16, 3)])).toHaveLength(1)
})

test("#given dropped heading roles #then their possible sizes must not break the ladder", () => {
	const base = [...nodes("h1", 16), ...nodes("h2", 16, 3), ...nodes("p", 14, 4)]
	expect(check([...base, ...nodes("h3", 14, 3), ...nodes("h3", 16, 3), ...nodes("h3", 20, 3)])).toEqual([])
	expect(check([...nodes("h1", 18), ...nodes("h3", 16), ...nodes("p", 16, 6), ...nodes("h2", 17, 3), ...nodes("h2", 18, 3)])).toHaveLength(1)
})

test("#given near-tied heading sizes and body chips #then only settled text roles determine flatness", () => {
	expect(check([...nodes("h1", 16), ...nodes("p", 16, 12), ...nodes("h2", 16, 12), ...nodes("h2", 24, 10), ...nodes("h3", 18, 3)])).toEqual([])
	expect(check([...nodes("h1", 18), ...nodes("h2", 16), ...nodes("p", 16, 3),
		...Array.from({ length: 20 }, () => ({ tag: "td", text: "GG", style: { "font-size": "24px" } })),
	])).toHaveLength(1)
})
