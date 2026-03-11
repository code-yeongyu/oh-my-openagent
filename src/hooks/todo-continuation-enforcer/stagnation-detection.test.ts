/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it as test } from "bun:test"

import { MAX_STAGNATION_COUNT } from "./constants"
import { shouldStopForStagnation } from "./stagnation-detection"

describe("shouldStopForStagnation", () => {
  describe("#given stagnation reaches the configured limit", () => {
    describe("#when no progress is detected", () => {
      test("#then it stops continuation", () => {
        const shouldStop = shouldStopForStagnation({
          sessionID: "ses-stagnated",
          incompleteCount: 2,
          progressUpdate: {
            previousIncompleteCount: 2,
            previousStagnationCount: MAX_STAGNATION_COUNT - 1,
            stagnationCount: MAX_STAGNATION_COUNT,
            hasProgressed: false,
            progressSource: "none",
          },
        })

        expect(shouldStop).toBe(true)
      })
    })

    describe("#when activity progress is detected after the halt", () => {
      test("#then it clears the stop condition", () => {
        const shouldStop = shouldStopForStagnation({
          sessionID: "ses-recovered",
          incompleteCount: 2,
          progressUpdate: {
            previousIncompleteCount: 2,
            previousStagnationCount: MAX_STAGNATION_COUNT,
            stagnationCount: 0,
            hasProgressed: true,
            progressSource: "activity",
          },
        })

        expect(shouldStop).toBe(false)
      })
    })
  })
})
