import { describe, expect, test } from "bun:test"
import { parseCdataValue } from "./cdata"

describe("parseCdataValue", () => {
  describe("#given a standard CDATA wrapper", () => {
    test("#when parsed #then inner content extracted verbatim", () => {
      expect(parseCdataValue("<![CDATA[hello]]>")).toBe("hello")
    })
  })

  describe("#given CDATA with leading/trailing whitespace outside wrapper", () => {
    test("#when parsed #then content extracted, surrounding whitespace ignored", () => {
      expect(parseCdataValue("  <![CDATA[abc]]>  ")).toBe("abc")
    })
  })

  describe("#given empty CDATA <![CDATA[]]>", () => {
    test("#when parsed #then empty string returned", () => {
      expect(parseCdataValue("<![CDATA[]]>")).toBe("")
    })
  })

  describe("#given split CDATA escaping ]]> sequence", () => {
    test("#when parsed #then ]]> reassembled into one string", () => {
      const input = "<![CDATA[before]]]]><![CDATA[>after]]>"
      expect(parseCdataValue(input)).toBe("before]]>after")
    })
  })

  describe("#given CDATA containing newlines and quotes", () => {
    test("#when parsed #then content preserved verbatim", () => {
      const input = '<![CDATA[line1\nline2 "quoted"\nline3]]>'
      expect(parseCdataValue(input)).toBe('line1\nline2 "quoted"\nline3')
    })
  })

  describe("#given CDATA containing JSON-like text", () => {
    test("#when parsed #then JSON preserved verbatim", () => {
      const input = '<![CDATA[{"a":1,"b":[true,null,"x"]}]]>'
      expect(parseCdataValue(input)).toBe('{"a":1,"b":[true,null,"x"]}')
    })
  })

  describe("#given unterminated CDATA (missing ]]>)", () => {
    test("#when parsed #then best-effort content returned from <![CDATA[ to end", () => {
      const input = "<![CDATA[partial content but never closed"
      expect(parseCdataValue(input)).toBe("partial content but never closed")
    })
  })

  describe("#given text with no CDATA at all", () => {
    test("#when parsed #then original raw text returned (caller decides to fall back)", () => {
      expect(parseCdataValue("plain")).toBe("plain")
    })
  })

  describe("#given multiple consecutive split CDATA blocks (3 segments)", () => {
    test("#when parsed #then all segments concatenated with their ]]> bridges", () => {
      const input = "<![CDATA[a]]]]><![CDATA[>b]]]]><![CDATA[>c]]>"
      expect(parseCdataValue(input)).toBe("a]]>b]]>c")
    })
  })
})
