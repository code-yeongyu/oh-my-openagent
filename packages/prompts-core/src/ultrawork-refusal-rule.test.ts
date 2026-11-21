import { describe, expect, test } from "bun:test"
import { codexUltraworkPromptVariants, ultraworkPromptVariants } from "./ultrawork-prompts"

// The phrase every ultrawork variant must carry: a refused call is final for its purpose. Enumerating the
// variant tables means a new variant without it fails here.
const REFUSAL_IS_FINAL_PHRASE = "final for what that call was meant to do"

describe("every ultrawork prompt variant says a refusal is final", () => {
  test.each(Object.entries({ ...ultraworkPromptVariants, ...codexUltraworkPromptVariants }))(
    "#given the %s variant #then it carries the refusal rule",
    (_name, variant) => {
      expect(variant.content.replace(/\s+/g, " ")).toContain(REFUSAL_IS_FINAL_PHRASE)
    },
  )
})
