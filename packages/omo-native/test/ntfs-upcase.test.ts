import { describe, expect, test } from "bun:test"

import { foldNtfsCase } from "../ntfs-upcase"

describe("frozen NTFS upcase table (#12809)", () => {
  test("#given every BMP unit #when the table folds it #then the result is the unit's own JS uppercase", () => {
    // given
    const disagreements: string[] = []

    // when
    for (let unit = 0; unit < 0x10000; unit += 1) {
      const text = String.fromCharCode(unit)
      const folded = foldNtfsCase(text)
      if (folded !== text && folded !== text.toUpperCase()) disagreements.push(unit.toString(16))
    }

    // then
    expect(disagreements).toEqual([])
  })

  test("#given ASCII #when folded #then only a-z change", () => {
    // given
    const ascii = Array.from({ length: 128 }, (_, unit) => String.fromCharCode(unit)).join("")

    // when
    const folded = foldNtfsCase(ascii)

    // then
    expect(folded).toBe(ascii.replace(/[a-z]/g, (letter) => letter.toUpperCase()))
  })

  test("#given case pairs added after Unicode 3.2 #when folded #then each unit stays itself", () => {
    // given: JS toUpperCase still folds the first three. U+212A stays itself under toUpperCase, and toLowerCase maps it to "k".
    const foldedByJs = ["\u10D0", "\uAB70", "\u0282"]
    const kelvin = "\u212A"

    // when / then
    for (const unit of foldedByJs) {
      expect(foldNtfsCase(unit)).toBe(unit)
      expect(unit.toUpperCase()).not.toBe(unit)
    }
    expect(foldNtfsCase(kelvin)).toBe(kelvin)
    expect(kelvin.toLowerCase()).toBe("k")
  })
})
