import { describe, expect, test } from "bun:test"

import { splitSentences } from "./sentence-split.mjs"

type Sentence = { sid: string; start: number; end: number; text: string }

function at(records: Sentence[], index: number): Sentence {
	const record = records[index]
	if (record === undefined) throw new Error(`no sentence at index ${index}`)
	return record
}

function expectSlices(text: string, records: Sentence[]): void {
	for (const record of records) expect(text.slice(record.start, record.end)).toBe(record.text)
}

describe("splitSentences", () => {
	test("#given a Korean paragraph with da/yo/nida endings #when split #then sids and offsets match each sentence", () => {
		// given
		const text = "매출은 100억 원입니다. 비용도 늘었어요. 이익은 줄었다.다만 회복이 기대된다."
		// when
		const records = splitSentences(text) as Sentence[]
		// then
		expect(records.map((r) => r.sid)).toEqual(["s1", "s2", "s3", "s4"])
		expect(records.map((r) => r.text)).toEqual([
			"매출은 100억 원입니다.",
			"비용도 늘었어요.",
			"이익은 줄었다.",
			"다만 회복이 기대된다.",
		])
		expect(at(records, 1).start).toBe(text.indexOf("비용도"))
		expectSlices(text, records)
	})

	test("#given an English paragraph with abbreviations and decimals #when split #then e.g. and 3.2 do not end a sentence", () => {
		// given
		const text = "Use units, e.g. 3.2 m per bar. The next one follows! Is it fine? Yes."
		// when
		const records = splitSentences(text) as Sentence[]
		// then
		expect(records.map((r) => r.sid)).toEqual(["s1", "s2", "s3", "s4"])
		expect(records.map((r) => r.text)).toEqual([
			"Use units, e.g. 3.2 m per bar.",
			"The next one follows!",
			"Is it fine?",
			"Yes.",
		])
		expect(at(records, 3).start).toBe(text.indexOf("Yes."))
		expect(at(records, 3).end).toBe(text.length)
		expectSlices(text, records)
	})

	test("#given line breaks and blank lines #when split #then each non-empty line yields its own record", () => {
		// given
		const text = "매출은 100억 원이다. 다만 아직 확정되지 않았다.\n\n  Second line without stop\nThird?"
		// when
		const records = splitSentences(text) as Sentence[]
		// then
		expect(records.map((r) => r.text)).toEqual([
			"매출은 100억 원이다.",
			"다만 아직 확정되지 않았다.",
			"Second line without stop",
			"Third?",
		])
		expect(records.map((r) => r.sid)).toEqual(["s1", "s2", "s3", "s4"])
		expectSlices(text, records)
	})

	test("#given Korean quoted speech closed right after a da ending #when split #then the quote stays inside one sentence", () => {
		// given
		const single = '그는 "매출이 늘었다."라고 말했다.'
		const pair = '그는 "매출이 늘었다."라고 말했다. 다음 날 떨어졌다.'
		const bracket = "그는 「좋아요.」라고 답했다."
		// when
		const singleRecords = splitSentences(single) as Sentence[]
		const pairRecords = splitSentences(pair) as Sentence[]
		const bracketRecords = splitSentences(bracket) as Sentence[]
		// then
		expect(singleRecords.map((r) => r.text)).toEqual([single])
		expect(pairRecords.map((r) => r.text)).toEqual(['그는 "매출이 늘었다."라고 말했다.', "다음 날 떨어졌다."])
		expect(pairRecords.map((r) => r.sid)).toEqual(["s1", "s2"])
		expect(at(pairRecords, 0).start).toBe(0)
		expect(at(pairRecords, 1).start).toBe(pair.indexOf("다음 날"))
		expect(at(pairRecords, 1).end).toBe(pair.length)
		expect(bracketRecords.map((r) => r.text)).toEqual([bracket])
		expectSlices(pair, pairRecords)
	})

	test("#given the word no #when split #then it is an abbreviation only before a number", () => {
		// given
		const answer = "The answer was no. Then we left."
		const numbered = "See No. 5 for details. Then stop."
		// when
		const answerRecords = splitSentences(answer) as Sentence[]
		const numberedRecords = splitSentences(numbered) as Sentence[]
		// then
		expect(answerRecords.map((r) => r.text)).toEqual(["The answer was no.", "Then we left."])
		expect(at(answerRecords, 1).start).toBe(answer.indexOf("Then"))
		expect(numberedRecords.map((r) => r.text)).toEqual(["See No. 5 for details.", "Then stop."])
		expectSlices(answer, answerRecords)
		expectSlices(numbered, numberedRecords)
	})

	test("#given empty or whitespace-only text #when split #then no records are produced", () => {
		// when / then
		expect(splitSentences("")).toEqual([])
		expect(splitSentences(" \n\t\n")).toEqual([])
	})
})
