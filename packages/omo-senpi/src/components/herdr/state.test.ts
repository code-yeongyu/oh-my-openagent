import { describe, expect, test } from "bun:test"

import {
  initialHerdrState,
  isHerdrBlockedEvent,
  isTerminalMonitorStateEvent,
  isWakeSourceStateEvent,
  reduceHerdrState,
  selectHerdrReport,
} from "./state"

describe("herdr state reducer", () => {
  test("#given a fresh state #when nothing happens #then the report is idle", () => {
    expect(selectHerdrReport(initialHerdrState())).toEqual({ state: "idle" })
  })

  test("#given an active turn #when idle work piles up #then blocked wins over working", () => {
    let state = reduceHerdrState(initialHerdrState(), { type: "turn", active: true })
    state = reduceHerdrState(state, { type: "blocked", active: true, id: "q1", label: "Pick one" })
    state = reduceHerdrState(state, { type: "blocked", active: true, id: "q2", label: "Confirm" })
    expect(selectHerdrReport(state)).toEqual({ state: "blocked", message: "Pick one" })
    state = reduceHerdrState(state, { type: "blocked", active: false, id: "q1" })
    expect(selectHerdrReport(state)).toEqual({ state: "blocked", message: "Confirm" })
    state = reduceHerdrState(state, { type: "blocked", active: false, id: "q2" })
    expect(selectHerdrReport(state)).toEqual({ state: "working" })
  })

  test("#given subagent children and monitors #then the working message lists them", () => {
    let state = reduceHerdrState(initialHerdrState(), { type: "children", count: 2 })
    state = reduceHerdrState(state, { type: "monitors", count: 1 })
    expect(selectHerdrReport(state)).toEqual({ state: "working", message: "2 subagents running + 1 monitor live" })
  })

  test("#given a wake source with a known label #then it uses the label; unknown sources stay raw", () => {
    let state = reduceHerdrState(initialHerdrState(), { type: "wake-source", source: "omo-dag", count: 1 })
    state = reduceHerdrState(state, { type: "wake-source", source: "mystery", count: 2 })
    expect(selectHerdrReport(state)).toEqual({ state: "working", message: "2 mystery + 1 DAG run" })
  })

  test("#given a represented wake source #then it does not double-count", () => {
    let state = reduceHerdrState(initialHerdrState(), { type: "wake-source", source: "senpi-task", count: 3 })
    expect(selectHerdrReport(state)).toEqual({ state: "working", message: "3 subagents running" })
    state = reduceHerdrState(state, { type: "children", count: 3 })
    expect(selectHerdrReport(state)).toEqual({ state: "working", message: "3 subagents running" })
  })

  test("#given a no-op event #then the same state object is returned", () => {
    const state = reduceHerdrState(initialHerdrState(), { type: "blocked", active: true, id: "q" })
    expect(reduceHerdrState(state, { type: "blocked", active: true, id: "q" })).toBe(state)
    expect(reduceHerdrState(state, { type: "wake-source", source: "x", count: 0 })).toBe(state)
  })
})

describe("herdr bus event guards", () => {
  test("#given malformed payloads #then guards reject them", () => {
    expect(isHerdrBlockedEvent({ active: true, id: "q1", label: "L" })).toBe(true)
    expect(isHerdrBlockedEvent({ active: false, id: "q1" })).toBe(true)
    expect(isHerdrBlockedEvent({ active: true })).toBe(false)
    expect(isHerdrBlockedEvent({ active: "yes", id: "q" })).toBe(false)
    expect(isHerdrBlockedEvent(null)).toBe(false)

    expect(isTerminalMonitorStateEvent({ activeCount: 2 })).toBe(true)
    expect(isTerminalMonitorStateEvent({ activeCount: -1 })).toBe(false)
    expect(isTerminalMonitorStateEvent({ activeCount: 1.5 })).toBe(false)

    expect(isWakeSourceStateEvent({ source: "omo-dag", activeCount: 1 })).toBe(true)
    expect(isWakeSourceStateEvent({ source: "", activeCount: 1 })).toBe(false)
    expect(isWakeSourceStateEvent({ source: "x" })).toBe(false)
  })
})
