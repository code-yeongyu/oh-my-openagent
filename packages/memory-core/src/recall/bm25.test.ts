import { describe, expect, it } from "bun:test"
import type { RecallDocument } from "./provider"
import { RECALL_EXPANSION_WEIGHTS, rankRecallDocumentsBm25, recallExpansionWeights, tokenizeRecallText } from "./bm25"

function doc(path: string, description: string, body: string): RecallDocument {
  return { path, description, body }
}

describe("tokenizeRecallText", () => {
  it("#given latin text #when tokenized #then it yields lowercased word tokens", () => {
    // given
    const text = "Rollback the Lighthouse deploy, v2.1!"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["rollback", "the", "lighthouse", "deploy", "v2", "1"])
  })

  it("#given a Hangul run #when tokenized #then the run and its character bigrams are emitted", () => {
    // given
    const text = "퍼블리시할"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["퍼블리시할", "퍼블", "블리", "리시", "시할"])
  })

  it("#given latin and Hangul glued together #when tokenized #then the scripts split into separate tokens", () => {
    // given
    const text = "api키 설정"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["api", "키", "설정"])
  })

  it("#given Han and Kana text #when tokenized #then bigrams are emitted like Hangul and Han characters also stand alone", () => {
    // given
    const text = "記憶検索 メモリ"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["記憶検索", "記憶", "憶検", "検索", "記", "憶", "検", "索", "メモリ", "メモ", "モリ"])
  })

  it("#given a run mixing kanji and kana #when tokenized #then only the Han characters stand alone", () => {
    // given
    const text = "東京に行く"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["東京に行く", "東京", "京に", "に行", "行く", "東", "京", "行"])
  })

  it("#given a lone Han character next to a Han word #when tokenized #then the lone character is emitted once", () => {
    // given
    const text = "鍵 保管"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["鍵", "保管", "保", "管"])
  })

  it("#given a katakana word with a prolonged sound mark #when tokenized #then it stays one run with bigrams", () => {
    // given
    const text = "\u30b5\u30fc\u30d0\u30fc"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["\u30b5\u30fc\u30d0\u30fc", "\u30b5\u30fc", "\u30fc\u30d0", "\u30d0\u30fc"])
  })

  it("#given ideographic punctuation between CJK words #when tokenized #then the punctuation splits the runs", () => {
    // given
    const text = "\u8a18\u61b6\u3002\u691c\u7d22"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["\u8a18\u61b6", "\u8a18", "\u61b6", "\u691c\u7d22", "\u691c", "\u7d22"])
  })

  it("#given decomposed accented latin words #when tokenized #then marks compose or stay inside the word", () => {
    // given: x + U+0301 has no precomposed form, so NFKC keeps the combining mark
    const text = "cafe\u0301 x\u0301y menu"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["caf\u00e9", "x\u0301y", "menu"])
  })

  it("#given a two-character run outside the basic plane #when tokenized #then no duplicate bigram is emitted and each character stands alone", () => {
    // given
    const text = "\u{20000}\u{20001}"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["\u{20000}\u{20001}", "\u{20000}", "\u{20001}"])
  })

  it("#given NFD Hangul and full-width Latin #when tokenized #then they tokenize like their NFKC forms", () => {
    // given
    const decomposed = "퍼블리시할".normalize("NFD")
    const fullWidth = "ＮＰＭ 토큰"

    // when / then
    expect(tokenizeRecallText(decomposed)).toEqual(tokenizeRecallText("퍼블리시할"))
    expect(tokenizeRecallText(fullWidth)).toEqual(["npm", "토큰"])
  })

  it("#given a lone Hangul syllable #when tokenized #then no bigram or single character is emitted and only an identical token can match", () => {
    // given / when / then: a note that stores a lone Hangul or kana syllable is unreachable from a longer query word
    expect(tokenizeRecallText("키 보관")).toEqual(["키", "보관"])
  })

  it("#given a run mixing Hangul and Hanja #when tokenized #then only the Han characters stand alone", () => {
    // given
    const text = "韓國어"

    // when
    const tokens = tokenizeRecallText(text)

    // then
    expect(tokens).toEqual(["韓國어", "韓國", "國어", "韓", "國"])
  })

  it("#given punctuation and quotes only #when tokenized #then nothing is emitted", () => {
    // given / when / then
    expect(tokenizeRecallText(`" -- ! "`)).toEqual([])
  })
})

