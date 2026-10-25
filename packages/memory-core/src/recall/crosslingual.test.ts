import { describe, expect, test } from "bun:test"

import {
  CROSSLINGUAL_MAX_CARDS,
  CROSSLINGUAL_MODEL,
  CrosslingualRerankError,
  aggregatePreferences,
  crosslingualPassage,
  decisionScores,
  expandedUnion,
  mergeTop,
  pairPacket,
  pairwiseOrder,
  pointwisePacket,
  rerankRecallCandidatesCrosslingual,
  type CrosslingualCard,
  type DecisionPacket,
} from "./crosslingual"
import { rankRecallDocumentsBm25, recallTerms, tokenizeRecallText } from "./bm25"
import { buildExcerpt } from "./excerpt"
import type { RecallDocument } from "./provider"

const lexical = { rankBm25: rankRecallDocumentsBm25, terms: recallTerms, tokens: tokenizeRecallText, excerpt: buildExcerpt }

const card = (path: string, snippet = `excerpt ${path}`): CrosslingualCard => ({ path, title: `title ${path}`, snippet })

function answer(scores: readonly number[], model = CROSSLINGUAL_MODEL): unknown {
  return { model, answers: Object.fromEntries(scores.map((noul, index) => [`c${index}`, { type: "noul", noul }])) }
}

function strengthJudge(strength: Record<string, number>, firstBias = 0) {
  const packets: DecisionPacket[] = []
  const decide = async (packet: DecisionPacket): Promise<unknown> => {
    packets.push(packet)
    const keys = Object.keys(packet.questions)
    const cards = packet.state.cards
    if (keys.length === 1 && Object.keys(cards).length === 2) {
      const first = strength[cards.c0?.identity ?? ""] ?? 0
      const second = strength[cards.c1?.identity ?? ""] ?? 0
      return answer([Math.min(1, (first > second ? 0.75 : first < second ? 0.25 : 0.5) + firstBias)])
    }
    return answer(keys.map((key) => strength[cards[key]?.identity ?? ""] ?? 0))
  }
  return { decide, packets }
}

