import { describe, expect, test } from "bun:test"
import { END_ULTRAWORK_TEMPLATE } from "./end-ultrawork"

describe("end-ultrawork template", () => {
  test("should export a non-empty template string", () => {
    //#given - the end-ultrawork template

    //#when - we access the template

    //#then - it should be a non-empty string
    expect(typeof END_ULTRAWORK_TEMPLATE).toBe("string")
    expect(END_ULTRAWORK_TEMPLATE.length).toBeGreaterThan(0)
  })

  test("should describe the end-ultrawork behavior", () => {
    //#given - the end-ultrawork template

    //#when - we check the content

    //#then - it should mention key behaviors
    expect(END_ULTRAWORK_TEMPLATE).toContain("ultrawork")
    expect(END_ULTRAWORK_TEMPLATE.toLowerCase()).toContain("deactivat")
  })

  test("should not contain emojis", () => {
    //#given - the template string

    //#when / #then
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    expect(emojiRegex.test(END_ULTRAWORK_TEMPLATE)).toBe(false)
  })
})
