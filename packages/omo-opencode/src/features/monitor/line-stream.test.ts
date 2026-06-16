import { describe, expect, test } from "bun:test"

import { LineStream, stripAnsi } from "./line-stream"

const encoder = new TextEncoder()

describe("LineStream", () => {
  describe("#given a multi-byte UTF-8 character split across chunks", () => {
    test("#when feeding both chunks #then it decodes without replacement characters", () => {
      // given
      const stream = new LineStream({ lineMaxBytes: 64 })
      const chunkA = new Uint8Array([0xe2])
      const chunkB = new Uint8Array([0x82, 0xac, 0x0a])

      // when
      const first = stream.feed(chunkA)
      const second = stream.feed(chunkB)

      // then
      expect(first).toEqual({ lines: [], binarySuppressedBytes: 0 })
      expect(second).toEqual({
        lines: [{ text: "€", rawText: "€" }],
        binarySuppressedBytes: 0,
      })
    })
  })

  describe("#given CRLF and LF line endings", () => {
    test("#when feeding both forms #then it splits lines and removes the CR", () => {
      // given
      const stream = new LineStream({ lineMaxBytes: 64 })

      // when
      const result = stream.feed(encoder.encode("one\r\ntwo\n"))

      // then
      expect(result).toEqual({
        lines: [
          { text: "one", rawText: "one" },
          { text: "two", rawText: "two" },
        ],
        binarySuppressedBytes: 0,
      })
    })
  })

  describe("#given a line over lineMaxBytes", () => {
    test("#when feeding and flushing it #then it emits one truncated prefix line", () => {
      // given
      const stream = new LineStream({ lineMaxBytes: 5 })

      // when
      const feedResult = stream.feed(encoder.encode("abcdefg"))
      const flushResult = stream.flush()

      // then
      expect(feedResult).toEqual({
        lines: [{ text: "abcde", rawText: "abcde", truncated: true }],
        binarySuppressedBytes: 0,
      })
      expect(flushResult).toEqual({ lines: [], binarySuppressedBytes: 0 })
    })
  })

  describe("#given a chunk containing a NUL byte", () => {
    test("#when feeding it #then it suppresses raw bytes and emits a binary marker", () => {
      // given
      const stream = new LineStream({ lineMaxBytes: 64 })
      const chunk = new Uint8Array([0x61, 0x00, 0x62, 0x0a])

      // when
      const result = stream.feed(chunk)

      // then
      expect(result.binarySuppressedBytes).toBeGreaterThan(0)
      expect(result.lines).toEqual([{ text: "", rawText: "", binary: true }])
    })
  })

  describe("#given ANSI-colored text", () => {
    test("#when stripping ANSI escapes #then it returns plain text", () => {
      // given
      const text = "\x1b[31mERR\x1b[0m"

      // when
      const result = stripAnsi(text)

      // then
      expect(result).toBe("ERR")
    })

    test("#when feeding ANSI-colored text #then text is stripped and rawText is preserved", () => {
      // given
      const stream = new LineStream({ lineMaxBytes: 64 })

      // when
      const result = stream.feed(encoder.encode("\x1b[31mERR\x1b[0m\n"))

      // then
      expect(result).toEqual({
        lines: [{ text: "ERR", rawText: "\x1b[31mERR\x1b[0m" }],
        binarySuppressedBytes: 0,
      })
    })
  })
})
