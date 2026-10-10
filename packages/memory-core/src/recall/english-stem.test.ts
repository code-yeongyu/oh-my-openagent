import { describe, expect, it } from "bun:test"
import { rankRecallDocumentsBm25, recallTerms } from "./bm25"
import { stemEnglishToken } from "./english-stem"

describe("stemEnglishToken", () => {
  it("#given inflected forms of one word #when folded #then they meet on one term", () => {
    // given
    const families = [
      ["rollback", "rollbacks"],
      ["deploy", "deploys", "deployed", "deploying", "deployment"],
      ["rotate", "rotated", "rotating", "rotation"],
      ["policy", "policies"],
      ["patch", "patches"],
      ["stop", "stopped", "stopping"],
      ["kill", "killing", "killed"],
      ["week", "weekly"],
    ]

    // when
    const folded = families.map((family) => new Set(family.map(stemEnglishToken)))

    // then
    for (const set of folded) expect(set.size).toBe(1)
  })

  it("#given short words and words ending in us, is or ss #when folded #then they are kept whole", () => {
    // given
    const kept = ["bus", "is", "this", "status", "analysis", "pass", "was", "red"]

    // when
    const folded = kept.map(stemEnglishToken)

    // then
    expect(folded).toEqual(kept)
  })

  it("#given CJK, digit and mixed tokens #when folded #then they pass through untouched", () => {
    // given
    const tokens = ["롤백은", "롤백", "デプロイ", "部署", "2026", "v2", "k8s", "café"]

    // when
    const folded = tokens.map(stemEnglishToken)

    // then
    expect(folded).toEqual(tokens)
  })
})

describe("recallTerms", () => {
  it("#given mixed Korean and English text #when terms are built #then English is folded and CJK bigrams stay as tokenized", () => {
    // given
    const text = "rollbacks가 잦으면 배포를 멈춘다"

    // when
    const terms = recallTerms(text)

    // then
    expect(terms).toContain("rollback")
    expect(terms).not.toContain("rollbacks")
    expect(terms).toEqual(expect.arrayContaining(["잦으면", "잦으", "으면", "배포를", "배포", "포를"]))
  })
})

describe("rankRecallDocumentsBm25 with English suffixes", () => {
  it("#given a note that says rollbacks #when the query says rollback #then bm25 finds it", () => {
    // given
    const documents = [
      { path: "reference/ko/english-mixed.md", description: "카나리 배포 정책", body: "rollbacks가 잦으면 canary 비율을 낮춘다" },
      { path: "reference/ko/coffee.md", description: "커피 원두", body: "원두는 금요일에 채운다" },
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["rollback", "spike", "policy"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["reference/ko/english-mixed.md"])
  })
})
