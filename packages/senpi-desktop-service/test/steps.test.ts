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

  it("refuses a step that names no facade function before anything is sent for it", async () => {
    // Given
    const { service, log } = await openDesktop()

    // When
    const error = await rejectionOf(
      run(service, ({ desktop }) => interpretChain(desktop, [{ method: "clipboard.erase", args: [] }])),
    )

    // Then
    expect(error).toMatchObject({ message: "clipboard.erase is not a function" })
    expect(methods(log).some((method) => method.startsWith("clipboard."))).toBe(false)
  })
})
