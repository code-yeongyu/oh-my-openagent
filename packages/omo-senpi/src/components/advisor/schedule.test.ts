/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { shouldAskGate } from "./schedule"
import { createAdvisorSessionWindow, type AdvisorSessionWindow } from "./session-window"

const SETTINGS = { min_calls: 3, check_every: 2, cooldown: 5, max_per_session: 2 }

function windowAt(toolResults: number, patch: Partial<AdvisorSessionWindow> = {}): AdvisorSessionWindow {
  return Object.assign(createAdvisorSessionWindow(0), { toolResults }, patch)
}

describe("shouldAskGate", () => {
  it.each([
    ["before min_calls", windowAt(2), false],
    ["off the check_every beat", windowAt(3), false],
    ["on the beat after min_calls", windowAt(4), true],
    ["while a call is in flight", windowAt(4, { inFlight: true }), false],
    ["inside the cooldown", windowAt(8, { lastAdviceAt: 4, advices: 1 }), false],
    ["after the cooldown", windowAt(10, { lastAdviceAt: 4, advices: 1 }), true],
    ["at the per-session cap", windowAt(20, { lastAdviceAt: 4, advices: 2 }), false],
  ] as const)("#given %s #when asked #then it returns %p", (_case, window, expected) => {
    expect(shouldAskGate(window, SETTINGS)).toBe(expected)
  })

  it("#given a cap of 0 #when results arrive #then the gate keeps observing", () => {
    expect(shouldAskGate(windowAt(4), { ...SETTINGS, max_per_session: 0 })).toBe(true)
  })
})
