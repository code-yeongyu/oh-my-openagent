declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import { extractProviderHint } from "./extract-provider-hint"

describe("extractProviderHint", () => {
  test("returns undefined when first segment is not a connected provider", () => {
    expect(
      extractProviderHint("aws/anthropic/bedrock-claude-opus-4-6", ["nvidia", "anthropic"]),
    ).toBeUndefined()
  })

  test("returns provider hint when model string is fully qualified", () => {
    expect(
      extractProviderHint("nvidia/aws/anthropic/bedrock-claude-opus-4-6", ["nvidia", "anthropic"]),
    ).toEqual(["nvidia"])
  })

  test("returns provider hint for standard provider-prefixed model", () => {
    expect(
      extractProviderHint("anthropic/claude-opus-4-6", ["nvidia", "anthropic"]),
    ).toEqual(["anthropic"])
  })

  test("returns undefined when model string has no slash", () => {
    expect(extractProviderHint("claude-opus-4-6", ["nvidia", "anthropic"])).toBeUndefined()
  })

  test("returns undefined when connected providers cache is unavailable", () => {
    expect(extractProviderHint("aws/anthropic/bedrock-claude-opus-4-6", null)).toBeUndefined()
  })
})
