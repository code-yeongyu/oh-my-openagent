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
})
