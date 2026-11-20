import { describe, expect, test } from "bun:test"

import { classifyRunError, createErrorStreakDetector, runEndOf, type RunEnd } from "./error-streak"

const MINUTE = 60_000
const SEAT = "dur-seat"

function virtualClock(start = Date.parse("2026-11-19T22:00:00.000Z")) {
  let at = start
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms
    },
  }
}

const rateLimited: RunEnd = { kind: "error", errorClass: "rate_limit", provider: "anthropic", model: "claude-x" }

describe("error streak detector (#14430)", () => {
  test("#given 9 consecutive error runs #when the 10th ends with an error #then exactly one alert names the count, class, model and first/last time", () => {
    const clock = virtualClock()
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: clock.now })
    const firstAt = clock.now()
    for (let run = 1; run <= 9; run++) {
      expect(detector.observe(SEAT, rateLimited)).toBeUndefined()
      clock.advance(15_000)
    }
    const alert = detector.observe(SEAT, rateLimited)

    expect(alert).toEqual({
      event: "error_streak",
      session_id: SEAT,
      count: 10,
      classes: { rate_limit: 10 },
      aborted: 0,
      first_at: firstAt,
      last_at: firstAt + 9 * 15_000,
      provider: "anthropic",
      model: "claude-x",
      repeat: false,
    })
  })

  test("#given an alerted streak #when 25 more errors end inside the re-alert interval #then nothing more is sent, and the first error past the interval sends one still-failing alert with the new count", () => {
    const clock = virtualClock()
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: clock.now })
    for (let run = 1; run <= 10; run++) detector.observe(SEAT, rateLimited)

    const inside: unknown[] = []
    for (let run = 1; run <= 25; run++) {
      clock.advance(MINUTE)
      inside.push(detector.observe(SEAT, rateLimited))
    }
    clock.advance(35 * MINUTE)
    const again = detector.observe(SEAT, rateLimited)

    expect(inside.filter((event) => event !== undefined)).toEqual([])
    expect(again).toMatchObject({ event: "error_streak", count: 36, repeat: true })
  })

  test("#given an alerted streak #when a run ends normally #then one recovered notice closes it and the next 9 errors send nothing", () => {
    const clock = virtualClock()
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: clock.now })
    const firstAt = clock.now()
    for (let run = 1; run <= 12; run++) {
      detector.observe(SEAT, rateLimited)
      clock.advance(1_000)
    }
    const lastAt = clock.now() - 1_000
    const recovered = detector.observe(SEAT, { kind: "completed" })
    const after = Array.from({ length: 9 }, () => detector.observe(SEAT, rateLimited))

    expect(recovered).toEqual({
      event: "error_streak_recovered",
      session_id: SEAT,
      count: 12,
      classes: { rate_limit: 12 },
      aborted: 0,
      first_at: firstAt,
      last_at: lastAt,
      recovered_at: clock.now(),
    })
    expect(after.filter((event) => event !== undefined)).toEqual([])
  })

  test("#given a streak shorter than the threshold #when a run ends normally #then no recovered notice is sent", () => {
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: virtualClock().now })
    for (let run = 1; run <= 9; run++) detector.observe(SEAT, rateLimited)

    expect(detector.observe(SEAT, { kind: "completed" })).toBeUndefined()
  })

  test("#given errors of several classes #when the streak reaches the threshold #then the alert counts each class", () => {
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: virtualClock().now })
    for (let run = 1; run <= 6; run++) detector.observe(SEAT, rateLimited)
    for (let run = 1; run <= 3; run++) detector.observe(SEAT, { kind: "error", errorClass: "auth" })

    expect(detector.observe(SEAT, { kind: "error", errorClass: "network" })).toMatchObject({
      count: 10,
      classes: { rate_limit: 6, auth: 3, network: 1 },
    })
  })

  test("#given aborted runs #when they end alone or inside a streak #then they never alert, never end a streak, and are counted beside it", () => {
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: virtualClock().now })
    const abortsAlone = Array.from({ length: 86 }, () => detector.observe("dur-chat", { kind: "aborted" }))
    for (let run = 1; run <= 5; run++) detector.observe(SEAT, rateLimited)
    detector.observe(SEAT, { kind: "aborted" })
    for (let run = 1; run <= 4; run++) detector.observe(SEAT, rateLimited)

    expect(abortsAlone.filter((event) => event !== undefined)).toEqual([])
    expect(detector.observe(SEAT, rateLimited)).toMatchObject({ count: 10, aborted: 1 })
  })

  test("#given a session forgotten mid-streak #when it fails again #then it starts a new streak and holds nothing before that", () => {
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: virtualClock().now })
    for (let run = 1; run <= 9; run++) detector.observe(SEAT, rateLimited)
    detector.forget(SEAT)

    expect(detector.observe(SEAT, { kind: "completed" })).toBeUndefined()
    const afterForget = Array.from({ length: 9 }, () => detector.observe(SEAT, rateLimited))
    expect(afterForget.filter((event) => event !== undefined)).toEqual([])
    expect(detector.observe(SEAT, rateLimited)).toMatchObject({ count: 10 })
  })

  test("#given two sessions #when only one keeps failing #then only that one alerts", () => {
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: virtualClock().now })
    const events = []
    for (let run = 1; run <= 10; run++) {
      events.push(detector.observe(SEAT, rateLimited), detector.observe("dur-other", { kind: "completed" }))
    }

    expect(events.filter((event) => event !== undefined).map((event) => event?.session_id)).toEqual([SEAT])
  })

  test("#given realert 0 #when the streak goes on for hours #then only the first alert is sent", () => {
    const clock = virtualClock()
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 0, now: clock.now })
    const events = []
    for (let run = 1; run <= 500; run++) {
      events.push(detector.observe(SEAT, rateLimited))
      clock.advance(MINUTE)
    }

    expect(events.filter((event) => event !== undefined)).toHaveLength(1)
  })

  test("#given the measured 2026-11-19 night (2,769 rate-limit errors about 15 s apart, then a normal stop) #when it is replayed #then one alert, one still-failing alert per hour and one recovered notice are sent", () => {
    const clock = virtualClock()
    const detector = createErrorStreakDetector({ threshold: 10, realertMs: 60 * MINUTE, now: clock.now })
    const events = []
    for (let run = 1; run <= 2_769; run++) {
      events.push(detector.observe(SEAT, rateLimited))
      clock.advance(15_000)
    }
    events.push(detector.observe(SEAT, { kind: "completed" }))
    const sent = events.filter((event) => event !== undefined)

    // 2,769 runs x 15 s is 11.5 hours: the first alert at run 10, then one every 240 runs (an hour) after it.
    expect(sent.map((event) => `${event?.event} ${event?.count}`)).toEqual([
      "error_streak 10",
      ...Array.from({ length: 11 }, (_, hour) => `error_streak ${10 + (hour + 1) * 240}`),
      "error_streak_recovered 2769",
    ])
  })
})

