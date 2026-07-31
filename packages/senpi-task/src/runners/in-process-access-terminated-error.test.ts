import { describe, expect, test } from "bun:test"

import { createFallbackSessionHarness } from "./__fixtures__/in-process-fallback-session"

const quotaError =
  `403: {"message":"You've reached your usage limit for this billing cycle.",` +
  `"type":"access_terminated_error"}`

describe("in-process access_terminated_error fallback", () => {
  test("#given access_terminated_error makes the first category candidate unusable #when the child runs #then the next configured candidate produces the result", async () => {
    // given
    const harness = await createFallbackSessionHarness(quotaError)

    // when
    try {
      await harness.session.prompt("complete through the configured fallback")

      // then
      expect(harness.calls).toEqual(["dead-primary", "healthy-fallback"])
      expect(harness.session.getLastAssistantText()).toBe("fallback completed")
      expect(harness.events).toContainEqual({
        type: "retry_fallback_applied",
        from: "runtime-fallback-test/dead-primary",
        to: "runtime-fallback-test/healthy-fallback",
        chainKey: "runtime-fallback-test/dead-primary",
        reason: "hard-error",
      })
    } finally {
      harness.dispose()
    }
  })

  test("#given context overflow is deliberately non-fallback #when the child runs #then it stays terminal on the first candidate", async () => {
    // given
    const harness = await createFallbackSessionHarness(
      "Your input exceeds the context window of this model",
    )

    // when
    try {
      await harness.session.prompt("do not advance this overflow")

      // then
      expect(harness.calls).toEqual(["dead-primary"])
      expect(harness.events.some((event) => event.type === "retry_fallback_applied")).toBe(false)
      expect(harness.session.getLastAssistantText()).toBeUndefined()
    } finally {
      harness.dispose()
    }
  })
})
