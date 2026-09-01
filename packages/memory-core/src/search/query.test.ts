import { describe, expect, it } from "bun:test"
import { dateInRange, matchScore, normalizeText, parseQuery, searchableText } from "./index"

// Golden values are hand-computed from letta transcript-search.ts:203-275:
//   score = sum(term first-match index + max(0, 50 - term.length)) + 0.1 * phrase first-match index
// Every index below is an index into the NORMALIZED haystack (lowercased, whitespace collapsed).

describe("normalizeText", () => {
  it("#given mixed case and padded whitespace #when normalized #then it lowercases, collapses runs and trims", () => {
    // given
    const raw = "  ALPHA \n\t Beta   GAMMA  "

    // when
    const normalized = normalizeText(raw)

    // then
    expect(normalized).toBe("alpha beta gamma")
  })
})

describe("parseQuery", () => {
  it("#given bare terms and a double-quoted phrase #when parsed #then terms and phrases are separated", () => {
    // given
    const query = 'foo "bar baz" qux'

    // when
    const parsed = parseQuery(query)

    // then
    expect(parsed.terms).toEqual(["foo", "qux"])
    expect(parsed.phrases).toEqual(["bar baz"])
  })

  it("#given repeated whitespace between terms #when parsed #then empty fragments are dropped", () => {
    // given
    const query = "  alpha    beta \n gamma  "

    // when
    const parsed = parseQuery(query)

    // then
    expect(parsed.terms).toEqual(["alpha", "beta", "gamma"])
    expect(parsed.phrases).toEqual([])
  })

  it("#given an unclosed quote #when parsed #then it falls back to raw whitespace terms keeping the quote character", () => {
    // given
    const query = 'foo "bar baz'

    // when
    const parsed = parseQuery(query)

    // then
    expect(parsed.terms).toEqual(["foo", '"bar', "baz"])
    expect(parsed.phrases).toEqual([])
  })

  it("#given empty quotes and blank input #when parsed #then nothing is produced", () => {
    // given
    const emptyPhrase = '""'

    // when
    const parsed = parseQuery(emptyPhrase)
    const blank = parseQuery("   ")

    // then
    expect(parsed.terms).toEqual([])
    expect(parsed.phrases).toEqual([])
    expect(blank.terms).toEqual([])
    expect(blank.phrases).toEqual([])
  })

  it("#given mixed-case input #when parsed #then case is preserved for match-time normalization", () => {
    // given
    const query = 'Foo "Bar Baz"'

    // when
    const parsed = parseQuery(query)

    // then
    expect(parsed.terms).toEqual(["Foo"])
    expect(parsed.phrases).toEqual(["Bar Baz"])
  })
})

