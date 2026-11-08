import { describe, expect, test } from "bun:test"

import { CONSENT_PHRASES } from "./consent"
import { source } from "./consent-corpus.shapes"

// Lead's final design on #10498: only a whole user message that is exactly one phrase of the closed consent table verifies.

const LISTED = Object.values(CONSENT_PHRASES).flat()

// Every hedge, question, conditional and longer sentence any reviewer raised, plus the earlier rounds' rows: none of
// them is a listed phrase, so none verifies, quoted whole or in part.
const NOT_LISTED = [
  "지워도 될 것 같아", "지워도 될듯", "지워도 괜찮을 것 같아", "음 지워도 될 거 같은데", "플러그인 X 지우면 될 듯", "지워도 돼",
  "지울까", "지워줄래", "플러그인 X 지워줘", "응 해줘", "네 진행해주세요", "백업 다 됐어 플러그인 X 지워", "됐어", "아니", "ㅇㅇ",
  "idk delete it", "hmm delete it", "delete it i think", "i suppose delete it", "you could delete it", "you can delete it",
  "i guess delete it", "sure why not", "yes do it", "Remove plugins X and Y", "Please remove plugins X and Y now.",
  "Don't delete the prod database yet.", "Do n't delete it", "delete it no thanks", "if it works delete it", "maybe",
  "Review the WordPress plugins and tell me which ones look unused.", "thanks", "please",
  "yes?", "ok \u{1f44e}", "delete it...", "delete it!!", "delete it .", "yes, delete it", "Yes\u200b", "\uff59es", "D\u043e it",
  "\u02bcyes", "yes delete it now", "yes yes", "okay okay", "do it later", "go ahead and delete it", "delete it\n",
]

describe("consent phrases: every listed phrase verifies", () => {
  test.each(LISTED)("%p", (phrase) => {
    expect(source(phrase, phrase)).toBe("user")
    expect(source(`${phrase}.`, phrase)).toBe("user")
    expect(source(`${phrase}!`, phrase)).toBe("user")
    expect(source(` ${phrase.toUpperCase()} `, phrase)).toBe("user")
  })
})

describe("consent phrases: anything else never verifies", () => {
  test.each(NOT_LISTED)("%p", (said) => {
    expect(source(said, said)).toBe("agent")
  })
  test.each(LISTED)("a listed phrase %p inside a longer message does not verify", (phrase) => {
    expect(source(`${phrase} now`, phrase)).toBe("agent")
    expect(source(`hmm ${phrase}`, phrase)).toBe("agent")
    expect(source(`${phrase}?`, phrase)).toBe("agent")
  })
})
