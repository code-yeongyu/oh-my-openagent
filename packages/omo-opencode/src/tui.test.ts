/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { handleTuiPollError, registerSidebarContentSlot } from "./tui"

type TestSidebarRegistration = {
  readonly order: number
  readonly slots: {
    readonly sidebar_content: () => string
  }
}

describe("TUI sidebar polling", () => {
  it("#given a sidebar slot #when it is registered #then an initial render is requested immediately", () => {
    // given
    const calls: string[] = []
    let registration: TestSidebarRegistration | undefined

    // when
    registerSidebarContentSlot({
      registerSlot: (nextRegistration) => {
        calls.push("register")
        registration = nextRegistration
      },
      requestRender: () => {
        calls.push("render")
      },
      renderSidebar: () => "sidebar",
    })

    // then
    expect(calls).toEqual(["register", "render"])
    expect(registration?.order).toBe(900)
    expect(registration?.slots.sidebar_content()).toBe("sidebar")
  })

  it("#given an unexpected Error during polling #when the poll error handler runs #then the error is logged", () => {
    // given
    const pollError = new TypeError("view derivation failed")
    const reportedErrors: Error[] = []

    // when
    handleTuiPollError(pollError, (error) => {
      reportedErrors.push(error)
    })

    // then
    expect(reportedErrors).toEqual([pollError])
  })

  it("#given a non-Error throw during polling #when the poll error handler runs #then the value is rethrown", () => {
    // given
    const thrownValue = "bad poll state"

    expect(() => handleTuiPollError(thrownValue)).toThrow(thrownValue)
  })
})
