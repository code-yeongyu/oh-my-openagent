import { describe, expect, test } from "bun:test"

import { isConsentPhrase } from "./consent"
import { source } from "./consent-corpus.shapes"
import REVIEW_ROWS from "./consent-corpus.review-rows.json"

// Rows extracted mechanically from every review receipt of #10498 (scripts/extract-consent-corpus.ts; append-only). Each
// row, quoted whole as the user's message, verifies only if it is a listed consent phrase.
const bare = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!]$/u, "")

describe("consent corpus: every phrase any review quoted", () => {
  test.each(REVIEW_ROWS.map((row) => row.phrase))("%p", (phrase) => {
    expect(source(phrase, phrase)).toBe(isConsentPhrase(bare(phrase)) ? "user" : "agent")
  })
})