describe("crosslingual packets", () => {
  test("#given eight cards #when a pointwise packet is built #then one scalar question per card", () => {
    const packet = pointwisePacket("question", Array.from({ length: 8 }, (_, i) => card(`n${i}.md`)))
    expect(Object.keys(packet.state.cards)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"])
    expect(packet.questions.c3?.instructions.startsWith("Use state.cards.c3 only.")).toBe(true)
    expect(packet.model).toBe(CROSSLINGUAL_MODEL)
  })

  test("#given nine cards or duplicates #when packets are built #then they are refused", () => {
    expect(() => pointwisePacket("q", Array.from({ length: CROSSLINGUAL_MAX_CARDS + 1 }, (_, i) => card(`n${i}`)))).toThrow(CrosslingualRerankError)
    expect(() => pointwisePacket("q", [card("a"), card("a")])).toThrow(CrosslingualRerankError)
    expect(() => pairPacket("q", card("a"), card("a"))).toThrow(CrosslingualRerankError)
    expect(() => pointwisePacket("q", [card("a", "x".repeat(1501))])).toThrow(CrosslingualRerankError)
  })

  test("#given a pair #when its packet is built #then two cards carry one question", () => {
    const packet = pairPacket("q", card("a"), card("b"))
    expect(Object.keys(packet.state.cards)).toEqual(["c0", "c1"])
    expect(Object.keys(packet.questions)).toEqual(["c0"])
    expect(packet.state.cards.c0?.identity).toBe("a")
  })

  test("#given a title over 200 UTF-16 units #when packed #then it is clipped without splitting a surrogate", () => {
    const title = `${"a".repeat(199)}😀tail`
    const packet = pointwisePacket("q", [{ path: "p", title, snippet: "s" }])
    expect(packet.state.cards.c0?.description).toBe("a".repeat(199))
  })
})

describe("crosslingual answer validation", () => {
  test.each([
    ["another model", answer([0.5], "other/model")],
    ["missing answer", { model: CROSSLINGUAL_MODEL, answers: {} }],
    ["extra answer", answer([0.5, 0.5])],
    ["out of range", answer([1.5])],
    ["wrong type", { model: CROSSLINGUAL_MODEL, answers: { c0: { type: "choice", noul: 0.5 } } }],
  ])("#given %s #when validated #then it throws", (_, response) => {
    expect(() => decisionScores(response, 1)).toThrow(CrosslingualRerankError)
  })
})

describe("crosslingual stages", () => {
  test("#given ranked channels #when unioned #then the original prefix stays first and repeats drop", () => {
    expect(expandedUnion([["a", "b", "c"], ["c", "d"], ["a", "e"]], 2)).toEqual(["a", "b", "c", "d", "e"])
  })

  test("#given a long body #when the passage is chosen #then the window holds the rare query term", () => {
    const body = `${"filler ".repeat(400)}autoscaler threshold${" filler".repeat(400)}`
    const passage = crosslingualPassage("autoscaler", body, new Map([["autoscaler", 1]]), 100)
    expect(Array.from(passage).length).toBe(1500)
    expect(passage).toContain("autoscaler")
  })

  test("#given shared cards #when merged #then the mean decides and ties keep BM25 position", () => {
    const top = mergeTop([card("a"), card("b"), card("c")], [0.9, 0.2, 0.5], [card("b"), card("d")], [1.0, 0.5], 3)
    expect(top.map((item) => item.path)).toEqual(["a", "b", "c"])
  })

  test("#given a judge that always prefers the first card #when ordered #then the parent order is kept", () => {
    const totals = new Map<string, number>()
    for (let i = 0; i < 5; i += 1) for (let j = i + 1; j < 5; j += 1) totals.set(`${i}:${j}`, (0.75 + 1 - 0.75) / 2)
    expect(aggregatePreferences(5, totals).map((row) => row.index)).toEqual([0, 1, 2, 3, 4])
  })

  test("#given a position-biased judge #when five cards are ordered pairwise #then strength alone decides", async () => {
    const strength = { a: 0.1, b: 0.2, c: 0.9, d: 0.5, e: 0.7 }
    const { decide, packets } = strengthJudge(strength, 0.25)
    const ordered = await pairwiseOrder(decide, "q", ["a", "b", "c", "d", "e"].map((path) => card(path)))
    expect(ordered.map((row) => row.card.path)).toEqual(["c", "e", "d", "b", "a"])
    expect(packets).toHaveLength(20)
  })

  test("#given missing pairs #when aggregated #then it throws", () => {
    expect(() => aggregatePreferences(3, new Map([["0:1", 0.5]]))).toThrow(CrosslingualRerankError)
  })
})

describe("rerankRecallCandidatesCrosslingual", () => {
  const documents: RecallDocument[] = [
    { path: "deploy/rollback.md", description: "Rollback runbook", body: "Roll back the canary deployment with the release tool." },
    { path: "infra/autoscaler.md", description: "Cluster autoscaler", body: "The cluster autoscaler threshold is 70 percent CPU." },
    { path: "notes/ko-autoscaler.md", description: "오토스케일러 설정", body: "클러스터 오토스케일러 임계값은 CPU 70퍼센트입니다." },
    { path: "misc/lunch.md", description: "Lunch", body: "Team lunch is on Friday." },
  ]

  test("#given a Korean question with an English view #when reranked #then the English note is reachable and judged first", async () => {
    const { decide } = strengthJudge({ "infra/autoscaler.md": 0.95, "notes/ko-autoscaler.md": 0.6 })
    const withoutView = await rerankRecallCandidatesCrosslingual(documents, { query: "오토스케일러 임계값", decide, lexical, maxItems: 5, surfaced: new Set() })
    expect(withoutView.map((row) => row.path)).not.toContain("infra/autoscaler.md")
    const withView = await rerankRecallCandidatesCrosslingual(documents, {
      query: "오토스케일러 임계값",
      views: ["cluster autoscaler threshold"],
      decide,
      lexical,
      maxItems: 2,
      surfaced: new Set(),
    })
    expect(withView.map((row) => row.path)).toEqual(["infra/autoscaler.md", "notes/ko-autoscaler.md"])
    expect(withView[0]!.score).toBeLessThan(withView[1]!.score)
  })

  test("#given surfaced and excluded notes #when reranked #then they are never sent to the judge", async () => {
    const { decide, packets } = strengthJudge({})
    await rerankRecallCandidatesCrosslingual(documents, {
      query: "autoscaler rollback",
      decide,
      lexical,
      maxItems: 5,
      surfaced: new Set(["infra/autoscaler.md"]),
      excludePaths: new Set(["deploy/rollback.md"]),
    })
    const sent = packets.flatMap((packet) => Object.values(packet.state.cards).map((value) => value.identity))
    expect(sent).not.toContain("infra/autoscaler.md")
    expect(sent).not.toContain("deploy/rollback.md")
  })

  test("#given a judge that fails #when reranked #then the error propagates for the caller's fallback", async () => {
    const decide = async (): Promise<unknown> => answer([2])
    await expect(rerankRecallCandidatesCrosslingual(documents, { query: "autoscaler", decide, lexical, maxItems: 2, surfaced: new Set() }))
      .rejects.toThrow(CrosslingualRerankError)
  })
})
