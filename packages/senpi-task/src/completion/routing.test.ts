import { describe, expect, test } from "bun:test"

import { routeCompletion, shouldNotifyStatus } from "./routing"
import type { ParentState } from "./types"

describe("routeCompletion", () => {
  test("#given idle parent #when routed #then always wakes with no config to consult", () => {
    // given
    const state: ParentState = { kind: "idle" }

    // when
    const decision = routeCompletion(state)

    // then an idle parent unconditionally wakes; there is no silent-queue path and no knob
    expect(decision).toEqual({ kind: "wake" })
  })

  test("#given streaming parent #when routed #then delivered into the running turn", () => {
    // given
    const state: ParentState = { kind: "streaming" }

    // when
    const decision = routeCompletion(state)

    // then delivery timing is not configurable: the adapter steers the batched injection
    expect(decision).toEqual({ kind: "deliver_streaming" })
  })

  test("#given compacting parent #when routed #then buffered with compacting reason", () => {
    // given
    const state: ParentState = { kind: "compacting" }

    // when
    const decision = routeCompletion(state)

    // then
    expect(decision).toEqual({ kind: "buffer", reason: "compacting" })
  })

  test("#given session_switching parent #when routed #then buffered with switching reason", () => {
    // given
    const state: ParentState = { kind: "session_switching" }

    // when
    const decision = routeCompletion(state)

    // then
    expect(decision).toEqual({ kind: "buffer", reason: "session_switching" })
  })

  test("#given session_shutdown parent #when routed #then buffered with shutdown reason", () => {
    // given
    const state: ParentState = { kind: "session_shutdown" }

    // when
    const decision = routeCompletion(state)

    // then
    expect(decision).toEqual({ kind: "buffer", reason: "session_shutdown" })
  })
})

describe("shouldNotifyStatus", () => {
  test("#given external terminals and completions/errors #when checked #then notifies", () => {
    // when / then
    expect(shouldNotifyStatus("completed")).toBe(true)
    expect(shouldNotifyStatus("error")).toBe(true)
    expect(shouldNotifyStatus("lost")).toBe(true)
  })

  test("#given parent-initiated terminals #when checked #then does not notify", () => {
    // when / then
    expect(shouldNotifyStatus("cancelled")).toBe(false)
    expect(shouldNotifyStatus("interrupted")).toBe(false)
  })

  test("#given non-terminal statuses #when checked #then does not notify", () => {
    // when / then
    expect(shouldNotifyStatus("pending")).toBe(false)
    expect(shouldNotifyStatus("running")).toBe(false)
  })
})
