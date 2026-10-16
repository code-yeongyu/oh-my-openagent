import { describe, expect, it } from "bun:test"
import type { RecallDocument } from "./provider"
import {
  CJK_CORPUS_MIN_SHARE,
  LARGE_CORPUS_MIN_DOCUMENTS,
  chooseRecallStrategy,
  corpusCjkShare,
  hasCjk,
} from "./strategy"

function doc(path: string, description: string, body: string): RecallDocument {
  return { path, description, body }
}

function englishCorpus(count: number): RecallDocument[] {
  return Array.from({ length: count }, (_, index) => doc(`notes/n${index}.md`, "Deploy notes", "rollback the canary"))
}

describe("hasCjk", () => {
  it("#given Hangul, Han, Hiragana, Katakana and the prolonged sound mark #when checked #then each counts as CJK", () => {
    // given
    const samples = ["배포", "发布", "ひらがな", "カタカナ", "\u30fc"]

    // when
    const results = samples.map(hasCjk)

    // then
    expect(results).toEqual([true, true, true, true, true])
  })

  it("#given Latin, Cyrillic, digits and fullwidth punctuation #when checked #then none counts as CJK", () => {
    // given
    const samples = ["rollback", "откат", "2026", "。、", ""]

    // when
    const results = samples.map(hasCjk)

    // then
    expect(results).toEqual([false, false, false, false, false])
  })
})

describe("corpusCjkShare", () => {
  it("#given an English-only corpus #when measured #then the share is zero", () => {
    // given
    const documents = englishCorpus(3)

    // when
    const share = corpusCjkShare(documents)

    // then
    expect(share).toBe(0)
  })

  it("#given mixed letters #when measured #then the share counts CJK code points over all letter code points", () => {
    // given: description "ab" + body "배포" -> 2 CJK of 4 letters; digits and spaces are not letters
    const documents = [doc("a.md", "ab", "배포 42 !")]

    // when
    const share = corpusCjkShare(documents)

    // then
    expect(share).toBe(0.5)
  })

  it("#given an empty corpus #when measured #then the share is zero", () => {
    // given
    const documents: RecallDocument[] = []

    // when
    const share = corpusCjkShare(documents)

    // then
    expect(share).toBe(0)
  })
})

describe("chooseRecallStrategy", () => {
  it("#given English queries over a small English corpus #when chosen #then the substring path is kept", () => {
    // given
    const documents = englishCorpus(10)

    // when
    const strategy = chooseRecallStrategy(documents, ["rollback", '"canary deploy"'])

    // then
    expect(strategy).toBe("substring")
  })

  it("#given one planned query with a CJK character over an English corpus #when chosen #then bm25 is picked", () => {
    // given
    const documents = englishCorpus(10)

    // when
    const strategy = chooseRecallStrategy(documents, ["rollback", "퍼블리시할"])

    // then
    expect(strategy).toBe("bm25")
  })

  it("#given English queries and a corpus exactly at the CJK share threshold #when chosen #then bm25 is picked", () => {
    // given: 1 Hangul letter among 1 / CJK_CORPUS_MIN_SHARE letters is exactly the threshold
    const latin = Math.round(1 / CJK_CORPUS_MIN_SHARE) - 1
    const documents = [doc("a.md", "", `배${"a".repeat(latin)}`)]

    // when
    const strategy = chooseRecallStrategy(documents, ["rollback"])

    // then
    expect(corpusCjkShare(documents)).toBeCloseTo(CJK_CORPUS_MIN_SHARE, 10)
    expect(strategy).toBe("bm25")
  })

  it("#given English queries and a corpus just below the CJK share threshold #when chosen #then substring is kept", () => {
    // given: one Hangul letter among one more Latin letter than the threshold case
    const latin = Math.round(1 / CJK_CORPUS_MIN_SHARE)
    const documents = [doc("a.md", "", `배${"a".repeat(latin)}`)]

    // when
    const strategy = chooseRecallStrategy(documents, ["rollback"])

    // then
    expect(corpusCjkShare(documents)).toBeLessThan(CJK_CORPUS_MIN_SHARE)
    expect(strategy).toBe("substring")
  })

  it("#given an English corpus one note below the large threshold #when chosen #then substring is kept", () => {
    // given
    const documents = englishCorpus(LARGE_CORPUS_MIN_DOCUMENTS - 1)

    // when
    const strategy = chooseRecallStrategy(documents, ["rollback"])

    // then
    expect(strategy).toBe("substring")
  })

  it("#given an English corpus exactly at the large threshold #when chosen #then hybrid is picked", () => {
    // given
    const documents = englishCorpus(LARGE_CORPUS_MIN_DOCUMENTS)

    // when
    const strategy = chooseRecallStrategy(documents, ["rollback"])

    // then
    expect(strategy).toBe("hybrid")
  })

  it("#given a CJK query over a large corpus #when chosen #then hybrid is picked because its bm25 half already carries CJK bigrams", () => {
    // given
    const documents = englishCorpus(LARGE_CORPUS_MIN_DOCUMENTS)

    // when
    const strategy = chooseRecallStrategy(documents, ["퍼블리시할"])

    // then
    expect(strategy).toBe("hybrid")
  })
})