describe("matchScore golden formula", () => {
  it("#given one term #when scored #then score is first index plus the short-term bonus", () => {
    // given
    const text = "alpha beta gamma"

    // when
    const score = matchScore(text, parseQuery("beta"))

    // then
    expect(score).toBe(6 + 46)
  })

  it("#given two terms #when scored #then per-term contributions sum", () => {
    // given
    const text = "alpha beta gamma"

    // when
    const score = matchScore(text, parseQuery("alpha gamma"))

    // then
    expect(score).toBe(0 + 45 + (11 + 45))
  })

  it("#given a term of 50 characters or more #when scored #then the length bonus floors at zero", () => {
    // given
    const long = "a".repeat(55)

    // when
    const score = matchScore(long, parseQuery(long))

    // then
    expect(score).toBe(0)
  })

  it("#given a quoted phrase #when scored #then the phrase contributes a tenth of its first index", () => {
    // given
    const text = "alpha beta gamma"

    // when
    const score = matchScore(text, parseQuery('"beta gamma"'))

    // then
    expect(score).toBeCloseTo(0.6, 10)
  })

  it("#given a phrase and a term #when scored #then phrase and term contributions combine", () => {
    // given
    const text = "alpha beta gamma"

    // when
    const score = matchScore(text, parseQuery('alpha "beta gamma"'))

    // then
    expect(score).toBeCloseTo(0 + 45 + 6 * 0.1, 10)
  })

  it("#given a term that is absent #when scored #then the match is rejected because all terms must match", () => {
    // given
    const text = "alpha beta gamma"

    // when
    const score = matchScore(text, parseQuery("alpha delta"))

    // then
    expect(score).toBeNull()
  })

  it("#given a phrase whose words appear out of order #when scored #then the phrase does not match", () => {
    // given
    const text = "alpha beta gamma"

    // when
    const score = matchScore(text, parseQuery('"gamma beta"'))

    // then
    expect(score).toBeNull()
  })

  it("#given mixed case and padded text #when scored #then matching is case-insensitive over normalized text", () => {
    // given
    const text = "   ALPHA \n  Beta  "

    // when
    const score = matchScore(text, parseQuery("BETA"))

    // then
    expect(score).toBe(6 + 46)
  })

  it("#given an unclosed-quote query #when scored #then the retained quote character must appear literally", () => {
    // given
    const withQuote = 'say foo "bar now'
    const withoutQuote = "say foo bar now"

    // when
    const matched = matchScore(withQuote, parseQuery('foo "bar'))
    const rejected = matchScore(withoutQuote, parseQuery('foo "bar'))

    // then
    expect(matched).toBe(4 + 47 + (8 + 46))
    expect(rejected).toBeNull()
  })

  it("#given empty text #when scored #then nothing matches", () => {
    // given
    const text = "   "

    // when
    const score = matchScore(text, parseQuery("alpha"))

    // then
    expect(score).toBeNull()
  })
})

describe("searchableText", () => {
  it("#given every searchable field #when composed #then type, content, reasoning, summary, tool names, args and return are joined", () => {
    // given
    const document = {
      id: "m1",
      conversationId: "c1",
      messageType: "assistant_message",
      content: [{ text: "visible answer" }, { text: "second block" }],
      reasoning: "hidden thought",
      summary: "compacted summary",
      toolCalls: [{ name: "bash", arguments: '{"cmd":"ls"}' }],
      toolReturn: { stdout: "listing" },
    }

    // when
    const text = searchableText(document)

    // then
    expect(text).toBe(
      [
        "assistant_message",
        "visible answer\nsecond block",
        "hidden thought",
        "compacted summary",
        "bash",
        '{"cmd":"ls"}',
        '{"stdout":"listing"}',
      ].join("\n"),
    )
  })

  it("#given a string content and no optional fields #when composed #then empty parts are dropped", () => {
    // given
    const document = { id: "m2", conversationId: "c1", messageType: "user_message", content: "plain text" }

    // when
    const text = searchableText(document)

    // then
    expect(text).toBe("user_message\nplain text")
  })
})

describe("dateInRange", () => {
  it("#given inclusive bounds #when a message sits on a boundary #then it stays eligible", () => {
    // given
    const start = "2026-01-01T00:00:00.000Z"
    const end = "2026-01-31T23:59:59.000Z"

    // when
    const onStart = dateInRange(start, start, end)
    const onEnd = dateInRange(end, start, end)
    const outside = dateInRange("2026-02-01T00:00:00.000Z", start, end)

    // then
    expect(onStart).toBe(true)
    expect(onEnd).toBe(true)
    expect(outside).toBe(false)
  })

  it("#given a missing or unparseable message date #when filtered #then the message stays eligible", () => {
    // given
    const start = "2026-01-01T00:00:00.000Z"

    // when
    const missing = dateInRange(undefined, start, undefined)
    const invalid = dateInRange("not-a-date", start, undefined)

    // then
    expect(missing).toBe(true)
    expect(invalid).toBe(true)
  })

  it("#given unparseable bounds #when filtered #then the filter is ignored", () => {
    // given
    const created = "2026-01-15T00:00:00.000Z"

    // when
    const badStart = dateInRange(created, "nonsense", undefined)
    const badEnd = dateInRange(created, undefined, "nonsense")
    const noBounds = dateInRange(created, undefined, undefined)

    // then
    expect(badStart).toBe(true)
    expect(badEnd).toBe(true)
    expect(noBounds).toBe(true)
  })
})
