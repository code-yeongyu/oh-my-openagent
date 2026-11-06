import { expect, test } from "bun:test"

import { mulberry32, pick } from "../item/test-support"
import { isOrderedSubsequence, mergeInsertions } from "./merge"

function lines(text: string): readonly string[] {
  if (text === "") return []
  const result = text.split("\n")
  if (text.endsWith("\n")) result.pop()
  return result
}

for (const seed of [20261016, 0x1a2b3c4d]) {
  test(`A2 merge preserves intact input lines; seed=${seed}, cases=2000`, () => {
    // Given prose with shared characters but distinct meaning, empty lines and EOLs.
    const rand = mulberry32(seed)
    const make = () => {
      const eol = pick(rand, ["\n", "\r\n"])
      const content = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => pick(rand, [
        "Prefers dark mode in every editor.",
        "Prefers short commit messages.",
        "- likes tea",
        "- likes coffee",
        "",
        `note ${Math.floor(rand() * 20)}: alpha beta`,
        "韓国語の行を保持する",
        "한글 줄 그대로",
        "emoji line 🙂🚀",
      ])).join(eol)
      return content + (rand() < 0.5 ? eol : "")
    }
    for (let iteration = 0; iteration < 2000; iteration++) {
      const a = make()
      const b = make()
      for (const budget of [16_000_000, 1]) {
        // When merging via the line alignment or cell-budget fallback.
        const out = mergeInsertions(a, b, budget)
        const actual = lines(out)
        const context = `A2 seed=${seed} case=${iteration} budget=${budget} a=${JSON.stringify(a)} b=${JSON.stringify(b)} out=${JSON.stringify(out)}`
        // Then lines survive with their text/CR intact, never glued together.
        for (const line of [...lines(a), ...lines(b)]) expect(actual.includes(line), context).toBe(true)
        for (const line of actual) expect([...lines(a), ...lines(b)].includes(line), context).toBe(true)
        expect(isOrderedSubsequence(a, out), context).toBe(true)
        expect(isOrderedSubsequence(b, out), context).toBe(true)
        expect(mergeInsertions(a, b, budget), context).toBe(out)
      }
    }
  })
}

test("unrelated prose keeps both complete sentences", () => {
  const a = "Prefers dark mode in every editor.\n"
  const b = "Prefers short commit messages.\n"
  expect(lines(mergeInsertions(a, b))).toEqual([a.trimEnd(), b.trimEnd()])
})

for (const budget of [16_000_000, 1]) {
  test(`unterminated lines receive a boundary before following output; budget=${budget}`, () => {
    expect(mergeInsertions("one\ntwo", "three\nfour\n", budget)).toBe("one\ntwo\nthree\nfour\n")
  })
}
