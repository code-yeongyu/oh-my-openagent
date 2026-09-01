import { describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { resolveRecentPromptContextForSession } from "./recent-model-resolver"

describe("atlas catch fallbacks", () => {
  test("resolveRecentPromptContextForSession falls back to storage when SDK messages throw an Error", async () => {
    // given
    const ctx = unsafeTestValue<Parameters<typeof resolveRecentPromptContextForSession>[0]>({
      client: {
        session: {
          messages: async () => {
            throw new Error("sdk unavailable")
          },
        },
      },
    })

    // when
    const result = await resolveRecentPromptContextForSession(ctx, "ses_error", {
      isSqliteBackend: () => false,
      getMessageDir: () => null,
      findNearestMessageWithFields: () => null,
      findNearestMessageWithFieldsFromSDK: async () => null,
    })

    // then
    expect(result).toEqual({ tools: undefined })
  })

  test("resolveRecentPromptContextForSession rethrows non-Error SDK message failures", async () => {
    // given
    const thrown = "non-error sdk failure"
    const ctx = unsafeTestValue<Parameters<typeof resolveRecentPromptContextForSession>[0]>({
      client: {
        session: {
          messages: async () => {
            throw thrown
          },
        },
      },
    })

    // when
    const result = resolveRecentPromptContextForSession(ctx, "ses_non_error", {
      isSqliteBackend: () => false,
      getMessageDir: () => null,
      findNearestMessageWithFields: () => null,
      findNearestMessageWithFieldsFromSDK: async () => null,
    })

    // then
    await expect(result).rejects.toBe(thrown)
  })
})
