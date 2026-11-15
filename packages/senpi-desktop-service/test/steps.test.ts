import { ComputerCallError } from "@oh-my-opencode/senpi-desktop-protocol"
import { afterEach, describe, expect, it } from "vitest"
import { interpretChain } from "../src/run/steps"
import { closeDesktops, methods, openDesktop, run } from "./control-harness"
import { rejectionOf } from "./harness"

afterEach(closeDesktops)

describe("call chain step interpreter", { timeout: 30_000 }, () => {
  it("calls a dotted root member on its own object and the hop on the handle the root resolved", async () => {
    // Given
    const { service, log } = await openDesktop()

    // When
    const written = await run(service, ({ desktop }) =>
      interpretChain(desktop, [{ method: "clipboard.write", args: ["copied"] }]),
    )
    const read = await run(service, ({ desktop }) => interpretChain(desktop, [{ method: "clipboard.read" }]))
    const shot = await run(service, ({ desktop }) =>
      interpretChain(desktop, [
        { method: "window", args: ["101"] },
        { method: "screenshot", args: [{ silent: true }] },
      ]),
    )

    // Then
    expect({ written: written.returnValue, read: read.returnValue }).toEqual({ written: undefined, read: "copied" })
    expect(shot.returnValue).toMatchObject({ target: "101", frameId: "101-1" })
    expect(methods(log)).toEqual(expect.arrayContaining(["clipboard.write", "clipboard.read", "capture"]))
  })

  it.each([
    [
      "a prototype path",
      [{ method: "constructor.constructor", args: ["return process"] }, { method: "call" }],
      "unknownMethod",
    ],
    ["a method outside the tables", [{ method: "clipboard.erase", args: [] }], "unknownMethod"],
    ["a hop on an unchainable root", [{ method: "windows" }, { method: "click", args: [1, 1] }], "notChainable"],
    ["a second hop", [{ method: "window", args: ["101"] }, { method: "screenshot" }, { method: "click" }], "tooLong"],
  ] as const)("refuses %s by itself, before anything is sent", async (_label, chain, reason) => {
    // Given: a caller that skipped the tool's classification
    const { service, log } = await openDesktop()
    const sent = log.requests.length

    // When
    const error = await rejectionOf(run(service, ({ desktop }) => interpretChain(desktop, chain)))

    // Then
    expect(error).toBeInstanceOf(ComputerCallError)
    expect(error).toMatchObject({ reason })
    expect(log.requests.length).toBe(sent)
  })
})
