import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { createMarker, hasMarkers, parseMarkers } from "./reference-marker"

describe("reference-marker", () => {
  beforeEach(() => {
    mock.restore()
  })

  describe("#given a brain memory id and description", () => {
    describe("#when createMarker is called", () => {
      it("#then should return marker in expected format", () => {
        expect(createMarker(42, "tool output summary")).toBe("[brain#42: tool output summary]")
      })

      it("#then should keep original description text", () => {
        expect(createMarker(1, "  spaced description  ")).toBe("[brain#1:   spaced description  ]")
      })
    })
  })

  describe("#given text containing brain markers", () => {
    describe("#when parseMarkers is called", () => {
      it("#then should parse a single marker", () => {
        expect(parseMarkers("see [brain#7: large grep output] for details")).toEqual([
          { brainId: 7, description: "large grep output" },
        ])
      })

      it("#then should parse multiple markers in order", () => {
        expect(parseMarkers("[brain#2: first] middle [brain#8: second marker] end")).toEqual([
          { brainId: 2, description: "first" },
          { brainId: 8, description: "second marker" },
        ])
      })

      it("#then should trim marker descriptions", () => {
        expect(parseMarkers("[brain#9:   trimmed value   ]")).toEqual([{ brainId: 9, description: "trimmed value" }])
      })

      it("#then should return empty list for malformed or missing markers", () => {
        expect(parseMarkers("plain text")).toEqual([])
        expect(parseMarkers("[brain#abc: invalid id]")).toEqual([])
        expect(parseMarkers("[brain#12 missing-colon]")).toEqual([])
      })
    })
  })

  describe("#given text with or without marker prefix", () => {
    describe("#when hasMarkers is called", () => {
      it("#then should return true for valid marker-like content", () => {
        expect(hasMarkers("start [brain#1: marker] end")).toBe(true)
      })

      it("#then should return false for non-matching content", () => {
        expect(hasMarkers("")).toBe(false)
        expect(hasMarkers("[brain#: missing id]"))
          .toBe(false)
        expect(hasMarkers("brain#9: missing bracket")).toBe(false)
      })
    })
  })

  describe("#given test-local spies", () => {
    describe("#when spyOn is used in this file", () => {
      it("#then should observe parse behavior", () => {
        const parseIntSpy = spyOn(Number, "parseInt")
        parseMarkers("[brain#13: sample]")
        expect(parseIntSpy).toHaveBeenCalledWith("13", 10)
        parseIntSpy.mockRestore()
      })
    })
  })
})
