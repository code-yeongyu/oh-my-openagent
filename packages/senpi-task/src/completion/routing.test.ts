import { describe, expect, test } from "bun:test"

import { routeCompletion, shouldNotifyStatus } from "./routing"
import type { NotificationConfig, ParentState } from "./types"

const wakeConfig: NotificationConfig = { wake_idle_parent: true, deliver_as: "followUp" }
const silentConfig: NotificationConfig = { wake_idle_parent: false, deliver_as: "followUp" }
const steerConfig: NotificationConfig = { wake_idle_parent: true, deliver_as: "steer" }

describe("routeCompletion", () => {
  test("#given idle parent and wake enabled #when routed #then wake decision", () => {
    // given
    const state: ParentState = { kind: "idle" }

    // when
    const decision = routeCompletion(state, wakeConfig)

    // then
    expect(decision).toEqual({ kind: "wake" })
  })

  test("#given idle parent and wake disabled #when routed #then queued silently", () => {
    // given
    const state: ParentState = { kind: "idle" }

    // when
    const decision = routeCompletion(state, silentConfig)

    // then
    expect(decision).toEqual({ kind: "queue_silently" })
  })

  test("#given streaming parent #when routed #then delivered with configured deliver_as", () => {
    // given
    const state: ParentState = { kind: "streaming" }

    // when
    const followUp = routeCompletion(state, wakeConfig)
    const steer = routeCompletion(state, steerConfig)

    // then
    expect(followUp).toEqual({ kind: "deliver_streaming", deliverAs: "followUp" })
    expect(steer).toEqual({ kind: "deliver_streaming", deliverAs: "steer" })
  })

  test("#given compacting parent #when routed #then buffered with compacting reason", () => {
    // given
    const state: ParentState = { kind: "compacting" }

    // when
    const decision = routeCompletion(state, wakeConfig)

    // then
    expect(decision).toEqual({ kind: "buffer", reason: "compacting" })
  })

  test("#given session_switching parent #when routed #then buffered with switching reason", () => {
    // given
    const state: ParentState = { kind: "session_switching" }

    // when
    const decision = routeCompletion(state, wakeConfig)

    // then
    expect(decision).toEqual({ kind: "buffer", reason: "session_switching" })
  })

  test("#given session_shutdown parent #when routed #then buffered with shutdown reason", () => {
    // given
    const state: ParentState = { kind: "session_shutdown" }

    // when
    const decision = routeCompletion(state, wakeConfig)

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
