import { describe, expect, test } from "bun:test"

import { finalReading, rewriteParticle } from "./particles-ko.mjs"

describe("finalReading", () => {
	test("given a value ending in a Hangul syllable when read then the final consonant decides", () => {
		expect(finalReading("3조 8,000억 원", null)).toBe("closed")
		expect(finalReading("5조", null)).toBe("open")
		expect(finalReading("7달", null)).toBe("l")
	})

	test("given a value ending in a unit token when read then the unit's Korean reading decides", () => {
		expect(finalReading("15.2%", null)).toBe("open")
		expect(finalReading("3.1%p", null)).toBe("open")
		expect(finalReading("320 m", null)).toBe("open")
		expect(finalReading("12 kg", null)).toBe("closed")
	})

	test("given a value ending in a digit when read then the Sino-Korean reading decides", () => {
		expect(finalReading("4,200", null)).toBe("closed")
		expect(finalReading("1", null)).toBe("l")
		expect(finalReading("2", null)).toBe("open")
		expect(finalReading("3", null)).toBe("closed")
		expect(finalReading("7", null)).toBe("l")
		expect(finalReading("8", null)).toBe("l")
		expect(finalReading("9", null)).toBe("open")
		expect(finalReading("6.5", null)).toBe("open")
	})

	test("given an integer whose spoken end is jo when read then the magnitude decides, not the last zero", () => {
		expect(finalReading("1000000000000", null)).toBe("open")
		expect(finalReading("10,000", null)).toBe("closed")
	})

	test("given a round integer past one jo when read then the last 10^4 group word decides, not sip/baek/cheon", () => {
		expect(finalReading("10000000000000", null)).toBe("open")
		expect(finalReading("100000000000000", null)).toBe("open")
		expect(finalReading("1000000000000000", null)).toBe("open")
		expect(finalReading("100000", null)).toBe("closed")
		expect(finalReading("1000000000", null)).toBe("closed")
	})

	test("given an explicit unit token when read then it overrides the value text", () => {
		expect(finalReading("15.2", "%")).toBe("open")
		expect(finalReading("15", "kg")).toBe("closed")
	})

	test("given an unknown trailing token when read then no reading is claimed", () => {
		expect(finalReading("12 zorks", null)).toBeNull()
	})
})

describe("rewriteParticle", () => {
	test("given an object particle with a boundary after an open value when rewritten then it becomes the open form", () => {
		expect(rewriteParticle("을 기록", "open")).toEqual({ text: "를 기록", applied: true, candidate: true })
	})

	test("given a bare particle at end of string when rewritten then it is applied", () => {
		expect(rewriteParticle("은", "open")).toEqual({ text: "는", applied: true, candidate: true })
	})

	test("given a particle-like prefix with no boundary when rewritten then it stays untouched and is flagged as a candidate", () => {
		expect(rewriteParticle("이상 기록", "closed")).toEqual({ text: "이상 기록", applied: false, candidate: true })
		expect(rewriteParticle("이상.", "open")).toEqual({ text: "이상.", applied: false, candidate: true })
	})

	test("given English or a non-particle word when rewritten then nothing changes and it is not a candidate", () => {
		expect(rewriteParticle(" is the span", "open")).toEqual({ text: " is the span", applied: false, candidate: false })
		expect(rewriteParticle("기록했다", "open")).toEqual({ text: "기록했다", applied: false, candidate: false })
	})

	test("given each particle pair when rewritten then the reading picks the form", () => {
		expect(rewriteParticle("이 올랐다", "open").text).toBe("가 올랐다")
		expect(rewriteParticle("가 올랐다", "closed").text).toBe("이 올랐다")
		expect(rewriteParticle("는,", "l").text).toBe("은,")
		expect(rewriteParticle("과 함께", "open").text).toBe("와 함께")
		expect(rewriteParticle("와 함께", "l").text).toBe("과 함께")
		expect(rewriteParticle("로 늘었다", "closed").text).toBe("으로 늘었다")
		expect(rewriteParticle("으로 늘었다", "l").text).toBe("로 늘었다")
		expect(rewriteParticle("으로 늘었다", "open").text).toBe("로 늘었다")
	})

	test("given no reading when rewritten then a candidate is left unchanged", () => {
		expect(rewriteParticle("을 기록", null)).toEqual({ text: "을 기록", applied: false, candidate: true })
	})
})
