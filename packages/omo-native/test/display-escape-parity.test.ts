import { describe, expect, test } from "bun:test"

import { escapeForDisplay as utilsEscape } from "@oh-my-opencode/utils/escape-for-display"
import { escapeForDisplay as nativeEscape } from "../bin/lib/display-escape.js"

const LAST_CODE_POINT = 0x10ffff
const CHUNK = 0x1000

const unitOf = (code: number): string =>
  code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code)

function chunkText(from: number): string {
  const parts: string[] = []
  for (let code = from; code < Math.min(from + CHUNK, LAST_CODE_POINT + 1); code++) parts.push(unitOf(code))
  return parts.join("|")
}

describe("display escaping parity between omo-native and utils", () => {
  test("#given every code point 0..0x10FFFF #when both escape it, with and without kept line feeds #then the outputs are identical", () => {
    const differing: string[] = []
    for (let from = 0; from <= LAST_CODE_POINT; from += CHUNK) {
      const text = chunkText(from)
      for (const options of [undefined, { keepLineFeeds: false }, { keepLineFeeds: true }]) {
        if (nativeEscape(text, options) !== utilsEscape(text, options))
          differing.push(`${from.toString(16)} ${JSON.stringify(options)}`)
      }
    }
    expect(differing).toEqual([])
    expect(nativeEscape("a\u001b\nb")).toBe(String.raw`a\u001b\u000ab`)
    expect(nativeEscape("a\u001b\nb", { keepLineFeeds: true })).toBe(`${String.raw`a\u001b`}\nb`)
  })
})