describe("run outcome and error class", () => {
  test.each([
    ["rate_limit_error: This request would exceed your account's rate limit", "rate_limit"],
    ["429 Too Many Requests", "rate_limit"],
    ["You have hit your usage limit", "rate_limit"],
    ["401 Unauthorized", "auth"],
    ["authentication_error: invalid x-api-key", "auth"],
    ["overloaded_error: Overloaded", "overloaded"],
    ["529 service overloaded", "overloaded"],
    ["503 Service Unavailable", "overloaded"],
    ["fetch failed", "network"],
    ["read ECONNRESET", "network"],
    ["the model said something odd", "unknown"],
    [undefined, "unknown"],
  ] as const)("#given the error %p #when it is classified #then the class is %p", (message, errorClass) => {
    expect(classifyRunError(message)).toBe(errorClass)
  })

  test("#given an agent_end whose last assistant message stopped on an error #when its outcome is read #then it is an error of that class with the provider and model, and the message text is not kept", () => {
    const end = runEndOf({
      messages: [
        { role: "user", content: "PROMPT-SENTINEL" },
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "rate_limit_error: OUTPUT-SENTINEL",
          provider: "anthropic",
          model: "claude-x",
        },
      ],
    })

    expect(end).toEqual({ kind: "error", errorClass: "rate_limit", provider: "anthropic", model: "claude-x" })
  })

  test("#given an aborted run and a normal run #when their outcomes are read #then they are aborted and completed", () => {
    expect(runEndOf({ aborted: true, messages: [{ role: "assistant", stopReason: "error" }] })).toEqual({
      kind: "aborted",
    })
    expect(runEndOf({ messages: [{ role: "assistant", stopReason: "stop" }] })).toEqual({ kind: "completed" })
  })
})
