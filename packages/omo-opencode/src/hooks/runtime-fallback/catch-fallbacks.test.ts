import { describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { getErrorMessage } from "./error-classifier"
import type { RuntimeFallbackPluginInput } from "./types"
import { hasVisibleAssistantResponse } from "./visible-assistant-response"

describe("runtime fallback catch fallbacks", () => {
  test("getErrorMessage returns an empty fallback when JSON serialization throws an Error", () => {
    // given
    const error = {
      toJSON: () => {
        throw new Error("cannot serialize")
      },
    }

    // when
    const message = getErrorMessage(error)

    // then
    expect(message).toBe("")
  })

  test("getErrorMessage rethrows non-Error JSON serialization failures", () => {
    // given
    const thrown = "non-error serialization failure"
    const error = {
      toJSON: () => {
        throw thrown
      },
    }

    // when
    const readMessage = () => getErrorMessage(error)

    // then
    expect(readMessage).toThrow(thrown)
  })

  test("hasVisibleAssistantResponse returns false when message loading throws an Error", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const ctx = unsafeTestValue<RuntimeFallbackPluginInput>({
      directory: "/tmp/project",
      client: {
        session: {
          messages: async () => {
            throw new Error("messages unavailable")
          },
        },
      },
    })

    // when
    const result = await checkVisibleResponse(ctx, "ses_error", undefined)

    // then
    expect(result).toBe(false)
  })

  test("hasVisibleAssistantResponse rethrows non-Error message loading failures", async () => {
    // given
    const checkVisibleResponse = hasVisibleAssistantResponse(() => undefined)
    const thrown = "non-error message loading failure"
    const ctx = unsafeTestValue<RuntimeFallbackPluginInput>({
      directory: "/tmp/project",
      client: {
        session: {
          messages: async () => {
            throw thrown
          },
        },
      },
    })

    // when
    const result = checkVisibleResponse(ctx, "ses_non_error", undefined)

    // then
    await expect(result).rejects.toBe(thrown)
  })
})
