/// <reference path="../../../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"
import { type SupportedLocale, type TranslationKey, locales } from "./index"

function placeholdersOf(message: string): string[] {
  return [...message.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? "").sort()
}

describe("locale tables", () => {
  const keys = Object.keys(locales.en) as TranslationKey[]
  const localeNames = Object.keys(locales) as SupportedLocale[]

  for (const locale of localeNames) {
    describe(`#given the ${locale} table`, () => {
      it("#then every en key has a non-empty message with the same placeholders", () => {
        // given
        const table = locales[locale]
        for (const key of keys) {
          // when
          const message = table[key]
          // then
          expect(typeof message).toBe("string")
          expect(message.trim().length).toBeGreaterThan(0)
          expect(placeholdersOf(message)).toEqual(placeholdersOf(locales.en[key]))
        }
      })
    })
  }
})
