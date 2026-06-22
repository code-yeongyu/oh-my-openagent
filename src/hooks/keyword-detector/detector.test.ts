import { afterEach, describe, expect, mock, test } from "bun:test"
import { KEYWORD_DETECTORS } from "./constants"
import { detectKeywordsWithType } from "./detector"

const ORIGINAL_MESSAGES: ReadonlyArray<(typeof KEYWORD_DETECTORS)[number]["message"]> =
  KEYWORD_DETECTORS.map((d) => d.message)

describe("detectKeywordsWithType short-circuit (Task T3.24)", () => {
  afterEach(() => {
    KEYWORD_DETECTORS.forEach((d, i) => {
      d.message = ORIGINAL_MESSAGES[i]
    })
  })

  test("keyword detector short-circuits on first match", () => {
    //#given - text matches ONLY the first detector (ultrawork), and every detector
    //         uses a function-typed message so we can count resolveMessage calls
    const spies = KEYWORD_DETECTORS.map(() =>
      mock((_agentName?: string, _modelID?: string) => "[resolved]")
    )
    KEYWORD_DETECTORS.forEach((d, i) => {
      d.message = spies[i] as (typeof KEYWORD_DETECTORS)[number]["message"]
    })
    const text = "please do ultrawork on this task"

    //#when - detectKeywordsWithType runs against the text
    const result = detectKeywordsWithType(text)

    //#then - exactly 1 result, and the matching detector's message function was
    //        called exactly 1x. The two non-matching detectors' message functions
    //        must NOT have been called (proving resolveMessage short-circuits).
    const totalResolveCalls = spies.reduce((sum, s) => sum + s.mock.calls.length, 0)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("ultrawork")
    expect(result[0].message).toBe("[resolved]")
    expect(spies[0].mock.calls.length).toBe(1)
    expect(spies[1].mock.calls.length).toBe(0)
    expect(spies[2].mock.calls.length).toBe(0)
    expect(totalResolveCalls).toBe(1)
  })
})
