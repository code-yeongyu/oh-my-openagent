import { describe, expect, test } from "bun:test"
import { parseRich, plainText } from "./rich"

describe("parseRich", () => {
  test("bold wrapping a link carries bold onto the text and the link node", () => {
    expect(parseRich("*see <https://x.test|X>*")).toEqual([
      { t: "text", text: "see ", bold: true },
      { t: "link", url: "https://x.test", label: "X", bold: true },
    ])
  })

  test("a bare URL outside <...> stays a text node", () => {
    expect(parseRich("docs at https://x.test/page now")).toEqual([{ t: "text", text: "docs at https://x.test/page now" }])
  })

  test("a mention becomes a mention node, with display when given", () => {
    expect(parseRich("hi <@U000ALICE> and <@U000BOB|Bob>")).toEqual([
      { t: "text", text: "hi " },
      { t: "mention", platform_user_id: "U000ALICE" },
      { t: "text", text: " and " },
      { t: "mention", platform_user_id: "U000BOB", display: "Bob" },
    ])
  })

  test("a channel reference becomes a channel node, with display when given", () => {
    expect(parseRich("see <#C000WORK> or <#C000QA|gateway-qa>")).toEqual([
      { t: "text", text: "see " },
      { t: "channel", chat_id: "C000WORK" },
      { t: "text", text: " or " },
      { t: "channel", chat_id: "C000QA", display: "gateway-qa" },
    ])
  })

  test("a mention inside bold keeps its node and gains no bold", () => {
    expect(parseRich("*ask <@U000ALICE>*")).toEqual([
      { t: "text", text: "ask ", bold: true },
      { t: "mention", platform_user_id: "U000ALICE" },
    ])
  })

  test("an unclosed * stays literal text", () => {
    expect(parseRich("*not bold <https://x.test|X>")).toEqual([
      { t: "text", text: "*not bold " },
      { t: "link", url: "https://x.test", label: "X" },
    ])
  })

  test("bold does not span a newline", () => {
    expect(parseRich("*a\nb*")).toEqual([{ t: "text", text: "*a\nb*" }])
  })

  test("nested <> inside a label leaves the markup literal and loses no character", () => {
    const body = "<https://x.test|a <b> c>"
    expect(parseRich(body)).toEqual([{ t: "text", text: body }])
  })

  test("an empty or blank label, or <url>, keeps the url as the label", () => {
    expect(parseRich("<https://x.test|>")).toEqual([{ t: "link", url: "https://x.test", label: "https://x.test" }])
    expect(parseRich("<https://x.test|  >")).toEqual([{ t: "link", url: "https://x.test", label: "https://x.test" }])
    expect(parseRich("<https://x.test>")).toEqual([{ t: "link", url: "https://x.test", label: "https://x.test" }])
  })

  test("non-http angle markup stays text", () => {
    expect(parseRich("<!here> and <ftp://x.test|f>")).toEqual([{ t: "text", text: "<!here> and <ftp://x.test|f>" }])
  })

  test("empty body parses to no nodes", () => {
    expect(parseRich("")).toEqual([])
  })
})

describe("plainText", () => {
  test("renders labels, displays and ids without markup", () => {
    expect(plainText(parseRich("*done* <https://x.test|PR 12> for <@U000ALICE|Alice> in <#C000WORK>"))).toBe(
      "done PR 12 for @Alice in #C000WORK",
    )
  })
})
