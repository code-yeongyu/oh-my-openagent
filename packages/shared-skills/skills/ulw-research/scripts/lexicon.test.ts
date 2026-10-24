import { describe, expect, test } from "bun:test"

import { CAUSAL, CONCESSIVE, DIRECTION, HEDGES, NEGATION, QUALIFIERS, SCOPE_NARROW_TO_BROAD } from "./lexicon.mjs"

const LISTS = { HEDGES, QUALIFIERS, CAUSAL, CONCESSIVE, NEGATION, SCOPE_NARROW_TO_BROAD } as const

describe("lexicon", () => {
	test("given each exported list when read then it is non-empty and frozen", () => {
		for (const [name, list] of Object.entries(LISTS)) {
			expect({ name, length: list.length > 0 }).toEqual({ name, length: true })
			expect({ name, frozen: Object.isFrozen(list) }).toEqual({ name, frozen: true })
		}
		expect(Object.isFrozen(DIRECTION)).toBe(true)
		expect(Object.isFrozen(DIRECTION.up)).toBe(true)
		expect(Object.isFrozen(DIRECTION.down)).toBe(true)
		for (const pair of SCOPE_NARROW_TO_BROAD) expect(Object.isFrozen(pair)).toBe(true)
	})

	test("given HEDGES when read then it carries the named English and Korean hedges", () => {
		const english = ["estimated", "about", "approximately", "may", "might", "expected", "forecast", "provisional", "not yet"]
		const korean = ["추정", "약", "가능", "전망", "예상", "잠정", "아직", "미확정", "것으로 보인다"]
		expect(HEDGES).toEqual(expect.arrayContaining([...english, ...korean]))
	})

	test("given QUALIFIERS when read then it is exactly the closed bilingual list", () => {
		const korean = ["최대", "최소", "약", "이상", "이하", "미만", "초과", "내외", "까지"]
		const english = ["up to", "at least", "at most", "about", "approximately", "nearly", "over", "under", "more than", "less than"]
		expect([...QUALIFIERS].sort()).toEqual([...korean, ...english].sort())
	})

	test("given DIRECTION when read then up and down carry both languages", () => {
		expect(DIRECTION.up).toEqual(expect.arrayContaining(["증가", "상승", "늘", "increase", "rise", "grow", "up"]))
		expect(DIRECTION.down).toEqual(expect.arrayContaining(["감소", "하락", "줄", "decrease", "fall", "decline", "down"]))
	})

	test("given CAUSAL, CONCESSIVE and NEGATION when read then they carry the named connectives", () => {
		expect(CAUSAL).toEqual(
			expect.arrayContaining(["because", "due to", "leads to", "results in", "causes", "therefore", "때문에", "로 인해", "따라서", "그래서", "초래"]),
		)
		expect(CONCESSIVE).toEqual(
			expect.arrayContaining(["although", "but", "however", "despite", "while", "으나", "지만", "에도 불구하고", "반면", "와 달리"]),
		)
		expect(NEGATION).toEqual(expect.arrayContaining(["not", "no", "never", "않", "없", "못"]))
	})

	test("given SCOPE_NARROW_TO_BROAD when read then it carries the named narrow-to-broad pairs", () => {
		expect(SCOPE_NARROW_TO_BROAD).toEqual(
			expect.arrayContaining([
				["북미", "전 세계"],
				["pilot", "system"],
				["one region", "all regions"],
				["일부", "전체"],
				["한 지역", "전국"],
			]),
		)
	})
})