describe("rankRecallDocumentsBm25", () => {
  it("#given an inflected Korean query term #when ranked #then the note holding the stem matches through shared bigrams", () => {
    // given
    const documents = [
      doc("reference/publish.md", "npm 퍼블리시 절차", "토큰은 키체인에 있다"),
      doc("reference/other.md", "휴가 계획", "다음 달 여행"),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["퍼블리시할"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["reference/publish.md"])
  })

  it("#given a Chinese question sharing only single characters with a note #when ranked #then the note matches", () => {
    // given: no two-character piece of the question occurs in either note
    const documents = [
      doc("reference/zh/expenses.md", "报销规定", "差旅报销上限为每天五百元"),
      doc("reference/zh/meeting.md", "周会安排", "每周一上午开周会"),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["出差能报多少钱"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["reference/zh/expenses.md"])
  })

  it("#given a query word longer than a note's lone Han character #when ranked #then the note matches", () => {
    // given
    const documents = [
      doc("reference/ja/key.md", "鍵 保管", "受付の引き出し"),
      doc("reference/ja/lunch.md", "昼食", "食堂は二階"),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["鍵束"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["reference/ja/key.md"])
  })

  it("#given notes of equal token count where one holds a Han run #when a Latin term matches both #then their scores are equal", () => {
    // given: five tokens each before the stand-alone Han characters, which must not count as length
    const documents = [
      doc("notes/zh.md", "deploy", "部署流程"),
      doc("notes/en.md", "deploy", "one two three four"),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["deploy"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["notes/en.md", "notes/zh.md"])
    expect(ranked[0]?.score).toBe(ranked[1]?.score)
  })

  it("#given query terms of different rarity #when ranked #then the document holding the rarer term ranks first", () => {
    // given
    const documents = [
      doc("notes/a.md", "Session notes", "session session review"),
      doc("notes/b.md", "Session notes", "session tmux targeting"),
      doc("notes/c.md", "Session notes", "session cleanup"),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["session", "tmux"])

    // then
    expect(ranked[0]?.document.path).toBe("notes/b.md")
    expect(ranked.map((entry) => entry.document.path).sort()).toEqual(["notes/a.md", "notes/b.md", "notes/c.md"])
  })

  it("#given one-term matches of equal tf and length #when ranked #then idf alone lifts the rarer term", () => {
    // given
    const documents = [
      doc("notes/a.md", "one", "session alpha"),
      doc("notes/b.md", "two", "session beta"),
      doc("notes/z.md", "three", "tmux gamma"),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["session", "tmux"])

    // then
    expect(ranked[0]?.document.path).toBe("notes/z.md")
  })

  it("#given a match only in the description #when ranked #then the description counts as document text", () => {
    // given
    const documents = [doc("notes/a.md", "kubernetes ingress", "nothing else here"), doc("notes/b.md", "cooking", "pasta")]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["ingress"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["notes/a.md"])
  })

  it("#given no shared token #when ranked #then nothing is returned", () => {
    // given
    const documents = [doc("notes/a.md", "cooking", "pasta and sauce")]

    // when / then
    expect(rankRecallDocumentsBm25(documents, ["kubernetes"])).toEqual([])
  })

  it("#given equal scores #when ranked #then the path breaks the tie deterministically", () => {
    // given
    const documents = [doc("notes/z.md", "Same", "tmux rules"), doc("notes/a.md", "Same", "tmux rules")]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["tmux"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["notes/a.md", "notes/z.md"])
    expect(ranked[0]?.score).toBe(ranked[1]?.score ?? Number.NaN)
  })

  it("#given quoted planner phrases #when ranked #then quotes are ignored and the phrase words score", () => {
    // given
    const documents = [doc("notes/a.md", "Ingress", "the ingress gateway is flaky"), doc("notes/b.md", "Other", "gateway only")]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ['"ingress gateway"'])

    // then
    expect(ranked[0]?.document.path).toBe("notes/a.md")
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked[1]?.score ?? 0)
  })

  it("#given the same document array #when ranked repeatedly #then the index is built once", () => {
    // given
    let bodyReads = 0
    const document: RecallDocument = {
      path: "notes/a.md",
      description: "tmux",
      get body(): string {
        bodyReads += 1
        return "exact session targeting"
      },
    }
    const documents = [document]

    // when
    for (let call = 0; call < 3; call += 1) rankRecallDocumentsBm25(documents, ["tmux"])

    // then
    expect(bodyReads).toBe(1)
  })
})

describe("rankRecallDocumentsBm25 with expansions", () => {
  const filler = "alpha beta gamma delta"

  it("#given a note worded differently from the query #when the caller adds a synonym #then the note is found", () => {
    // given
    const documents = [
      doc("notes/revert.md", "Release", `revert the release when the canary fails ${filler}`),
      doc("notes/other.md", "Lunch", `order noodles on friday ${filler}`),
    ]

    // when
    const plain = rankRecallDocumentsBm25(documents, ["undo shipment"])
    const widened = rankRecallDocumentsBm25(documents, ["undo shipment"], { synonyms: ["revert", "release"] })

    // then
    expect(plain).toEqual([])
    expect(widened.map((entry) => entry.document.path)).toEqual(["notes/revert.md"])
  })

  it("#given notes matching a query word, a synonym and a related term #when ranked #then the closer the term the higher the note", () => {
    // given (equal lengths and one note per term, so only the weight decides; paths sort the other way)
    const documents = [
      doc("notes/c-literal.md", "One", `undo ${filler}`),
      doc("notes/b-synonym.md", "One", `revert ${filler}`),
      doc("notes/a-related.md", "One", `canary ${filler}`),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["undo shipment"], { synonyms: ["revert"], related: ["canary"] })

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["notes/c-literal.md", "notes/b-synonym.md", "notes/a-related.md"])
    const [literal, synonym, related] = ranked.map((entry) => entry.score)
    expect(synonym).toBeCloseTo((literal ?? 0) * 0.75, 10)
    expect(related).toBeCloseTo((literal ?? 0) * 0.4, 10)
  })

  it("#given a note holding every query word and a note rich in added terms #when ranked #then the full match stays first", () => {
    // given
    const documents = [
      doc("notes/z-exact.md", "Runbook", `deploy ${Array.from({ length: 40 }, () => filler).join(" ")}`),
      doc("notes/a-warm.md", "Rollout", "rollout release ship rollout release ship"),
      doc("notes/m-none.md", "Lunch", `order noodles on friday ${filler}`),
    ]
    const expansions = { synonyms: ["rollout", "release", "ship"] }

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["deploy"], expansions)

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["notes/z-exact.md", "notes/a-warm.md"])
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? Number.POSITIVE_INFINITY)
  })

  it("#given several notes holding every query word #when the search is widened #then they keep the order they have without expansions", () => {
    // given
    const documents = [
      doc("notes/long.md", "Runbook", `deploy rollout rollout rollout ${Array.from({ length: 30 }, () => filler).join(" ")}`),
      doc("notes/short.md", "Runbook", "deploy checklist"),
      doc("notes/warm.md", "Rollout", "rollout rollout"),
    ]

    // when
    const plain = rankRecallDocumentsBm25(documents, ["deploy"]).map((entry) => entry.document.path)
    const widened = rankRecallDocumentsBm25(documents, ["deploy"], { synonyms: ["rollout"] }).map((entry) => entry.document.path)

    // then
    expect(plain).toEqual(["notes/short.md", "notes/long.md"])
    expect(widened).toEqual(["notes/short.md", "notes/long.md", "notes/warm.md"])
  })

  it("#given an added term the query already holds #when ranked #then the word is not counted twice", () => {
    // given
    const documents = [
      doc("notes/a.md", "Deploy", `deploy deploy ${filler}`),
      doc("notes/b.md", "Deploy", `deploy rollback ${filler} ${filler}`),
    ]

    // when
    const plain = rankRecallDocumentsBm25(documents, ["deploy rollback"])
    const widened = rankRecallDocumentsBm25(documents, ["deploy rollback"], { synonyms: ["Deploy"], related: ["deploys"] })

    // then
    expect(widened).toEqual(plain)
  })

  it("#given no expansions or empty ones #when ranked #then the ranking equals the two-argument call", () => {
    // given
    const documents = [
      doc("notes/a.md", "Deploy", `deploy the lighthouse service ${filler}`),
      doc("notes/b.md", "배포", "퍼블리시 절차와 배포 체크리스트"),
      doc("notes/c.md", "鍵", "鍵束は玄関の棚に保管する"),
    ]

    // when / then
    for (const query of ["deploy lighthouse", "퍼블리시할 배포", "鍵の保管"]) {
      const plain = rankRecallDocumentsBm25(documents, [query])
      expect(rankRecallDocumentsBm25(documents, [query], undefined)).toEqual(plain)
      expect(rankRecallDocumentsBm25(documents, [query], {})).toEqual(plain)
      expect(rankRecallDocumentsBm25(documents, [query], { synonyms: [], keywords: [" "], noteLine: "" })).toEqual(plain)
    }
  })

  it("#given a Korean query and English keywords #when ranked #then the English note is found below a Korean match", () => {
    // given
    const documents = [
      doc("notes/en.md", "Anniversary", `dinner reservation at le blanc for the anniversary ${filler}`),
      doc("notes/ko.md", "기념일", `한남동 식당 예약 메모 ${filler}`),
    ]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["한남동 예약"], { keywords: ["dinner reservation", "anniversary"] })

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["notes/ko.md", "notes/en.md"])
  })
})

