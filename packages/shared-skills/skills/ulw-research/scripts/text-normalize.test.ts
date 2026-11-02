import { describe, expect, test } from "bun:test"

import { findNormalized, normalizeText, tokenize } from "./text-normalize.mjs"

describe("normalizeText", () => {
	test("#given NFD and NFC Korean #when normalized #then both are equal NFC strings", () => {
		// given
		const nfc = "매출은 한국어로 적었다"
		const nfd = nfc.normalize("NFD")
		// when
		const a = normalizeText(nfd)
		const b = normalizeText(nfc)
		// then
		expect(nfd).not.toBe(nfc)
		expect(a).toBe(b)
		expect(a).toBe(nfc)
	})

	test("#given curly and CJK quote glyphs #when normalized #then they become straight quotes", () => {
		// given
		const raw = "\u201Cgrowth\u201D \u2018ok\u2019 \u300Cquoted\u300D \u300Etitle\u300F \u00ABfr\u00BB"
		// when
		const out = normalizeText(raw)
		// then
		expect(out).toBe("\"growth\" 'ok' \"quoted\" \"title\" \"fr\"")
	})

	test("#given runs of mixed whitespace #when normalized #then they collapse to single spaces and are trimmed", () => {
		// when
		const out = normalizeText("  a \t\n b\u00A0\u00A0c  ")
		// then
		expect(out).toBe("a b c")
	})
})

describe("tokenize", () => {
	test("#given Latin words and Hangul eojeol with punctuation #when tokenized #then tokens split on whitespace and punctuation", () => {
		// when
		const tokens = tokenize("Revenue rose, 매출은 100억 원이다. (\u201Cok\u201D)")
		// then
		expect(tokens).toEqual(["Revenue", "rose", "매출은", "100억", "원이다", "ok"])
	})
})

describe("findNormalized", () => {
	test("#given raw text with double spaces and curly quotes #when a straight-quoted needle is found #then RAW offsets slice back to the raw substring", () => {
		// given
		const hay = "He said  \u201Cgrowth  is\n strong\u201D  today."
		// when
		const hit = findNormalized(hay, "\"growth is strong\"")
		// then
		if (hit === null) throw new Error("needle not found")
		expect(hay.slice(hit.start, hit.end)).toBe("\u201Cgrowth  is\n strong\u201D")
	})

	test("#given NFD Korean raw text with double spaces #when an NFC needle is found #then RAW offsets slice the NFD substring", () => {
		// given
		const rawNfc = "앞 문장. 매출은  100억 원이다. 끝"
		const hay = rawNfc.normalize("NFD")
		const expected = "매출은  100억 원이다".normalize("NFD")
		// when
		const hit = findNormalized(hay, "매출은 100억 원이다")
		// then
		if (hit === null) throw new Error("needle not found")
		expect(hay.slice(hit.start, hit.end)).toBe(expected)
	})

	test("#given a needle absent from the text #when searched #then null is returned", () => {
		// when / then
		expect(findNormalized("abc", "zzz")).toBeNull()
		expect(findNormalized("abc", "   ")).toBeNull()
	})
})
