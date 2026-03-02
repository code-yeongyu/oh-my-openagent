import { describe, it, expect, beforeEach, mock } from "bun:test"
import type { GcMessageInfo, GcPart, MessageWithParts } from "./types"
import {
  extractKeywords,
  findRelevantBrainEntries,
  buildPrefetchHint,
  injectPrefetchHint,
} from "./brain-prefetch"

function createMsg(role: string, parts: GcPart[]): MessageWithParts {
  return {
    info: { id: `msg_${Math.random().toString(36).slice(2)}`, sessionID: "ses_pf", role } as GcMessageInfo,
    parts,
  }
}

function textPart(text: string): GcPart {
  return { type: "text", text } as GcPart
}

function toolPart(output: string): GcPart {
  return { type: "tool", state: { output } } as GcPart
}

describe("brain-prefetch", () => {
  beforeEach(() => {
    mock.restore()
  })

  describe("#given extractKeywords", () => {
    describe("#when called with normal text", () => {
      it("#then should return unique content words, no stop words", () => {
        const keywords = extractKeywords("How do I configure the authentication middleware?")

        expect(keywords).toContain("configure")
        expect(keywords).toContain("authentication")
        expect(keywords).toContain("middleware")
        expect(keywords).not.toContain("how")
        expect(keywords).not.toContain("do")
        expect(keywords).not.toContain("the")
      })
    })

    describe("#when called with short or stop-word-only text", () => {
      it("#then should return empty array", () => {
        expect(extractKeywords("")).toEqual([])
        expect(extractKeywords("I do it")).toEqual([])
        expect(extractKeywords("a b c")).toEqual([])
      })
    })

    describe("#when called with duplicate words", () => {
      it("#then should deduplicate", () => {
        const keywords = extractKeywords("error error error handling")
        expect(keywords).toEqual(["error", "handling"])
      })
    })
  })

  describe("#given messages with brain markers and a relevant user question", () => {
    describe("#when findRelevantBrainEntries is called", () => {
      it("#then should return matching brain entries sorted by score", () => {
        const messages = [
          createMsg("assistant", [toolPart("[brain#42: authentication middleware configuration]")]),
          createMsg("assistant", [toolPart("[brain#99: database migration scripts]")]),
          createMsg("user", [textPart("How do I configure the authentication?")]),
        ]

        const candidates = findRelevantBrainEntries(messages)

        expect(candidates.length).toBeGreaterThanOrEqual(1)
        expect(candidates[0].brainId).toBe(42)
        expect(candidates[0].score).toBeGreaterThan(0)
      })
    })
  })

  describe("#given messages with brain markers but no relevant user question", () => {
    describe("#when findRelevantBrainEntries is called", () => {
      it("#then should return empty array", () => {
        const messages = [
          createMsg("assistant", [toolPart("[brain#42: authentication middleware configuration]")]),
          createMsg("user", [textPart("What color should the button be?")]),
        ]

        const candidates = findRelevantBrainEntries(messages)

        const hasAuthMatch = candidates.some((c) => c.brainId === 42)
        expect(hasAuthMatch).toBe(false)
      })
    })
  })

  describe("#given messages with no brain markers", () => {
    describe("#when findRelevantBrainEntries is called", () => {
      it("#then should return empty array", () => {
        const messages = [
          createMsg("assistant", [textPart("just a normal response")]),
          createMsg("user", [textPart("tell me about auth")]),
        ]

        expect(findRelevantBrainEntries(messages)).toEqual([])
      })
    })
  })

  describe("#given messages with no user message", () => {
    describe("#when findRelevantBrainEntries is called", () => {
      it("#then should return empty array", () => {
        const messages = [
          createMsg("assistant", [toolPart("[brain#42: auth config]")]),
        ]

        expect(findRelevantBrainEntries(messages)).toEqual([])
      })
    })
  })

  describe("#given multiple brain markers matching user query", () => {
    describe("#when findRelevantBrainEntries is called", () => {
      it("#then should return up to 5 results capped", () => {
        const messages = [
          createMsg("assistant", [
            toolPart("[brain#1: error handling routes] [brain#2: error logging middleware] [brain#3: error recovery strategy] [brain#4: error boundary component] [brain#5: error monitoring setup] [brain#6: error notification system]"),
          ]),
          createMsg("user", [textPart("How should I handle error recovery?")]),
        ]

        const candidates = findRelevantBrainEntries(messages)

        expect(candidates.length).toBeLessThanOrEqual(5)
        expect(candidates.length).toBeGreaterThan(0)
      })
    })
  })

  describe("#given brain markers in text parts (not just tool output)", () => {
    describe("#when findRelevantBrainEntries is called", () => {
      it("#then should find markers in text parts too", () => {
        const messages = [
          createMsg("assistant", [textPart("Earlier I found [brain#55: deployment pipeline config]")]),
          createMsg("user", [textPart("Show me the deployment pipeline")]),
        ]

        const candidates = findRelevantBrainEntries(messages)

        expect(candidates.length).toBeGreaterThanOrEqual(1)
        expect(candidates[0].brainId).toBe(55)
      })
    })
  })

  describe("#given buildPrefetchHint", () => {
    describe("#when called with candidates", () => {
      it("#then should format a human-readable hint", () => {
        const hint = buildPrefetchHint([
          { brainId: 42, description: "auth middleware", score: 0.8 },
          { brainId: 7, description: "route config", score: 0.5 },
        ])

        expect(hint).toContain("brain#42")
        expect(hint).toContain("auth middleware")
        expect(hint).toContain("brain#7")
        expect(hint).toContain("nous-memory get")
      })
    })

    describe("#when called with empty candidates", () => {
      it("#then should return empty string", () => {
        expect(buildPrefetchHint([])).toBe("")
      })
    })
  })

  describe("#given messages with relevant brain markers and a user question", () => {
    describe("#when injectPrefetchHint is called", () => {
      it("#then should append hint to last user message", () => {
        const messages = [
          createMsg("assistant", [toolPart("[brain#42: authentication middleware configuration]")]),
          createMsg("user", [textPart("How do I configure the authentication middleware?")]),
        ]

        const result = injectPrefetchHint(messages)

        expect(result).toBe(true)
        expect(messages[1].parts.length).toBe(2)
        const hintPart = messages[1].parts[1] as unknown as { text: string }
        expect(hintPart.text).toContain("Relevant brain entries")
        expect(hintPart.text).toContain("brain#42")
      })
    })
  })

  describe("#given prefetch hint already injected", () => {
    describe("#when injectPrefetchHint is called again", () => {
      it("#then should not inject duplicate", () => {
        const messages = [
          createMsg("assistant", [toolPart("[brain#42: authentication config]")]),
          createMsg("user", [textPart("How do I configure authentication?")]),
        ]

        injectPrefetchHint(messages)
        const partsAfterFirst = messages[1].parts.length

        const result = injectPrefetchHint(messages)

        expect(result).toBe(false)
        expect(messages[1].parts.length).toBe(partsAfterFirst)
      })
    })
  })

  describe("#given no relevant matches", () => {
    describe("#when injectPrefetchHint is called", () => {
      it("#then should not inject and return false", () => {
        const messages = [
          createMsg("assistant", [toolPart("[brain#42: database migration scripts]")]),
          createMsg("user", [textPart("What color is the sky?")]),
        ]

        const result = injectPrefetchHint(messages)

        expect(result).toBe(false)
        expect(messages[1].parts.length).toBe(1)
      })
    })
  })
})
