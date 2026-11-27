import { describe, expect, test } from "bun:test"
import { uncontrolledNewWindows } from "./hosted-macos-live-grant.ts"

describe("q7 dialog windows, judged against the windows the no-call control saw", () => {
  test("a window the control period also saw appear is not counted", () => {
    const control = { before: [], after: ["UserNotificationCenter"] }
    expect(uncontrolledNewWindows(control, [], ["UserNotificationCenter"])).toEqual([])
  })

  test("a window whose process the control spawned but whose window the control never saw is counted", () => {
    const control = { before: [], after: [] }
    expect(uncontrolledNewWindows(control, [], ["UserNotificationCenter"])).toEqual(["UserNotificationCenter"])
  })

  test("only windows beyond the ones already open before the call are new", () => {
    const control = { before: [], after: [] }
    expect(uncontrolledNewWindows(control, ["SecurityAgent"], ["SecurityAgent", "SecurityAgent"])).toEqual([
      "SecurityAgent",
    ])
    expect(uncontrolledNewWindows(control, ["SecurityAgent"], ["SecurityAgent"])).toEqual([])
  })
})
