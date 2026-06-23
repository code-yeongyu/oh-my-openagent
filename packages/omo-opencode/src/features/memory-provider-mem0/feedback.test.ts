import { describe, expect, it } from "bun:test"
import {
  aggregateFeedbackScore,
  FEEDBACK_SIGNALS,
  FeedbackValidationError,
  isNegativeSignal,
  submitFeedback,
  validateFeedbackPayload,
  type FeedbackClient,
  type FeedbackPayload,
} from "./feedback"

describe("validateFeedbackPayload", () => {
  it("#given valid payload #when validated #then passes", () => {
    expect(() =>
      validateFeedbackPayload({
        memory_id: "mem-1",
        feedback: "POSITIVE",
      }),
    ).not.toThrow()
  })

  it("#given missing memory_id #when validated #then throws", () => {
    expect(() =>
      validateFeedbackPayload({
        memory_id: "",
        feedback: "POSITIVE",
      }),
    ).toThrow(FeedbackValidationError)
  })

  it("#given whitespace memory_id #when validated #then throws", () => {
    expect(() =>
      validateFeedbackPayload({
        memory_id: "   ",
        feedback: "NEGATIVE",
      }),
    ).toThrow(/memory_id/)
  })

  it("#given invalid signal #when validated #then throws with signal name", () => {
    expect(() =>
      validateFeedbackPayload({
        memory_id: "mem-1",
        feedback: "MAYBE" as never,
      }),
    ).toThrow(/MAYBE/)
  })

  it("#given feedback_reason too long #when validated #then throws", () => {
    expect(() =>
      validateFeedbackPayload({
        memory_id: "mem-1",
        feedback: "NEGATIVE",
        feedback_reason: "x".repeat(1001),
      }),
    ).toThrow(/1000/)
  })

  it("#given all 3 valid signals #when validated #then all pass", () => {
    for (const signal of FEEDBACK_SIGNALS) {
      expect(() =>
        validateFeedbackPayload({ memory_id: "mem-1", feedback: signal }),
      ).not.toThrow()
    }
  })
})

describe("isNegativeSignal", () => {
  it("#given POSITIVE #when checked #then returns false", () => {
    expect(isNegativeSignal("POSITIVE")).toBe(false)
  })

  it("#given NEGATIVE #when checked #then returns true", () => {
    expect(isNegativeSignal("NEGATIVE")).toBe(true)
  })

  it("#given VERY_NEGATIVE #when checked #then returns true", () => {
    expect(isNegativeSignal("VERY_NEGATIVE")).toBe(true)
  })
})

describe("aggregateFeedbackScore", () => {
  it("#given empty array #when aggregated #then returns 0", () => {
    expect(aggregateFeedbackScore([])).toBe(0)
  })

  it("#given all positive #when aggregated #then returns 1", () => {
    expect(aggregateFeedbackScore(["POSITIVE", "POSITIVE", "POSITIVE"])).toBe(1)
  })

  it("#given all very negative #when aggregated #then returns -2", () => {
    expect(aggregateFeedbackScore(["VERY_NEGATIVE", "VERY_NEGATIVE"])).toBe(-2)
  })

  it("#given mixed #when aggregated #then returns mean", () => {
    const score = aggregateFeedbackScore(["POSITIVE", "NEGATIVE"])
    expect(score).toBe(0)
  })
})

describe("submitFeedback", () => {
  it("#given valid payload #when submitted #then client called once", async () => {
    let seen: FeedbackPayload | undefined
    const client: FeedbackClient = {
      submitFeedback: async (p) => {
        seen = p
      },
    }
    await submitFeedback(client, { memory_id: "mem-1", feedback: "POSITIVE" })
    expect(seen?.memory_id).toBe("mem-1")
    expect(seen?.feedback).toBe("POSITIVE")
  })

  it("#given invalid payload #when submitted #then throws before client call", async () => {
    let called = false
    const client: FeedbackClient = {
      submitFeedback: async () => {
        called = true
      },
    }
    await expect(
      submitFeedback(client, { memory_id: "", feedback: "POSITIVE" }),
    ).rejects.toThrow(FeedbackValidationError)
    expect(called).toBe(false)
  })
})
