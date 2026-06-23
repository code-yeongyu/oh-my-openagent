import { describe, test, expect } from "bun:test"
import type { ObservableElement } from "./observe"

describe("observe types", () => {
  test("#given ObservableElement shape #when typed #then compiles", () => {
    const el: ObservableElement = {
      role: "button",
      name: "Submit",
      selector: "button:has-text(\"Submit\")",
      isInteractive: true,
    }
    expect(el.role).toBe("button")
    expect(el.isInteractive).toBe(true)
  })
})
