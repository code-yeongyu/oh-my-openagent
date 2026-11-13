import { describe, expect, test } from "bun:test"
import { uncontrolledNewWindows } from "./hosted-macos-live-grant.ts"

describe("q7 dialog windows, judged against the no-call control", () => {
  test("a window owned by a process the no-call control also spawned is not counted", () => {
    expect(uncontrolledNewWindows([], ["UserNotificationCenter"], ["UserNotificationCenter"])).toEqual([])
  })

  test("a window owned by a process the control did not spawn is counted", () => {
    expect(uncontrolledNewWindows([], ["UserNotificationCenter", "SecurityAgent"], ["UserNotificationCenter"])).toEqual(
      ["SecurityAgent"],
    )
  })

  test("only windows beyond the ones already open before the call are new", () => {
    expect(uncontrolledNewWindows(["SecurityAgent"], ["SecurityAgent", "SecurityAgent"], [])).toEqual(["SecurityAgent"])
    expect(uncontrolledNewWindows(["SecurityAgent"], ["SecurityAgent"], [])).toEqual([])
  })
})
