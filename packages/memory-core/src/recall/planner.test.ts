import { describe, expect, it } from "bun:test"
import { planRecallQueries } from "./planner"

describe("planRecallQueries", () => {
  it("#given no texts #when queries are planned #then no query is emitted", () => {
    // given / when
    const queries = planRecallQueries([])
    // then
    expect(queries).toEqual([])
  })

  it("#given only stopword chatter #when queries are planned #then no query is emitted", () => {
    // given / when
    const queries = planRecallQueries(["What is it?", "Yes, please."])
    // then
    expect(queries).toEqual([])
  })

  it("#given a distinctive newest text #when queries are planned #then lowercase terms and verbatim bigram phrases come out", () => {
    // given
    const texts = [
      "Can you check the Kubernetes ingress controller setup?",
      "Sure, I will look at the database schema next.",
    ]

    // when
    const queries = planRecallQueries(texts)

    // then (single terms are bare, bigrams are quoted phrases of adjacent kept terms)
    expect(queries).toEqual([
      "kubernetes",
      "controller",
      '"kubernetes ingress"',
      '"ingress controller"',
    ])
  })

  it("#given a term repeated across every text #when queries are planned #then rarer terms outrank the repeated one", () => {
    // given
    const texts = [
      "The memory cache eviction policy still feels wrong",
      "We tuned the memory cache again yesterday",
      "The memory cache keeps evicting hot entries",
    ]

    // when
    const queries = planRecallQueries(texts)

    // then ("memory" and "cache" appear in all three texts, so unique terms win the slots)
    expect(queries).toEqual([
      "eviction",
      "policy",
      '"memory cache"',
      '"cache eviction"',
    ])
  })

  it("#given a newest text without kept terms #when queries are planned #then the next text tops up", () => {
    // given
    const texts = [
      "Yes, do it.",
      "Please summarize the kubernetes rollout status",
    ]

    // when
    const queries = planRecallQueries(texts)

    // then
    expect(queries).toEqual([
      "kubernetes",
      "summarize",
      '"kubernetes rollout"',
      '"rollout status"',
    ])
  })

  it("#given a text rich in distinctive terms #when queries are planned #then at most four queries are emitted", () => {
    // given
    const texts = [
      "Kubernetes ingress controller cert-manager webhook hooks failed during rollout",
      "The postgres replication lag dashboard alarmed overnight",
    ]

    // when
    const queries = planRecallQueries(texts)

    // then
    expect(queries.length).toBeLessThanOrEqual(4)
    for (const query of queries) {
      expect(query.split(" ").length).toBeLessThanOrEqual(2)
    }
  })

  it("#given the same input twice #when queries are planned #then the output is deterministic", () => {
    // given
    const texts = ["Retry the webhook deployment once more", "The webhook keeps timing out"]

    // when
    const first = planRecallQueries(texts)
    const second = planRecallQueries(texts)

    // then
    expect(second).toEqual(first)
  })

  it("#given short or stopword tokens #when queries are planned #then terms under three characters and stopwords drop", () => {
    // given
    const texts = ["Run go vet on the api repo"]

    // when
    const queries = planRecallQueries(texts)

    // then ("go" is under three characters, "on"/"the" are stopwords; the single
    // verbatim adjacent kept pair is "api repo")
    expect(queries).toEqual(["repo", "run", '"api repo"'])
  })

  describe("Korean (Hangul) support", () => {
    it("#given Korean-only conversation texts #when queries are planned #then Hangul terms and bigram phrases are emitted", () => {
      // given
      const texts = ["메모리 시스템 리콜 플래너를 점검해줘"]

      // when
      const queries = planRecallQueries(texts)

      // then (Hangul survives tokenization; ranking stays deterministic)
      expect(queries).toEqual([
        "플래너를",
        "점검해줘",
        '"메모리 시스템"',
        '"시스템 리콜"',
      ])
    })

    it("#given a Korean-only complaint #when queries are planned #then at least one query carries Hangul", () => {
      // given / when
      const queries = planRecallQueries(["어제 메모리 리콜이 한국어 대화에서 안 떴어"])

      // then
      expect(queries.length).toBeGreaterThan(0)
      expect(queries.some((query) => /[가-힣]/.test(query))).toBe(true)
    })

    it("#given mixed Korean and English texts #when queries are planned #then both scripts contribute terms", () => {
      // given
      const texts = ["내일 kubernetes 배포 전에 메모리 캐시 정책 다시 보자"]

      // when
      const queries = planRecallQueries(texts)

      // then
      expect(queries).toEqual([
        "kubernetes",
        "메모리",
        '"내일 kubernetes"',
        '"kubernetes 배포"',
      ])
    })

    it("#given Korean stopword chatter #when queries are planned #then no query is emitted", () => {
      // given / when
      const queries = planRecallQueries(["그리고 그래서 그냥 진짜"])

      // then
      expect(queries).toEqual([])
    })

    it("#given two-syllable Korean keywords #when queries are planned #then they survive the minimum length filter", () => {
      // given ("리콜" is two syllables: a complete Korean content word)
      const texts = ["리콜 검색"]

      // when
      const queries = planRecallQueries(texts)

      // then
      expect(queries).toEqual(["리콜", "검색", '"리콜 검색"'])
    })
  })
})
