import { expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { findNearestMessageWithFieldsFromSDK } from "./sdk-message-lookup"

test("returns null when hey-api resolves a non-2xx error envelope", async () => {
  // given
  const mockClient = {
    session: {
      messages: async () => ({
        data: undefined,
        error: { message: "session messages unavailable" },
        request: new Request("https://example.com/session/ses_123/messages"),
        response: new Response(null, { status: 502 }),
      }),
    },
  }

  // when
  const result = await findNearestMessageWithFieldsFromSDK(unsafeTestValue(mockClient), "ses_123")

  // then
  expect(result).toBeNull()
})
