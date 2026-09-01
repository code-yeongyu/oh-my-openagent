import { describe, expect, it } from "bun:test"
import type { SearchDocument, TranscriptConversation, TranscriptProvider } from "./index"
import { searchTranscripts } from "./index"

function fakeProvider(conversations: TranscriptConversation[]): TranscriptProvider {
  return { listConversations: () => conversations }
}

function conversation(id: string, messages: SearchDocument[], hidden?: boolean): TranscriptConversation {
  return hidden === undefined ? { id, messages } : { id, messages, hidden }
}

function message(input: {
  id: string
  conversationId?: string
  content: string
  date?: string
}): SearchDocument {
  const conversationId = input.conversationId ?? "c1"
  return input.date === undefined
    ? { id: input.id, conversationId, messageType: "user_message", content: input.content }
    : { id: input.id, conversationId, messageType: "user_message", content: input.content, date: input.date }
}

describe("searchTranscripts", () => {
  it("#given documents with different first-match indices #when searched #then results sort by ascending score", () => {
    // given
    // normalized haystack is "user_message <content>", so content offsets start at 13.
    // near: "beta" at 13 -> 13 + 46. far: "alpha gamma delta beta" puts "beta" at 13 + 18 = 31 -> 31 + 46.
    const provider = fakeProvider([
      conversation("c1", [
        message({ id: "far", content: "alpha gamma delta beta" }),
        message({ id: "near", content: "beta later" }),
      ]),
    ])

    // when
    const results = searchTranscripts(provider, "beta")

    // then
    expect(results.map((result) => result.messageId)).toEqual(["near", "far"])
    expect(results[0]?.score).toBe(13 + 46)
    expect(results[1]?.score).toBe(31 + 46)
  })

  it("#given equal scores #when searched #then ties break on descending date", () => {
    // given
    const provider = fakeProvider([
      conversation("c1", [
        message({ id: "older", content: "beta", date: "2026-01-01T00:00:00.000Z" }),
        message({ id: "newer", content: "beta", date: "2026-05-01T00:00:00.000Z" }),
      ]),
    ])

    // when
    const results = searchTranscripts(provider, "beta")

    // then
    expect(results[0]?.score).toBe(results[1]?.score)
    expect(results.map((result) => result.messageId)).toEqual(["newer", "older"])
  })

  it("#given more matches than the limit #when searched #then the default limit is 100 and explicit limits truncate", () => {
    // given
    const messages = Array.from({ length: 120 }, (_, index) =>
      message({ id: `m${index}`, content: "beta", date: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z` }),
    )
    const provider = fakeProvider([conversation("c1", messages)])

    // when
    const defaulted = searchTranscripts(provider, "beta")
    const limited = searchTranscripts(provider, "beta", { limit: 5 })
    const zero = searchTranscripts(provider, "beta", { limit: 0 })

    // then
    expect(defaulted).toHaveLength(100)
    expect(limited).toHaveLength(5)
    expect(zero).toEqual([])
  })

  it("#given an empty or term-free query #when searched #then no results are returned", () => {
    // given
    const provider = fakeProvider([conversation("c1", [message({ id: "m1", content: "beta" })])])

    // when
    const blank = searchTranscripts(provider, "   ")
    const emptyQuotes = searchTranscripts(provider, '""')

    // then
    expect(blank).toEqual([])
    expect(emptyQuotes).toEqual([])
  })

  it("#given date bounds #when searched #then bounds are inclusive and undated messages stay eligible", () => {
    // given
    const provider = fakeProvider([
      conversation("c1", [
        message({ id: "before", content: "beta", date: "2025-12-31T23:59:59.000Z" }),
        message({ id: "onStart", content: "beta", date: "2026-01-01T00:00:00.000Z" }),
        message({ id: "after", content: "beta", date: "2026-03-01T00:00:00.000Z" }),
        message({ id: "undated", content: "beta" }),
      ]),
    ])

    // when
    const results = searchTranscripts(provider, "beta", {
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
    })

    // then
    expect(results.map((result) => result.messageId).sort()).toEqual(["onStart", "undated"])
  })

  it("#given hidden conversations #when searched #then they are excluded unless includeHidden is set", () => {
    // given
    const provider = fakeProvider([
      conversation("c1", [message({ id: "visible", content: "beta" })]),
      conversation("c2", [message({ id: "concealed", conversationId: "c2", content: "beta" })], true),
    ])

    // when
    const defaulted = searchTranscripts(provider, "beta")
    const withHidden = searchTranscripts(provider, "beta", { includeHidden: true })

    // then
    expect(defaulted.map((result) => result.messageId)).toEqual(["visible"])
    expect(withHidden.map((result) => result.messageId).sort()).toEqual(["concealed", "visible"])
  })

  it("#given a conversation filter #when searched #then only that conversation contributes results", () => {
    // given
    const provider = fakeProvider([
      conversation("c1", [message({ id: "m1", content: "beta" })]),
      conversation("c2", [message({ id: "m2", conversationId: "c2", content: "beta" })]),
    ])

    // when
    const results = searchTranscripts(provider, "beta", { conversationId: "c2" })

    // then
    expect(results.map((result) => result.messageId)).toEqual(["m2"])
    expect(results[0]?.conversationId).toBe("c2")
  })

  it("#given a phrase plus term query #when searched #then only documents matching every term and phrase are returned", () => {
    // given
    const provider = fakeProvider([
      conversation("c1", [
        message({ id: "both", content: "deploy the quick brown fox" }),
        message({ id: "phraseOnly", content: "the quick brown fox" }),
        message({ id: "termOnly", content: "deploy the brown quick fox" }),
      ]),
    ])

    // when
    const results = searchTranscripts(provider, 'deploy "quick brown"')

    // then
    expect(results.map((result) => result.messageId)).toEqual(["both"])
  })

  it("#given a matched document #when results are built #then identity fields are carried through", () => {
    // given
    const provider = fakeProvider([
      conversation("c1", [message({ id: "m1", content: "beta", date: "2026-04-01T10:00:00.000Z" })]),
    ])

    // when
    const [result] = searchTranscripts(provider, "beta")

    // then
    expect(result?.messageId).toBe("m1")
    expect(result?.conversationId).toBe("c1")
    expect(result?.createdAt).toBe("2026-04-01T10:00:00.000Z")
    expect(result?.document.content).toBe("beta")
  })
})