describe("rankRecallDocumentsBm25 on a very long unbroken run", () => {
  it("#given a note that is one run of a million Han characters #when ranked #then it is indexed instead of overflowing the call stack", () => {
    // given
    const documents = [doc("notes/long.md", "", "漢".repeat(1_000_000))]

    // when
    const ranked = rankRecallDocumentsBm25(documents, ["漢"])

    // then
    expect(ranked.map((entry) => entry.document.path)).toEqual(["notes/long.md"])
  })
})

describe("recallExpansionWeights", () => {
  it("#given a term in several tiers and a term of the query #when weighed #then the highest tier wins and the query term is left out", () => {
    // given
    const expansions = { synonyms: ["canary"], related: ["canary oven", "deploy"], noteLine: "watch the canary for ten hours" }

    // when
    const weights = recallExpansionWeights(expansions, new Set(["deploy"]))

    // then
    expect(weights.get("canary")).toBe(0.75)
    expect(weights.get("oven")).toBe(0.4)
    expect(weights.get("ten")).toBe(0.4)
    expect(weights.has("deploy")).toBe(false)
  })

  it("#given the tiers #when their weights are read #then a closer tier never weighs less than a looser one and none reaches a query word", () => {
    expect(RECALL_EXPANSION_WEIGHTS.synonyms).toBeLessThan(1)
    expect(RECALL_EXPANSION_WEIGHTS.keywords).toBeLessThan(1)
    expect(RECALL_EXPANSION_WEIGHTS.related).toBeLessThan(RECALL_EXPANSION_WEIGHTS.synonyms)
    expect(RECALL_EXPANSION_WEIGHTS.noteLine).toBeLessThan(RECALL_EXPANSION_WEIGHTS.keywords)
  })
})
