import { describe, expect, test } from "bun:test"
import { parseOmoCommandArgs } from "./parse"

describe("parseOmoCommandArgs()", () => {
  test("defaults to status when args empty", () => {
    // #given
    const args = ""

    // #when
    const parsed = parseOmoCommandArgs(args)

    // #then
    expect(parsed).toEqual({ primary: "status", action: "status" })
  })

  test("parses memo on/off/toggle", () => {
    // #given
    const cases = [
      { args: "memo on", expected: { primary: "memo", action: "on" } },
      { args: "memo off", expected: { primary: "memo", action: "off" } },
      { args: "memo toggle", expected: { primary: "memo", action: "toggle" } },
    ] as const

    for (const t of cases) {
      // #when
      const parsed = parseOmoCommandArgs(t.args)

      // #then
      expect(parsed).toEqual(t.expected)
    }
  })

  test("supports mono alias for memo", () => {
    // #when
    const parsed = parseOmoCommandArgs("mono on")

    // #then
    expect(parsed).toEqual({ primary: "memo", action: "on" })
  })

  test("parses ulw on/off/toggle", () => {
    // #given
    const cases = [
      { args: "ulw on", expected: { primary: "ulw", action: "on" } },
      { args: "ulw off", expected: { primary: "ulw", action: "off" } },
      { args: "ulw toggle", expected: { primary: "ulw", action: "toggle" } },
    ] as const

    for (const t of cases) {
      // #when
      const parsed = parseOmoCommandArgs(t.args)

      // #then
      expect(parsed).toEqual(t.expected)
    }
  })

  test("supports ultrawork alias for ulw", () => {
    // #when
    const parsed = parseOmoCommandArgs("ultrawork toggle")

    // #then
    expect(parsed).toEqual({ primary: "ulw", action: "toggle" })
  })
})

