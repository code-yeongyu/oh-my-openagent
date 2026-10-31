import { expect, test } from "bun:test"
import { monotonousSpacing } from "./monotonous-spacing"
import { marked } from "./support/layout-cases"

test("#given ten repeated utility gaps and varied controls #then only the repeated scale reports", () => {
	expect(marked(monotonousSpacing, Array.from({ length: 10 }, () => ({ attributes: { class: "p-4" } })))).toEqual(["page"])
	expect(marked(monotonousSpacing, Array.from({ length: 10 }, (_, i) => ({ attributes: { class: `p-${i + 1}` } })))).toEqual([])
})

test("#given repeated CSS lengths and zero resets #then only nonzero dominant spacing reports", () => {
	expect(marked(monotonousSpacing, [], { cssText: Array.from({ length: 10 }, (_, i) => `.x${i} { padding: 16px; }`) })).toEqual(["page"])
	expect(marked(monotonousSpacing, Array.from({ length: 20 }, () => ({ attributes: { class: "p-0" } })))).toEqual([])
})

test("#given rem declarations with a small sample #then the ten sample floor is enforced", () => {
	const css = Array.from({ length: 10 }, (_, i) => `.x${i} { margin: 1rem; }`)
	expect(marked(monotonousSpacing, [], { cssText: css })).toEqual(["page"])
	expect(marked(monotonousSpacing, [], { cssText: css.slice(0, 9) })).toEqual([])
})
