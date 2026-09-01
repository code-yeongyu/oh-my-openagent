import { describe, expect, test } from "bun:test"

import {
  consumeNativeGoalCommandMarker,
  markNativeGoalCommand,
} from "./command-execute-before"

describe("native goal command marker", () => {
  test("#given an interleaved same-session prompt #when markers are consumed #then only the native goal turn matches", () => {
    // given
    const nativeGoalParts = [{ type: "text", text: "goal command" }]
    const unrelatedParts = [{ type: "text", text: "<omo-native-goal-command>" }]
    markNativeGoalCommand(nativeGoalParts)

    // when
    const unrelatedMatched = consumeNativeGoalCommandMarker(unrelatedParts)
    const nativeGoalMatched = consumeNativeGoalCommandMarker(nativeGoalParts)

    // then
    expect(unrelatedMatched).toBeFalse()
    expect(unrelatedParts).toEqual([{ type: "text", text: "<omo-native-goal-command>" }])
    expect(nativeGoalMatched).toBeTrue()
    expect(nativeGoalParts).toEqual([{ type: "text", text: "goal command" }])
  })
})
