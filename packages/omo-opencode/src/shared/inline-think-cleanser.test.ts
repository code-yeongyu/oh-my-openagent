import { describe, it, expect } from "bun:test"
import {
  stripInlineThink,
  stripInlineThinkContent,
} from "./inline-think-cleanser"

describe("stripInlineThink", () => {
  describe("#given text with no think tags", () => {
    it("#when no tags present #then returns text unchanged", () => {
      const result = stripInlineThink("Just plain content with no tags.")
      expect(result.content).toBe("Just plain content with no tags.")
      expect(result.reasoning).toBe("")
    })

    it("#when empty string #then returns empty pair", () => {
      const result = stripInlineThink("")
      expect(result.content).toBe("")
      expect(result.reasoning).toBe("")
    })
  })

  describe("#given a single complete think block", () => {
    it("#when block surrounds short reply #then content has only the reply", () => {
      const result = stripInlineThink("<think>\nUser wants greeting.\n</think>\nCiao")
      expect(result.content).toBe("\nCiao")
      expect(result.reasoning).toBe("\nUser wants greeting.\n")
    })

    it("#when block precedes content #then content follows the close tag", () => {
      const result = stripInlineThink(
        "<think>analyzing...</think>The answer is 42.",
      )
      expect(result.content).toBe("The answer is 42.")
      expect(result.reasoning).toBe("analyzing...")
    })
  })

  describe("#given mm:think namespaced tags", () => {
    it("#when mm:think encountered #then handled identically", () => {
      const result = stripInlineThink(
        "<mm:think>reasoning here</mm:think>Final answer.",
      )
      expect(result.content).toBe("Final answer.")
      expect(result.reasoning).toBe("reasoning here")
    })

    it("#when mixed namespaces in one document #then both stripped", () => {
      const result = stripInlineThink(
        "Pre <think>a</think> mid <mm:think>b</mm:think> tail",
      )
      expect(result.content).toBe("Pre  mid  tail")
      expect(result.reasoning).toBe("ab")
    })
  })

  describe("#given multiple think blocks", () => {
    it("#when several blocks #then reasoning is concatenated in order", () => {
      const result = stripInlineThink(
        "intro <think>first</think> middle <think>second</think> end",
      )
      expect(result.content).toBe("intro  middle  end")
      expect(result.reasoning).toBe("firstsecond")
    })
  })

  describe("#given malformed input (defense in depth)", () => {
    it("#when unclosed opener #then remainder treated as reasoning", () => {
      const result = stripInlineThink("ok <think>oops never closed")
      expect(result.content).toBe("ok ")
      expect(result.reasoning).toBe("oops never closed")
    })

    it("#when orphan closer at start #then closer stripped, content preserved", () => {
      const result = stripInlineThink("</think>Ciao!")
      expect(result.content).toBe("Ciao!")
      expect(result.reasoning).toBe("")
    })

    it("#when orphan mm:close at start #then closer stripped", () => {
      const result = stripInlineThink("</mm:think>Ciao!")
      expect(result.content).toBe("Ciao!")
      expect(result.reasoning).toBe("")
    })

    it("#when orphan closer between content #then stripped, content joined", () => {
      const result = stripInlineThink("hello </think>world")
      expect(result.content).toBe("hello world")
      expect(result.reasoning).toBe("")
    })
  })

  describe("#given the actual minimax-m3 leak from production", () => {
    it("#when real leak sample #then yields clean content", () => {
      const leak =
        "<think>\nThe user said \"ciao\" which is Italian for \"hi\".\n</think>\nCiao! 👋"
      const result = stripInlineThink(leak)
      expect(result.content).toBe("\nCiao! 👋")
      expect(result.reasoning).toContain("Italian")
    })
  })
})

describe("stripInlineThinkContent", () => {
  it("#when called #then returns only the content portion", () => {
    expect(stripInlineThinkContent("<think>x</think>y")).toBe("y")
    expect(stripInlineThinkContent("plain")).toBe("plain")
  })
})
